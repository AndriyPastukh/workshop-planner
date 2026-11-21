import { describe, expect, it } from 'vitest';
import {
  calculateItemCost,
  calculateMachineHourlyRate,
  calculateOrderTotals,
  getVolumeDiscount,
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
    const material = { pricePerUnit: 600, wastePct: 0.1, unit: 'кг' };
    const machine = { hourlyRate: 80 };

    const result = calculateItemCost(item, material, machine, BASE_SETTINGS);

    expect(result.qty).toBe(5);
    expect(result.breakdown).toEqual({
      material: 396,
      machine: 800,
      setup: 75,
      labor: 450,
      base: 1721,
      risk: 191.22,
      withRisk: 1912.22,
      overhead: 286.83,
      cost: 2199.06,
      margin: 659.72,
      rush: 0,
      discount: 142.94,
      priceBeforeTax: 2715.83,
      tax: 135.79,
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
    expect(result.inputs.unit).toBe('кг');
    expect(result.inputs.hourlyRate).toBe(80);
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
    const material = { pricePerUnit: 400, wastePct: 0.05, unit: 'м²' };
    const machine = { hourlyRate: 200 };
    const settings = { ...BASE_SETTINGS, failureRate: 0.02 };

    const result = calculateItemCost(item, material, machine, settings);

    expect(result.breakdown).toEqual({
      material: 420,
      machine: 200,
      setup: 75,
      labor: 150,
      base: 845,
      risk: 17.24,
      withRisk: 862.24,
      overhead: 129.34,
      cost: 991.58,
      margin: 297.47,
      rush: 322.26,
      discount: 0,
      priceBeforeTax: 1611.32,
      tax: 80.57,
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

  it('aggregates order totals from unrounded intermediates without rounding drift', () => {
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
    // Raw unrounded sums rounded once prevent 0.01 ₴ drift (e.g. price 4543.51 vs naive 2851.63 + 1691.89 = 4543.52).
    expect(totals).toEqual({
      material: 816,
      machine: 1000,
      setup: 150,
      labor: 600,
      base: 2566,
      risk: 208.47,
      withRisk: 2774.47,
      overhead: 416.17,
      cost: 3190.64,
      margin: 957.19,
      rush: 322.26,
      discount: 142.94,
      priceBeforeTax: 4327.15,
      tax: 216.36,
      taxAmount: 216.36,
      price: 4543.51,
      estimatedProfit: 1136.52,
      marginPctOfPrice: 26.3,
    });

    // Verify 3 items each having exact 1.00 / 3 = 0.3333... cost sum to 1.00 (not 0.99).
    const fractionalSettings = {
      laborRate: 0,
      failureRate: 0.1,
      overheadPct: 0,
      marginPct: 0,
      rushSurcharge: 0,
      taxPct: 0,
      volumeDiscounts: [],
    };
    const thirdItem = calculateItemCost(
      { qty: 1, usage: 0.3, runTimeH: 0, setupTimeH: 0, batchShare: 1, prepH: 0, postProcessH: 0 },
      { pricePerUnit: 1, wastePct: 0 },
      { hourlyRate: 0 },
      fractionalSettings
    );
    expect(thirdItem.breakdown.price).toBe(0.33);
    expect(calculateOrderTotals([thirdItem, thirdItem, thirdItem]).price).toBe(1);

    expect(calculateOrderTotals([])).toEqual({
      material: 0,
      machine: 0,
      setup: 0,
      labor: 0,
      base: 0,
      risk: 0,
      withRisk: 0,
      overhead: 0,
      cost: 0,
      margin: 0,
      rush: 0,
      discount: 0,
      priceBeforeTax: 0,
      tax: 0,
      taxAmount: 0,
      price: 0,
      estimatedProfit: 0,
      marginPctOfPrice: 0,
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
