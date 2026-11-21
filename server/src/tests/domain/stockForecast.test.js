import { describe, expect, it } from 'vitest';
import { forecastMaterialShortages } from '../../domain/stockForecast.js';

describe('stockForecast domain', () => {
  it('identifies no deficit when stock covers scheduled confirmed work', () => {
    const materials = [
      { id: 'm1', code: 'PLA', name: 'PLA', unit: 'кг', stockQty: 5.0, reservedQty: 2.0, minStockQty: 1.0 },
    ];
    const items = [
      {
        materialId: 'm1',
        orderId: 'o1',
        orderCode: 'WP-1',
        plannedMaterialQty: 1.2,
        scheduledStart: '2026-12-01T10:00:00.000Z',
      },
      {
        materialId: 'm1',
        orderId: 'o2',
        orderCode: 'WP-2',
        plannedMaterialQty: 0.8,
        scheduledStart: '2026-12-02T10:00:00.000Z',
      },
    ];

    const res = forecastMaterialShortages(materials, items);
    expect(res.shortages).toEqual([]);
    expect(res.byMaterialId.m1.hasDeficit).toBe(false);
    expect(res.byMaterialId.m1.projectedBalance).toBe(3.0);
  });

  it('finds exact deficit quantity, chronological breach date, and affected orders', () => {
    const materials = [
      { id: 'm1', code: 'ABS', name: 'ABS', unit: 'кг', stockQty: 1.0, reservedQty: 1.5, minStockQty: 0.5 },
      { id: 'm2', code: 'PETG', name: 'PETG', unit: 'кг', stockQty: 4.0, reservedQty: 1.0, minStockQty: 1.0 },
    ];
    const items = [
      // Later order placed first in input to verify chronological sorting
      {
        materialId: 'm1',
        orderId: 'o2',
        orderCode: 'WP-2026-200',
        title: 'Корпус 2',
        plannedMaterialQty: 0.7,
        scheduledStart: '2026-12-04T12:00:00.000Z',
      },
      {
        materialId: 'm1',
        orderId: 'o1',
        orderCode: 'WP-2026-100',
        title: 'Корпус 1',
        plannedMaterialQty: 0.8,
        scheduledStart: '2026-12-02T09:00:00.000Z',
      },
      {
        materialId: 'm2',
        orderId: 'o3',
        orderCode: 'WP-2026-300',
        plannedMaterialQty: 1.0,
        scheduledStart: '2026-12-02T11:00:00.000Z',
      },
    ];

    const res = forecastMaterialShortages(materials, items);
    expect(res.shortages).toHaveLength(1);
    expect(res.shortages[0]).toMatchObject({
      materialId: 'm1',
      materialCode: 'ABS',
      stockQty: 1.0,
      requiredScheduledQty: 1.5,
      deficitQty: 0.5,
      deficitDate: '2026-12-04T12:00:00.000Z',
      projectedBalance: -0.5,
    });
    expect(res.shortages[0].affectedOrders.map((o) => o.orderCode)).toEqual(['WP-2026-200']);
  });
});
