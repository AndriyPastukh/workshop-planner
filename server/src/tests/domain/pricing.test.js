import { describe, expect, it } from 'vitest';
import {
  calculateItemCost,
  calculateMachineHourlyRate,
  calculateOrderTotals,
  getVolumeDiscount,
  roundMoney,
} from '../../domain/pricing.js';

const BASE_SETTINGS = {
  laborRate: 300,
  failureRate: 0.1,
  overheadPct: 0.15,
  marginPct: 0.3,
  rushSurcharge: 0.25,
  taxPct: 0.05,
  volumeDiscounts: [
    { minQty: 5, discountPct: 0.05 },
    { minQty: 20, discountPct: 0.12 },
  ],
};

describe('pricing domain', () => {
  it('calculates Example 1a (3D-print batch of 5, standard order) matching manual reference', () => {
    const item = {
      qty: 5,
      usage: 0.12,
      runTimeH: 2.0,
      setupTimeH: 0.5,
      batchShare: 2,
      prepH: 0.5,
      postProcessH: 1.0,
      isRush: false,
    };
    const material = { pricePerUnit: 600, wastePct: 0.1 };
    const machine = { hourlyRate: 80 };

    const result = calculateItemCost(item, material, machine, BASE_SETTINGS);

    expect(result.qty).toBe(5);
    expect(result.breakdown).toEqual({
      material: 396,
      machine: 800,
      setup: 75,
      labor: 450,
      base: 1721,
      withRisk: 1912.22,
      cost: 2199.06,
      priceBeforeTax: 2715.83,
      taxAmount: 135.79,
      price: 2851.63,
      unitPrice: 570.33,
      estimatedProfit: 516.78,
    });
    expect(result.appliedRates).toEqual({
      wastePct: 0.1,
      failureRate: 0.1,
      overheadPct: 0.15,
      marginPct: 0.3,
      rushSurcharge: 0,
      volumeDiscount: 0.05,
      taxPct: 0.05,
    });
  });

  it('calculates Example 1b (laser rush order of 2) matching manual reference', () => {
    const item = {
      qty: 2,
      usage: 0.5,
      runTimeH: 0.5,
      setupTimeH: 0.25,
      batchShare: 1,
      prepH: 0.25,
      postProcessH: 0.25,
      isRush: true,
    };
    const material = { pricePerUnit: 400, wastePct: 0.05 };
    const machine = { hourlyRate: 200 };
    const settings = { ...BASE_SETTINGS, failureRate: 0.02 };

    const result = calculateItemCost(item, material, machine, settings);

    expect(result.breakdown).toEqual({
      material: 420,
      machine: 200,
      setup: 75,
      labor: 150,
      base: 845,
      withRisk: 862.24,
      cost: 991.58,
      priceBeforeTax: 1611.32,
      taxAmount: 80.57,
      price: 1691.89,
      unitPrice: 845.94,
      estimatedProfit: 619.74,
    });
    expect(result.appliedRates.rushSurcharge).toBe(0.25);
    expect(result.appliedRates.volumeDiscount).toBe(0);
  });

  it('computes machine hourly rate from depreciation, power, and electricity tariff', () => {
    const rate = calculateMachineHourlyRate({
      depreciationPerH: 45,
      powerKw: 1.5,
      electricityRatePerKwh: 4.32,
    });
    expect(rate).toBe(51.48);

    const result = calculateItemCost(
      { qty: 1, usage: 1, runTimeH: 1, setupTimeH: 0, batchShare: 1, prepH: 0, postProcessH: 0 },
      { pricePerUnit: 100, wastePct: 0 },
      { depreciationPerH: 45, powerKw: 1.5 },
      {
        laborRate: 200,
        failureRate: 0,
        overheadPct: 0,
        marginPct: 0,
        rushSurcharge: 0,
        taxPct: 0,
        electricityRatePerKwh: 4.32,
        volumeDiscounts: [],
      }
    );
    expect(result.breakdown.machine).toBe(51.48);
  });

  it('selects correct volume discount tier across boundaries and unsorted tiers', () => {
    const tiers = [
      { minQty: 20, discountPct: 0.12 },
      { minQty: 5, discountPct: 0.05 },
      { minQty: 10, discountPct: 0.08 },
    ];
    expect(getVolumeDiscount(1, tiers)).toBe(0);
    expect(getVolumeDiscount(4, tiers)).toBe(0);
    expect(getVolumeDiscount(5, tiers)).toBe(0.05);
    expect(getVolumeDiscount(10, tiers)).toBe(0.08);
    expect(getVolumeDiscount(19, tiers)).toBe(0.08);
    expect(getVolumeDiscount(20, tiers)).toBe(0.12);
    expect(getVolumeDiscount(100, [])).toBe(0);
  });

  it('aggregates order totals across multiple item results', () => {
    const first = calculateItemCost(
      { qty: 5, usage: 0.12, runTimeH: 2.0, setupTimeH: 0.5, batchShare: 2, prepH: 0.5, postProcessH: 1.0 },
      { pricePerUnit: 600, wastePct: 0.1 },
      { hourlyRate: 80 },
      BASE_SETTINGS
    );
    const second = calculateItemCost(
      {
        qty: 2,
        usage: 0.5,
        runTimeH: 0.5,
        setupTimeH: 0.25,
        batchShare: 1,
        prepH: 0.25,
        postProcessH: 0.25,
        isRush: true,
      },
      { pricePerUnit: 400, wastePct: 0.05 },
      { hourlyRate: 200 },
      { ...BASE_SETTINGS, failureRate: 0.02 }
    );

    const totals = calculateOrderTotals([first, second]);
    expect(totals).toEqual({
      material: roundMoney(396 + 420),
      machine: roundMoney(800 + 200),
      setup: roundMoney(75 + 75),
      labor: roundMoney(450 + 150),
      base: roundMoney(1721 + 845),
      withRisk: roundMoney(1912.22 + 862.24),
      cost: roundMoney(2199.06 + 991.58),
      priceBeforeTax: roundMoney(2715.83 + 1611.32),
      taxAmount: roundMoney(135.79 + 80.57),
      price: roundMoney(2851.63 + 1691.89),
      estimatedProfit: roundMoney(516.78 + 619.74),
    });
    expect(calculateOrderTotals([])).toEqual({
      material: 0,
      machine: 0,
      setup: 0,
      labor: 0,
      base: 0,
      withRisk: 0,
      cost: 0,
      priceBeforeTax: 0,
      taxAmount: 0,
      price: 0,
      estimatedProfit: 0,
    });
  });

  it('rejects invalid inputs via Zod validation', () => {
    const validMaterial = { pricePerUnit: 100, wastePct: 0 };
    const validMachine = { hourlyRate: 50 };

    expect(() =>
      calculateItemCost(
        { qty: 0, usage: 1, runTimeH: 1, setupTimeH: 0 },
        validMaterial,
        validMachine,
        BASE_SETTINGS
      )
    ).toThrow();

    expect(() =>
      calculateItemCost(
        { qty: 1, usage: 1, runTimeH: 1, setupTimeH: 0, batchShare: 0 },
        validMaterial,
        validMachine,
        BASE_SETTINGS
      )
    ).toThrow();

    expect(() =>
      calculateItemCost(
        { qty: 1, usage: -1, runTimeH: 1, setupTimeH: 0 },
        validMaterial,
        validMachine,
        BASE_SETTINGS
      )
    ).toThrow();

    expect(() =>
      calculateItemCost(
        { qty: 1, usage: 1, runTimeH: 1, setupTimeH: 0 },
        validMaterial,
        validMachine,
        { ...BASE_SETTINGS, failureRate: 1 }
      )
    ).toThrow();

    expect(() =>
      calculateItemCost(
        { qty: 1, usage: 1, runTimeH: 1, setupTimeH: 0 },
        validMaterial,
        validMachine,
        { ...BASE_SETTINGS, failureRate: -0.05 }
      )
    ).toThrow();

    expect(() => getVolumeDiscount(10, [{ minQty: 5, discountPct: 1 }])).toThrow();
  });
});
