import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../db.js';

const app = createApp({ enableRateLimit: false });

describe('Warehouse Stock State Machine, Shortage Forecast & Concurrency Race Guard', () => {
  let ownerToken;
  let operatorToken;
  let customerId;
  const createdOrderIds = [];
  const createdMaterialIds = [];

  beforeAll(async () => {
    const [ownerRes, opRes] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'owner@workshop.ua', password: 'Owner123!' }),
      request(app).post('/api/auth/login').send({ email: 'operator@workshop.ua', password: 'Operator123!' }),
    ]);
    ownerToken = ownerRes.body.token;
    operatorToken = opRes.body.token;

    const custRes = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${ownerToken}`);
    customerId = custRes.body.customers[0].id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.materialStockMovement.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }
    if (createdMaterialIds.length > 0) {
      await prisma.materialStockMovement.deleteMany({
        where: { materialId: { in: createdMaterialIds } },
      });
      await prisma.material.deleteMany({
        where: { id: { in: createdMaterialIds } },
      });
    }
    await prisma.$disconnect();
  });

  async function createTestMaterial({ code, stockQty = 1.0, minStockQty = 0.2, wastePct = 0 }) {
    const res = await request(app)
      .post('/api/materials')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        code,
        name: `Тест склад ${code}`,
        machineType: 'fdm_3d',
        unit: 'кг',
        pricePerUnit: 800,
        wastePct,
        stockQty,
        minStockQty,
      });
    expect(res.status).toBe(201);
    createdMaterialIds.push(res.body.material.id);
    return res.body.material;
  }

  async function createTestOrder({ materialId, qty = 1, usage = 0.8, status = 'confirmed' }) {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        customerId,
        deadline: '2026-12-15T17:00:00.000Z',
        priority: 2,
        status,
        items: [
          {
            title: 'Тестова деталь складу',
            materialId,
            usage,
            runTimeH: 0.5,
            qty,
          },
        ],
      });
    expect(res.status).toBe(201);
    createdOrderIds.push(res.body.order.id);
    return res.body.order;
  }

  it('prevents negative stock when two confirmed orders consume concurrently (FOR UPDATE race guard)', async () => {
    const mat = await createTestMaterial({ code: `RACE_CON_${Date.now()}`, stockQty: 1.0 });
    const [orderA, orderB] = await Promise.all([
      createTestOrder({ materialId: mat.id, qty: 1, usage: 0.8, status: 'confirmed' }),
      createTestOrder({ materialId: mat.id, qty: 1, usage: 0.8, status: 'confirmed' }),
    ]);

    const matBeforeStart = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(matBeforeStart.reservedQty).toBe(1.6);

    // Concurrent production start: combined demand is 1.6 > 1.0 physical stock
    const [resA, resB] = await Promise.all([
      request(app)
        .patch(`/api/orders/${orderA.id}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'in_progress' }),
      request(app)
        .patch(`/api/orders/${orderB.id}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'in_progress' }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const freshMat = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(freshMat.stockQty).toBe(0);
    expect(freshMat.stockQty).toBeGreaterThanOrEqual(0);
    expect(freshMat.reservedQty).toBe(0);

    const consumeMovements = await prisma.materialStockMovement.findMany({
      where: { materialId: mat.id, type: 'consume' },
    });
    const totalConsumed = Number(consumeMovements.reduce((s, m) => s + m.qty, 0).toFixed(3));
    expect(totalConsumed).toBe(1.0);

    const allWarnings = [...resA.body.warnings, ...resB.body.warnings];
    const insufficient = allWarnings.filter((w) => w.code === 'INSUFFICIENT_STOCK');
    expect(insufficient.length).toBeGreaterThanOrEqual(1);
    expect(insufficient.some((w) => w.shortageQty === 0.6)).toBe(true);
  });

  it('prevents negative stock under concurrent manual owner adjustments', async () => {
    const mat = await createTestMaterial({ code: `RACE_ADJ_${Date.now()}`, stockQty: 1.0 });

    const [adjA, adjB] = await Promise.all([
      request(app)
        .post(`/api/materials/${mat.id}/adjust`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ deltaQty: -0.8, comment: 'Одночасна інвентаризація А' }),
      request(app)
        .post(`/api/materials/${mat.id}/adjust`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ deltaQty: -0.8, comment: 'Одночасна інвентаризація Б' }),
    ]);

    const statuses = [adjA.status, adjB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);

    const rejected = adjA.status === 400 ? adjA : adjB;
    expect(rejected.body.error.code).toBe('INSUFFICIENT_STOCK');

    const freshMat = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(freshMat.stockQty).toBe(0.2);
  });

  it('handles reserve -> release on cancel, consume -> actual waste on done, and RBAC for adjust/receipt', async () => {
    const mat = await createTestMaterial({
      code: `LIFE_${Date.now()}`,
      stockQty: 5.0,
      minStockQty: 1.0,
      wastePct: 0.1,
    });

    // Operator cannot manually adjust, only receive
    const forbiddenAdj = await request(app)
      .post(`/api/materials/${mat.id}/adjust`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ deltaQty: -0.5, comment: 'Оператору заборонено' });
    expect(forbiddenAdj.status).toBe(403);

    const opReceipt = await request(app)
      .post(`/api/materials/${mat.id}/receipt`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ qty: 1.0, comment: 'Прихід котушки на склад' });
    expect(opReceipt.status).toBe(200);
    expect(opReceipt.body.material.stockQty).toBe(6.0);

    // Cancel flow: draft -> confirmed (reserve) -> cancelled (release)
    const cancelOrder = await createTestOrder({ materialId: mat.id, qty: 2, usage: 0.5, status: 'draft' });
    const confirmCancel = await request(app)
      .patch(`/api/orders/${cancelOrder.id}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'confirmed' });
    expect(confirmCancel.status).toBe(200);

    let state = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(state.reservedQty).toBe(1.1); // 2 * 0.5 * 1.1

    const cancelledRes = await request(app)
      .patch(`/api/orders/${cancelOrder.id}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'cancelled' });
    expect(cancelledRes.status).toBe(200);

    state = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(state.reservedQty).toBe(0);
    expect(state.stockQty).toBe(6.0);

    // Done flow with actual overrun waste
    const workOrder = await createTestOrder({ materialId: mat.id, qty: 2, usage: 0.5, status: 'confirmed' });
    await request(app)
      .patch(`/api/orders/${workOrder.id}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'in_progress' });

    const doneRes = await request(app)
      .patch(`/api/orders/${workOrder.id}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        status: 'done',
        actualUsages: [{ orderItemId: workOrder.items[0].id, actualMaterialQty: 1.35 }],
      });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.order.items[0].actualMaterialQty).toBe(1.35);

    state = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
    expect(state.stockQty).toBe(4.65); // 6.0 - 1.1 consume - 0.25 waste

    const wasteMovements = await prisma.materialStockMovement.findMany({
      where: { orderId: workOrder.id, type: 'waste' },
    });
    expect(wasteMovements).toHaveLength(1);
    expect(wasteMovements[0].qty).toBe(0.25);

    // Warehouse GET /api/materials returns shortages & summary
    const listRes = await request(app)
      .get('/api/materials')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.summary.totalMaterials).toBeGreaterThanOrEqual(12);
    expect(listRes.body.shortages.some((s) => s.materialCode === 'RESIN_TOUGH')).toBe(true);

    // Order details GET /api/orders/:id returns auditLogs, materialSummary, materialTotals & pricingSummary
    const detailsRes = await request(app)
      .get(`/api/orders/${workOrder.id}`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.order.auditLogs.length).toBeGreaterThanOrEqual(3);
    expect(detailsRes.body.order.materialTotals.spentByUnit['кг']).toBe(1.35);
    expect(detailsRes.body.order.items[0].materialSummary).toMatchObject({
      plannedQty: 1.1,
      reservedQty: 0,
      consumedQty: 1.1,
      wasteQty: 0.25,
      actualSpentQty: 1.35,
      unit: 'кг',
      materialStatus: 'in_work',
    });
    expect(detailsRes.body.order.pricingSummary.price).toBeGreaterThan(0);
  });
});
