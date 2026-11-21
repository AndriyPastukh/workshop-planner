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
  unit: z.string().trim().min(1).default('од.'),
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

const TOTAL_KEYS = [
  'material',
  'machine',
  'setup',
  'labor',
  'base',
  'risk',
  'withRisk',
  'overhead',
  'cost',
  'margin',
  'rush',
  'discount',
  'priceBeforeTax',
  'tax',
  'taxAmount',
  'price',
  'estimatedProfit',
];

/**
 * Single rounding gate to 0.01 ₴ using EPSILON to avoid binary float bias (e.g. 1.005).
 */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundBreakdown(raw) {
  return Object.fromEntries(Object.entries(raw).map(([key, val]) => [key, roundMoney(val)]));
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
 * Intermediate terms keep full floating-point precision; rounding to 0.01 ₴ runs once at output.
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
  const risk = withRisk - base;
  const cost = withRisk * (1 + parsedSettings.overheadPct);
  const overhead = cost - withRisk;

  const rushSurcharge = parsedItem.isRush ? parsedSettings.rushSurcharge : 0;
  const volumeDiscount = getVolumeDiscount(parsedItem.qty, parsedSettings.volumeDiscounts);

  const afterMargin = cost * (1 + parsedSettings.marginPct);
  const margin = afterMargin - cost;
  const afterRush = afterMargin * (1 + rushSurcharge);
  const rush = afterRush - afterMargin;
  const priceBeforeTax = afterRush * (1 - volumeDiscount);
  const discount = afterRush - priceBeforeTax;
  const tax = priceBeforeTax * parsedSettings.taxPct;
  const price = priceBeforeTax + tax;
  const unitPrice = price / parsedItem.qty;
  const estimatedProfit = priceBeforeTax - cost;

  const raw = {
    material: materialCost,
    machine: machineCost,
    setup: setupCost,
    labor: laborCost,
    base,
    risk,
    withRisk,
    overhead,
    cost,
    margin,
    rush,
    discount,
    priceBeforeTax,
    tax,
    taxAmount: tax,
    price,
    unitPrice,
    estimatedProfit,
  };

  return {
    qty: parsedItem.qty,
    raw,
    breakdown: roundBreakdown(raw),
    appliedRates: {
      wastePct: parsedMaterial.wastePct,
      failureRate: parsedSettings.failureRate,
      overheadPct: parsedSettings.overheadPct,
      marginPct: parsedSettings.marginPct,
      rushSurcharge,
      volumeDiscount,
      taxPct: parsedSettings.taxPct,
    },
    inputs: {
      qty: parsedItem.qty,
      usage: parsedItem.usage,
      unit: parsedMaterial.unit,
      pricePerUnit: parsedMaterial.pricePerUnit,
      wastePct: parsedMaterial.wastePct,
      runTimeH: parsedItem.runTimeH,
      hourlyRate: roundMoney(hourlyRate),
      setupTimeH: parsedItem.setupTimeH,
      batchShare: parsedItem.batchShare,
      prepH: parsedItem.prepH,
      postProcessH: parsedItem.postProcessH,
      laborRate: parsedSettings.laborRate,
    },
  };
}

/**
 * Aggregate breakdown totals across multiple item results without rounding-drift accumulation.
 */
export function calculateOrderTotals(itemResults = []) {
  const rawSums = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  for (const res of itemResults) {
    const source = res?.raw ?? res?.breakdown ?? {};
    for (const k of TOTAL_KEYS) {
      rawSums[k] += source[k] ?? 0;
    }
  }

  const totals = roundBreakdown(rawSums);
  totals.marginPctOfPrice =
    rawSums.priceBeforeTax > 0
      ? Number(((rawSums.estimatedProfit / rawSums.priceBeforeTax) * 100).toFixed(1))
      : 0;
  return totals;
}
