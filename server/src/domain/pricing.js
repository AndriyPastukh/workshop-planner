import { z } from 'zod';

const itemSchema = z.object({
  qty: z.number().positive('qty must be greater than 0'),
  usage: z.number().nonnegative(),
  runTimeH: z.number().nonnegative(),
  setupTimeH: z.number().nonnegative().default(0),
  batchShare: z.number().min(1, 'batchShare must be at least 1').default(1),
  prepH: z.number().nonnegative().default(0),
  postProcessH: z.number().nonnegative().default(0),
  isRush: z.boolean().default(false),
});

const materialSchema = z.object({
  pricePerUnit: z.number().nonnegative(),
  wastePct: z.number().nonnegative().default(0),
});

const machineSchema = z
  .object({
    hourlyRate: z.number().nonnegative().optional(),
    depreciationPerH: z.number().nonnegative().optional(),
    powerKw: z.number().nonnegative().default(0),
  })
  .refine(
    (m) => m.hourlyRate !== undefined || m.depreciationPerH !== undefined,
    'Either hourlyRate or depreciationPerH must be provided'
  );

const volumeDiscountTierSchema = z.object({
  minQty: z.number().positive(),
  discountPct: z.number().min(0).lt(1, 'discountPct must be strictly less than 1'),
});

const settingsSchema = z.object({
  laborRate: z.number().nonnegative(),
  failureRate: z.number().min(0).lt(1, 'failureRate must be in [0, 1)').default(0),
  overheadPct: z.number().nonnegative().default(0),
  marginPct: z.number().nonnegative().default(0),
  rushSurcharge: z.number().nonnegative().default(0),
  taxPct: z.number().nonnegative().default(0),
  electricityRatePerKwh: z.number().nonnegative().default(0),
  volumeDiscounts: z.array(volumeDiscountTierSchema).default([]),
});

/**
 * Round monetary values to 2 decimal places using EPSILON to avoid binary float bias (e.g. 1.005).
 */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Derive a machine's hourly rate from fixed depreciation and electricity consumption.
 */
export function calculateMachineHourlyRate(params) {
  const parsed = z
    .object({
      depreciationPerH: z.number().nonnegative(),
      powerKw: z.number().nonnegative().default(0),
      electricityRatePerKwh: z.number().nonnegative().default(0),
    })
    .parse(params);

  return roundMoney(parsed.depreciationPerH + parsed.powerKw * parsed.electricityRatePerKwh);
}

/**
 * Select the highest applicable volume discount tier for a given item quantity.
 */
export function getVolumeDiscount(qty, volumeDiscounts = []) {
  const validQty = z.number().positive().parse(qty);
  const validTiers = z.array(volumeDiscountTierSchema).parse(volumeDiscounts);

  let applied = 0;
  let bestThreshold = 0;
  for (const tier of validTiers) {
    if (validQty >= tier.minQty && tier.minQty >= bestThreshold) {
      bestThreshold = tier.minQty;
      applied = tier.discountPct;
    }
  }
  return applied;
}

/**
 * Calculate full cost and selling-price breakdown for a single order item (CLAUDE.md §7.1).
 * Intermediate terms keep full floating-point precision; individual output fields are rounded.
 */
export function calculateItemCost(item, material, machine, settings) {
  const parsedItem = itemSchema.parse(item);
  const parsedMaterial = materialSchema.parse(material);
  const parsedMachine = machineSchema.parse(machine);
  const parsedSettings = settingsSchema.parse(settings);

  const hourlyRate =
    parsedMachine.hourlyRate ??
    calculateMachineHourlyRate({
      depreciationPerH: parsedMachine.depreciationPerH,
      powerKw: parsedMachine.powerKw,
      electricityRatePerKwh: parsedSettings.electricityRatePerKwh,
    });

  const materialCost =
    parsedItem.qty * parsedItem.usage * parsedMaterial.pricePerUnit * (1 + parsedMaterial.wastePct);
  const machineCost = parsedItem.qty * parsedItem.runTimeH * hourlyRate;
  // Setup labor can be amortized across a batch sharing the same material/configuration.
  const setupCost = (parsedItem.setupTimeH * parsedSettings.laborRate) / parsedItem.batchShare;
  const laborCost = (parsedItem.prepH + parsedItem.postProcessH) * parsedSettings.laborRate;

  const base = materialCost + machineCost + setupCost + laborCost;
  // Divide by (1 - failureRate) because scrapped units consume full production resources again.
  const withRisk = base / (1 - parsedSettings.failureRate);
  const cost = withRisk * (1 + parsedSettings.overheadPct);

  const rushSurcharge = parsedItem.isRush ? parsedSettings.rushSurcharge : 0;
  const volumeDiscount = getVolumeDiscount(parsedItem.qty, parsedSettings.volumeDiscounts);

  const priceBeforeTax =
    cost * (1 + parsedSettings.marginPct) * (1 + rushSurcharge) * (1 - volumeDiscount);
  const taxAmount = priceBeforeTax * parsedSettings.taxPct;
  const price = priceBeforeTax + taxAmount;
  const unitPrice = price / parsedItem.qty;
  const estimatedProfit = priceBeforeTax - cost;

  return {
    qty: parsedItem.qty,
    breakdown: {
      material: roundMoney(materialCost),
      machine: roundMoney(machineCost),
      setup: roundMoney(setupCost),
      labor: roundMoney(laborCost),
      base: roundMoney(base),
      withRisk: roundMoney(withRisk),
      cost: roundMoney(cost),
      priceBeforeTax: roundMoney(priceBeforeTax),
      taxAmount: roundMoney(taxAmount),
      price: roundMoney(price),
      unitPrice: roundMoney(unitPrice),
      estimatedProfit: roundMoney(estimatedProfit),
    },
    appliedRates: {
      wastePct: parsedMaterial.wastePct,
      failureRate: parsedSettings.failureRate,
      overheadPct: parsedSettings.overheadPct,
      marginPct: parsedSettings.marginPct,
      rushSurcharge,
      volumeDiscount,
      taxPct: parsedSettings.taxPct,
    },
  };
}

/**
 * Aggregate breakdown totals across multiple calculated order item results.
 */
export function calculateOrderTotals(itemResults = []) {
  const keys = [
    'material',
    'machine',
    'setup',
    'labor',
    'base',
    'withRisk',
    'cost',
    'priceBeforeTax',
    'taxAmount',
    'price',
    'estimatedProfit',
  ];

  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const res of itemResults) {
    for (const k of keys) {
      totals[k] += res.breakdown[k] ?? 0;
    }
  }
  for (const k of keys) {
    totals[k] = roundMoney(totals[k]);
  }
  return totals;
}
