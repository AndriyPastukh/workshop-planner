import { DEFAULT_CALENDAR } from './calendar.js';
import { calculateItemCost, calculateMachineHourlyRate, calculateOrderTotals } from './pricing.js';
import { schedule } from './scheduler.js';
import { DEFAULT_SETUP_RULES } from './setup.js';

const DEFAULT_VIRTUAL_RATES = {
  fdm_3d: 95,
  resin_3d: 145,
  laser: 220,
  cnc_wood: 260,
};

const MACHINE_TYPE_NAMES = {
  fdm_3d: 'FDM 3D-принтер',
  resin_3d: 'Смоляний SLA',
  laser: 'Лазер CO2',
  cnc_wood: 'ЧПК Фрезер',
};

function buildVirtualMachines(machines, extraMachines = {}) {
  const result = machines.map((m) => ({ ...m }));
  for (const [type, rawCount] of Object.entries(extraMachines)) {
    const count = Math.max(0, Math.min(5, Math.floor(Number(rawCount) || 0)));
    if (count === 0) {
      continue;
    }
    const proto = machines.find((m) => m.type === type) ?? null;
    for (let i = 1; i <= count; i += 1) {
      const rate = proto?.hourlyRate ?? DEFAULT_VIRTUAL_RATES[type] ?? 120;
      result.push({
        id: `virtual-${type}-${i}`,
        name: `${MACHINE_TYPE_NAMES[type] ?? type} (Дод. #${i})`,
        type,
        hourlyRate: rate,
        depreciationPerH: proto?.depreciationPerH ?? rate,
        powerKw: proto?.powerKw ?? 0.5,
        calendar: proto?.calendar ?? DEFAULT_CALENDAR,
        maintenanceWindows: [],
        isVirtual: true,
      });
    }
  }
  return result;
}

function computeQueueFinance(items = [], machines = [], materialsById = new Map(), settings = {}, electricityOverride = null) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      totalCost: 0,
      totalPrice: 0,
      priceBeforeTax: 0,
      estimatedProfit: 0,
      marginPctOfPrice: 0,
    };
  }

  const machineByType = new Map();
  for (const m of machines) {
    if (!machineByType.has(m.type)) {
      machineByType.set(m.type, m);
    }
  }

  const itemResults = [];
  const effectiveElecRate = electricityOverride ?? settings.electricityRatePerKwh ?? 0;

  for (const entry of items) {
    const item = entry.item ?? entry;
    const order = entry.order ?? {};
    const material = item.material ?? materialsById.get(item.materialId);
    const machine = machineByType.get(item.machineType);
    if (!material || !machine) {
      continue;
    }

    const hourlyRate =
      electricityOverride != null && machine.depreciationPerH != null
        ? calculateMachineHourlyRate({
            depreciationPerH: machine.depreciationPerH,
            powerKw: machine.powerKw ?? 0,
            electricityRatePerKwh: effectiveElecRate,
          })
        : machine.hourlyRate ?? DEFAULT_VIRTUAL_RATES[machine.type] ?? 120;

    const failureRate = settings.failureRates?.[item.machineType] ?? 0;
    const setupMin = item.setupMin ?? settings.setupDefaults?.baseMinutes?.[item.machineType] ?? 15;

    const calc = calculateItemCost(
      {
        qty: item.qty,
        usage: item.usage,
        runTimeH: item.runTimeH,
        setupTimeH: setupMin / 60,
        batchShare: item.batchShare ?? 1,
        prepH: item.prepH ?? 0,
        postProcessH: item.postProcessH ?? 0,
        isRush: Boolean(order.isRush ?? item.isRush),
      },
      {
        pricePerUnit: material.pricePerUnit,
        wastePct: material.wastePct ?? 0,
        unit: material.unit ?? 'од.',
      },
      { hourlyRate },
      {
        laborRate: settings.laborRate ?? 300,
        failureRate,
        overheadPct: settings.overheadPct ?? 0,
        marginPct: settings.marginPct ?? 0,
        rushSurcharge: settings.rushSurcharge ?? 0,
        taxPct: settings.taxPct ?? 0,
        electricityRatePerKwh: effectiveElecRate,
        volumeDiscounts: settings.volumeDiscounts ?? [],
      }
    );

    itemResults.push(calc);
  }

  if (itemResults.length === 0) {
    return {
      totalCost: 0,
      totalPrice: 0,
      priceBeforeTax: 0,
      estimatedProfit: 0,
      marginPctOfPrice: 0,
    };
  }

  const totals = calculateOrderTotals(itemResults);
  return {
    totalCost: totals.cost,
    totalPrice: totals.price,
    priceBeforeTax: totals.priceBeforeTax,
    estimatedProfit: totals.estimatedProfit,
    marginPctOfPrice: totals.marginPctOfPrice,
  };
}

function roundDelta(val, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/**
 * Pure What-If simulation: compares current baseline workshop plan & financials
 * against hypothetical capacity, algorithm parameters, batch splitting, or tariff changes.
 */
export function simulateWhatIf({
  jobs = [],
  machines = [],
  rules = DEFAULT_SETUP_RULES,
  items = [],
  materialsById = new Map(),
  baseSettings = {},
  locked = [],
  startTime,
  scenario = {},
} = {}) {
  const baseK1 = baseSettings.atcsK1 ?? 2.0;
  const baseK2 = baseSettings.atcsK2 ?? 0.5;

  const baselinePlan = schedule(jobs, machines, rules, {
    rule: 'ATCS',
    k1: baseK1,
    k2: baseK2,
    startTime,
    locked,
    enableBatchSplit: false,
  });

  const simRule = scenario.rule ?? 'ATCS';
  const simK1 = scenario.k1 ?? baseK1;
  const simK2 = scenario.k2 ?? baseK2;
  const enableBatchSplit = Boolean(scenario.enableBatchSplit);
  const simLocked = scenario.ignoreLocks ? [] : locked;
  const simMachines = buildVirtualMachines(machines, scenario.extraMachines);

  const simulatedPlan = schedule(jobs, simMachines, rules, {
    rule: simRule,
    k1: simK1,
    k2: simK2,
    startTime,
    locked: simLocked,
    enableBatchSplit,
  });

  const simSettings = {
    ...baseSettings,
    ...(scenario.marginPct !== undefined ? { marginPct: scenario.marginPct } : {}),
    ...(scenario.laborRate !== undefined ? { laborRate: scenario.laborRate } : {}),
    ...(scenario.electricityRatePerKwh !== undefined
      ? { electricityRatePerKwh: scenario.electricityRatePerKwh }
      : {}),
    ...(scenario.rushSurcharge !== undefined ? { rushSurcharge: scenario.rushSurcharge } : {}),
  };

  const baselineFinance = computeQueueFinance(items, machines, materialsById, baseSettings, null);
  const simulatedFinance = computeQueueFinance(
    items,
    simMachines,
    materialsById,
    simSettings,
    scenario.electricityRatePerKwh ?? null
  );

  const bm = baselinePlan.metrics;
  const sm = simulatedPlan.metrics;
  const virtualMachines = simMachines.filter((m) => m.isVirtual).map(({ id, name, type, hourlyRate }) => ({
    id,
    name,
    type,
    hourlyRate,
  }));

  return {
    baseline: {
      metrics: bm,
      finance: baselineFinance,
      machineCount: machines.length,
    },
    simulated: {
      metrics: sm,
      finance: simulatedFinance,
      machineCount: simMachines.length,
      rule: simRule,
      k1: simK1,
      k2: simK2,
      enableBatchSplit,
      batchSplitEntriesCount: simulatedPlan.entries.filter((e) => e.batchQty != null).length,
      virtualMachines,
    },
    delta: {
      lateCount: sm.lateCount - bm.lateCount,
      totalTardinessMin: sm.totalTardinessMin - bm.totalTardinessMin,
      totalSetupMin: sm.totalSetupMin - bm.totalSetupMin,
      makespanMin: sm.makespanMin - bm.makespanMin,
      avgUtilization: roundDelta(sm.avgUtilization - bm.avgUtilization, 4),
      totalCost: roundDelta(simulatedFinance.totalCost - baselineFinance.totalCost),
      totalPrice: roundDelta(simulatedFinance.totalPrice - baselineFinance.totalPrice),
      estimatedProfit: roundDelta(
        simulatedFinance.estimatedProfit - baselineFinance.estimatedProfit
      ),
    },
  };
}
