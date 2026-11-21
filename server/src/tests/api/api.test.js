import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../db.js';

const app = createApp({ enableRateLimit: false });

describe('Workshop Planner REST API', () => {
  let ownerToken;
  let operatorToken;
  let seedCustomer;
  let seedMaterialPla;

  // Track temporary records created during tests so cleanup keeps seeded DB intact
  let createdCustomerId;
  let createdMachineId;
  let createdMaterialId;
  let createdTemplateId;
  let createdOrderId;
  let createdSetupRuleId;
  let originalSettings;

  beforeAll(async () => {
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@workshop.ua', password: 'Owner123!' });
    expect(ownerRes.status).toBe(200);
    ownerToken = ownerRes.body.token;

    const operatorRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'operator@workshop.ua', password: 'Operator123!' });
    expect(operatorRes.status).toBe(200);
    operatorToken = operatorRes.body.token;

    const custRes = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${ownerToken}`);
    seedCustomer = custRes.body.customers[0];

    const matRes = await request(app)
      .get('/api/materials')
      .set('Authorization', `Bearer ${ownerToken}`);
    seedMaterialPla = matRes.body.materials.find((m) => m.code === 'PLA');

    const settingsRes = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${ownerToken}`);
    originalSettings = settingsRes.body.settings;
  });

  afterAll(async () => {
    // Restore original settings if mutated
    if (originalSettings) {
      await prisma.setting.update({
        where: { id: 'default' },
        data: { atcsK1: originalSettings.atcsK1 },
      });
    }

    if (createdOrderId) {
      await prisma.materialStockMovement.deleteMany({ where: { orderId: createdOrderId } });
      await prisma.order.deleteMany({ where: { id: createdOrderId } });
    }
    if (createdTemplateId) {
      await prisma.productTemplate.deleteMany({ where: { id: createdTemplateId } });
    }
    if (createdMaterialId) {
      await prisma.materialStockMovement.deleteMany({ where: { materialId: createdMaterialId } });
      await prisma.material.deleteMany({ where: { id: createdMaterialId } });
    }
    if (createdMachineId) {
      await prisma.maintenanceWindow.deleteMany({ where: { machineId: createdMachineId } });
      await prisma.machine.deleteMany({ where: { id: createdMachineId } });
    }
    if (createdCustomerId) {
      await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
    }
    if (createdSetupRuleId) {
      await prisma.setupRule.deleteMany({ where: { id: createdSetupRuleId } });
    }

    await prisma.$disconnect();
  });

  describe('Auth, Security & RBAC', () => {
    it('rejects unauthenticated access and invalid credentials, returns /api/auth/me', async () => {
      const noToken = await request(app).get('/api/orders');
      expect(noToken.status).toBe(401);
      expect(noToken.body.error.code).toBe('UNAUTHORIZED');

      const badPass = await request(app)
        .post('/api/auth/login')
        .send({ email: 'owner@workshop.ua', password: 'WrongPassword' });
      expect(badPass.status).toBe(401);

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.role).toBe('operator');
    });

    it('enforces RBAC: operator cannot mutate owner-only resources (403)', async () => {
      const settingsPatch = await request(app)
        .patch('/api/settings')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ atcsK1: 2.5 });
      expect(settingsPatch.status).toBe(403);
      expect(settingsPatch.body.error.code).toBe('FORBIDDEN');

      const machineCreate = await request(app)
        .post('/api/machines')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Unauthorized Printer', type: 'fdm_3d', hourlyRate: 90 });
      expect(machineCreate.status).toBe(403);

      const ownerPatch = await request(app)
        .patch('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ atcsK1: 2.2 });
      expect(ownerPatch.status).toBe(200);
      expect(ownerPatch.body.settings.atcsK1).toBe(2.2);
    });

    it('enforces rate limiting on /api/auth/login when enabled', async () => {
      const limitedApp = createApp({ enableRateLimit: true });
      let status = 200;
      for (let i = 0; i < 21; i += 1) {
        const res = await request(limitedApp)
          .post('/api/auth/login')
          .send({ email: 'owner@workshop.ua', password: 'bad' });
        status = res.status;
      }
      expect(status).toBe(429);
    });
  });

  describe('Validation & CRUD endpoints', () => {
    it('returns 400 VALIDATION_ERROR on invalid payloads', async () => {
      const res = await request(app)
        .post('/api/pricing/preview')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          isRush: false,
          items: [{ materialId: seedMaterialPla.id, usage: -1, runTimeH: 1, qty: 0 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    it('supports CRUD for customers, machines + maintenance, materials + stock adjust, templates, setup rules', async () => {
      // Customer
      const cCreate = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Тест Клієнт API', company: 'ТОВ Тест', email: 'test.api@example.ua' });
      expect(cCreate.status).toBe(201);
      createdCustomerId = cCreate.body.customer.id;

      const cGet = await request(app)
        .get(`/api/customers/${createdCustomerId}`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(cGet.status).toBe(200);
      expect(cGet.body.customer.name).toBe('Тест Клієнт API');

      // Machine + maintenance window
      const mCreate = await request(app)
        .post('/api/machines')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Test Prusa MK4',
          type: 'fdm_3d',
          depreciationPerH: 70,
          powerKw: 0.25,
          isActive: false,
        });
      expect(mCreate.status).toBe(201);
      createdMachineId = mCreate.body.machine.id;
      expect(mCreate.body.machine.hourlyRate).toBeGreaterThan(70);

      const maintCreate = await request(app)
        .post(`/api/machines/${createdMachineId}/maintenance`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Тестове ТО',
          start: '2026-12-01T09:00:00.000Z',
          end: '2026-12-01T11:00:00.000Z',
        });
      expect(maintCreate.status).toBe(201);
      const maintDel = await request(app)
        .delete(`/api/machines/${createdMachineId}/maintenance/${maintCreate.body.maintenanceWindow.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(maintDel.status).toBe(200);

      // Material + stock adjustment
      const matCreate = await request(app)
        .post('/api/materials')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          code: 'TEST_NYLON',
          name: 'Нейлон PA12 тестовий',
          machineType: 'fdm_3d',
          unit: 'кг',
          pricePerUnit: 1400,
          wastePct: 0.1,
          stockQty: 1.0,
          minStockQty: 0.6,
        });
      expect(matCreate.status).toBe(201);
      createdMaterialId = matCreate.body.material.id;

      const stockAdj = await request(app)
        .post(`/api/materials/${createdMaterialId}/adjust-stock`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ deltaQty: 0.5, reason: 'Тестове поповнення' });
      expect(stockAdj.status).toBe(200);
      expect(stockAdj.body.material.stockQty).toBe(1.5);

      // Template
      const tplCreate = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Тестовий шаблон PA12',
          machineType: 'fdm_3d',
          materialId: createdMaterialId,
          usage: 0.2,
          runTimeH: 1.0,
          defaultQty: 2,
        });
      expect(tplCreate.status).toBe(201);
      createdTemplateId = tplCreate.body.template.id;

      // Setup rule
      const rulePut = await request(app)
        .put('/api/setup-rules')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          machineType: 'fdm_3d',
          fromMaterial: 'PLA',
          toMaterial: 'TEST_NYLON',
          minutes: 45,
        });
      expect(rulePut.status).toBe(200);
      createdSetupRuleId = rulePut.body.rules[0].id;
    });
  });

  describe('Pricing Preview, Orders State Machine & Stock Deduction', () => {
    it('calculates pricing preview without writing to DB and manages order lifecycle', async () => {
      const beforeCount = await prisma.order.count();
      const previewRes = await request(app)
        .post('/api/pricing/preview')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          isRush: false,
          items: [
            {
              title: 'Тестова деталь PA12',
              materialId: createdMaterialId,
              usage: 0.5,
              runTimeH: 1.0,
              prepH: 0.25,
              postProcessH: 0.25,
              qty: 2,
            },
          ],
        });
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.totals.price).toBeGreaterThan(previewRes.body.totals.cost);
      expect(previewRes.body.items[0].breakdown).toMatchObject({
        material: expect.any(Number),
        machine: expect.any(Number),
        setup: expect.any(Number),
        labor: expect.any(Number),
        risk: expect.any(Number),
        overhead: expect.any(Number),
        margin: expect.any(Number),
        rush: 0,
        discount: expect.any(Number),
        tax: expect.any(Number),
      });
      expect(previewRes.body.items[0].inputs.unit).toBe('кг');
      expect(await prisma.order.count()).toBe(beforeCount);

      // Create order as draft using createdMaterialId (stock=1.5, minStock=0.6)
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          customerId: createdCustomerId ?? seedCustomer.id,
          deadline: '2026-12-05T15:00:00.000Z',
          priority: 2,
          isRush: false,
          items: [
            {
              title: 'Тестовий корпус PA12',
              materialId: createdMaterialId,
              usage: 0.5,
              runTimeH: 1.0,
              prepH: 0.25,
              postProcessH: 0.25,
              qty: 2,
            },
          ],
        });
      expect(orderRes.status).toBe(201);
      createdOrderId = orderRes.body.order.id;
      expect(orderRes.body.order.status).toBe('draft');
      expect(orderRes.body.order.code).toMatch(/^WP-2026-\d{3,}$/);
      expect(orderRes.body.order.pricingSummary.price).toBe(orderRes.body.order.totalPrice);
      expect(orderRes.body.order.items[0].pricingBreakdown.margin).toBeGreaterThan(0);

      // Edit draft order rush flag -> recalculates breakdown cleanly, then revert before transitions
      const rushPatch = await request(app)
        .patch(`/api/orders/${createdOrderId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ isRush: true });
      expect(rushPatch.status).toBe(200);
      expect(rushPatch.body.order.pricingSummary.rush).toBeGreaterThan(0);
      expect(rushPatch.body.order.totalPrice).toBeGreaterThan(orderRes.body.order.totalPrice);

      const rushRevert = await request(app)
        .patch(`/api/orders/${createdOrderId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ isRush: false });
      expect(rushRevert.status).toBe(200);

      // Illegal transition draft -> done (409)
      const illegalRes = await request(app)
        .patch(`/api/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'done' });
      expect(illegalRes.status).toBe(409);
      expect(illegalRes.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      // Valid transitions: draft -> quoted -> confirmed -> in_progress (triggers stock deduction & LOW_STOCK warning)
      const toQuoted = await request(app)
        .patch(`/api/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'quoted' });
      expect(toQuoted.status).toBe(200);

      const toConfirmed = await request(app)
        .patch(`/api/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'confirmed' });
      expect(toConfirmed.status).toBe(200);

      const toInProgress = await request(app)
        .patch(`/api/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'in_progress' });
      expect(toInProgress.status).toBe(200);
      expect(toInProgress.body.order.status).toBe('in_progress');
      // 2 * 0.5 * (1 + 0.1) = 1.1 deducted from 1.5 -> 0.4 <= 0.6 minStockQty => LOW_STOCK warning
      expect(toInProgress.body.warnings.length).toBeGreaterThanOrEqual(1);
      expect(toInProgress.body.warnings[0].code).toBe('LOW_STOCK');

      // Cancel test order so it won't interfere with seeded planner tests
      const toCancelled = await request(app)
        .patch(`/api/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'cancelled' });
      expect(toCancelled.status).toBe(200);
    });
  });

  describe('Planner, Feasibility & Analytics', () => {
    it('returns schedule, compares 4 strategies, checks feasibility without DB writes, rebuilds & updates entries', async () => {
      const schedRes = await request(app)
        .get('/api/schedule')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(schedRes.status).toBe(200);
      expect(schedRes.body.entries.length).toBeGreaterThan(0);
      expect(schedRes.body.metrics.totalJobs).toBe(schedRes.body.entries.length);

      const compareRes = await request(app)
        .get('/api/schedule/compare')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(compareRes.status).toBe(200);
      expect(Object.keys(compareRes.body.strategies)).toEqual(['FIFO', 'EDD', 'SPT', 'ATCS']);
      expect(compareRes.body.strategies.ATCS.totalSetupMin).toBeLessThanOrEqual(
        compareRes.body.strategies.FIFO.totalSetupMin
      );

      // Feasibility check must not insert rows into DB
      const beforeOrderCount = await prisma.order.count();
      const beforeEntryCount = await prisma.scheduleEntry.count();
      const feasRes = await request(app)
        .post('/api/quotes/feasibility')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          deadline: '2026-11-30T15:00:00.000Z',
          priority: 1,
          items: [{ materialId: seedMaterialPla.id, qty: 2, runTimeH: 1 }],
        });
      expect(feasRes.status).toBe(200);
      expect(feasRes.body.feasible).toBe(true);
      expect(['ACCEPT_STANDARD', 'ACCEPT_WITH_RUSH', 'NEGOTIATE_DEADLINE']).toContain(
        feasRes.body.recommendation
      );
      expect(await prisma.order.count()).toBe(beforeOrderCount);
      expect(await prisma.scheduleEntry.count()).toBe(beforeEntryCount);

      // Rebuild preserving locked entries
      const rebuildRes = await request(app)
        .post('/api/schedule/rebuild?rule=ATCS')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(rebuildRes.status).toBe(200);
      expect(rebuildRes.body.entries.some((e) => e.locked)).toBe(true);

      // Manual move & conflict detection on same machine
      const fdmMachine = rebuildRes.body.machines.find((m) => m.type === 'fdm_3d');
      const fdmEntries = rebuildRes.body.entries.filter((e) => e.machineId === fdmMachine.id);
      expect(fdmEntries.length).toBeGreaterThanOrEqual(2);

      const firstEntry = fdmEntries[0];
      const lastEntry = fdmEntries.at(-1);

      // Overlapping move onto firstEntry's start must fail with 409 SCHEDULE_CONFLICT
      const conflictMove = await request(app)
        .patch(`/api/schedule/${lastEntry.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ start: firstEntry.start });
      expect(conflictMove.status).toBe(409);
      expect(conflictMove.body.error.code).toBe('SCHEDULE_CONFLICT');

      // Valid move into future shift and lock toggle, then restore via rebuild
      const validMove = await request(app)
        .patch(`/api/schedule/${lastEntry.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ start: '2026-12-10T10:00:00.000Z', locked: true });
      expect(validMove.status).toBe(200);
      expect(validMove.body.entry.locked).toBe(true);

      const unlockRes = await request(app)
        .patch(`/api/schedule/${lastEntry.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ locked: false });
      expect(unlockRes.status).toBe(200);

      // Maintenance conflict check on PATCH /api/schedule/:id -> 409 MAINTENANCE_CONFLICT
      const tempMaintRes = await request(app)
        .post(`/api/machines/${fdmMachine.id}/maintenance`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Тимчасове ТО для тесту API',
          start: '2026-12-10T09:30:00.000Z',
          end: '2026-12-10T11:30:00.000Z',
        });
      expect(tempMaintRes.status).toBe(201);
      const maintConflictMove = await request(app)
        .patch(`/api/schedule/${lastEntry.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ start: '2026-12-10T10:00:00.000Z' });
      expect(maintConflictMove.status).toBe(409);
      expect(maintConflictMove.body.error.code).toBe('MAINTENANCE_CONFLICT');
      const cleanupMaint = await request(app)
        .delete(
          `/api/machines/${fdmMachine.id}/maintenance/${tempMaintRes.body.maintenanceWindow.id}`
        )
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(cleanupMaint.status).toBe(200);

      // What-If read-only simulation
      const whatIfBeforeCount = await prisma.scheduleEntry.count();
      const whatIfRes = await request(app)
        .post('/api/schedule/what-if')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          extraMachines: { fdm_3d: 1 },
          enableBatchSplit: true,
          marginPct: 0.35,
        });
      expect(whatIfRes.status).toBe(200);
      expect(whatIfRes.body.simulated.machineCount).toBe(whatIfRes.body.baseline.machineCount + 1);
      expect(whatIfRes.body.delta.estimatedProfit).toBeGreaterThan(0);
      expect(await prisma.scheduleEntry.count()).toBe(whatIfBeforeCount);

      // Rebuild with enableBatchSplit: true using temporarily activated 2nd FDM machine
      if (createdMachineId) {
        await request(app)
          .patch(`/api/machines/${createdMachineId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ isActive: true });

        const splitRebuild = await request(app)
          .post('/api/schedule/rebuild?rule=ATCS&enableBatchSplit=true')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(splitRebuild.status).toBe(200);
        expect(splitRebuild.body.enableBatchSplit).toBe(true);
        expect(splitRebuild.body.entries.some((e) => e.batchQty != null)).toBe(true);

        // Restore deactivated test machine & unsplit schedule
        await request(app)
          .patch(`/api/machines/${createdMachineId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ isActive: false });

        const restoreRebuild = await request(app)
          .post('/api/schedule/rebuild?rule=ATCS&enableBatchSplit=false')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(restoreRebuild.status).toBe(200);
      }

      // Analytics endpoints
      const dashRes = await request(app)
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(dashRes.status).toBe(200);
      expect(dashRes.body.activeOrdersCount).toBeGreaterThan(0);

      const sumRes = await request(app)
        .get('/api/analytics/summary')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(sumRes.status).toBe(200);
      expect(sumRes.body.totalRevenue).toBeGreaterThan(sumRes.body.totalCost);
    });
  });
});
