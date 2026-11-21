import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';

const MOVEMENT_TYPES = ['receipt', 'reserve', 'release', 'consume', 'waste', 'adjustment'];

describe('Database Warehouse Schema, CHECK Constraints & Seeded Ledger', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces PostgreSQL CHECK constraint prohibiting negative stockQty', async () => {
    const abs = await prisma.material.findUniqueOrThrow({ where: { code: 'ABS' } });

    await expect(
      prisma.material.update({
        where: { id: abs.id },
        data: { stockQty: -0.1 },
      })
    ).rejects.toThrow(/materials_stock_qty_nonnegative|check constraint/i);

    const reloaded = await prisma.material.findUniqueOrThrow({ where: { id: abs.id } });
    expect(reloaded.stockQty).toBe(abs.stockQty);
  });

  it('seeds all 6 movement types, a low-stock material (ABS), and a deficit material (RESIN_TOUGH)', async () => {
    const movements = await prisma.materialStockMovement.findMany({
      select: { type: true },
    });
    const presentTypes = new Set(movements.map((m) => m.type));
    for (const type of MOVEMENT_TYPES) {
      expect(presentTypes.has(type)).toBe(true);
    }

    const abs = await prisma.material.findUniqueOrThrow({ where: { code: 'ABS' } });
    const absAvailable = Number((abs.stockQty - abs.reservedQty).toFixed(3));
    expect(absAvailable).toBeGreaterThan(0);
    expect(absAvailable).toBeLessThanOrEqual(abs.minStockQty);

    const resinTough = await prisma.material.findUniqueOrThrow({ where: { code: 'RESIN_TOUGH' } });
    const resinAvailable = Number((resinTough.stockQty - resinTough.reservedQty).toFixed(3));
    expect(resinTough.stockQty).toBeGreaterThanOrEqual(0);
    expect(resinAvailable).toBeLessThan(0);
  });

  it('maintains balanced stock and reservation ledgers for every seeded material', async () => {
    const materials = await prisma.material.findMany({
      include: { stockMovements: true },
    });
    expect(materials.length).toBeGreaterThanOrEqual(12);

    for (const mat of materials) {
      let receiptSum = 0;
      let consumeSum = 0;
      let wasteSum = 0;
      let adjustmentSum = 0;
      let reserveSum = 0;
      let releaseSum = 0;

      for (const mv of mat.stockMovements) {
        if (mv.type === 'receipt') receiptSum += mv.qty;
        else if (mv.type === 'consume') consumeSum += mv.qty;
        else if (mv.type === 'waste') wasteSum += mv.qty;
        else if (mv.type === 'adjustment') adjustmentSum += mv.qty;
        else if (mv.type === 'reserve') reserveSum += mv.qty;
        else if (mv.type === 'release') releaseSum += mv.qty;
      }

      const ledgerStock = receiptSum - consumeSum - wasteSum + adjustmentSum;
      const ledgerReserved = reserveSum - releaseSum;

      expect(Math.abs(ledgerStock - mat.stockQty)).toBeLessThanOrEqual(0.002);
      expect(Math.abs(ledgerReserved - mat.reservedQty)).toBeLessThanOrEqual(0.002);
    }
  });

  it('stores plannedMaterialQty on all order items and actualMaterialQty on completed items', async () => {
    const items = await prisma.orderItem.findMany({
      include: { order: { select: { status: true } } },
    });
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.plannedMaterialQty).toBeGreaterThan(0);
      if (item.order.status === 'done') {
        expect(item.actualMaterialQty).not.toBeNull();
        expect(item.actualMaterialQty).toBeGreaterThan(0);
      }
    }
  });
});
