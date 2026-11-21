import { performance } from 'node:perf_hooks';
import {
  DEFAULT_CALENDAR,
  advanceWorkTime,
  schedule,
} from '../server/src/domain/index.js';

const SEED = 20261121;
const T0 = '2026-11-23T09:00:00.000Z';
const RUNS_PER_SIZE = 30;
const SIZES = [20, 50, 100];

const MACHINE_CATALOG = [
  { id: 'm-fdm', type: 'fdm_3d', calendar: DEFAULT_CALENDAR },
  { id: 'm-laser', type: 'laser', calendar: DEFAULT_CALENDAR },
  { id: 'm-cnc', type: 'cnc_wood', calendar: DEFAULT_CALENDAR },
  { id: 'm-resin', type: 'resin_3d', calendar: DEFAULT_CALENDAR },
];

const MATERIALS_BY_TYPE = {
  fdm_3d: ['PLA', 'PETG', 'ABS', 'TPU'],
  resin_3d: ['RESIN_STD', 'RESIN_TOUGH'],
  laser: ['PLY_4', 'ACRYLIC_3', 'MDF_6'],
  cnc_wood: ['OAK_20', 'ASH_20', 'PINE_18'],
};

const COLORS = ['black', 'white', 'grey', 'natural'];
const TOOLS_BY_TYPE = {
  fdm_3d: ['0.4mm', '0.6mm'],
  resin_3d: ['0.03mm'],
  laser: ['2in', '1.5in'],
  cnc_wood: ['6mm_ball', '3mm_flat'],
};

const REALISTIC_RULES = {
  baseMinutes: { fdm_3d: 10, resin_3d: 12, laser: 5, cnc_wood: 15 },
  warmupMinutes: { fdm_3d: 15, resin_3d: 10, laser: 5, cnc_wood: 10 },
  colorChangeMinutes: { fdm_3d: 8, resin_3d: 10, laser: 0, cnc_wood: 5 },
  toolChangeMinutes: { fdm_3d: 20, resin_3d: 15, laser: 10, cnc_wood: 15 },
  defaultMaterialChangeMinutes: { fdm_3d: 15, resin_3d: 25, laser: 8, cnc_wood: 10 },
  materialMatrix: {
    fdm_3d: {
      PLA: { PETG: 15, ABS: 60, TPU: 25 },
      PETG: { PLA: 20, ABS: 45, TPU: 30 },
      ABS: { PLA: 60, PETG: 40, TPU: 50 },
      TPU: { PLA: 35, PETG: 30, ABS: 45 },
    },
    resin_3d: {
      RESIN_STD: { RESIN_TOUGH: 30 },
      RESIN_TOUGH: { RESIN_STD: 35 },
    },
    laser: {
      PLY_4: { ACRYLIC_3: 25, MDF_6: 15 },
      ACRYLIC_3: { PLY_4: 20, MDF_6: 25 },
      MDF_6: { PLY_4: 15, ACRYLIC_3: 25 },
    },
    cnc_wood: {
      OAK_20: { PINE_18: 20, ASH_20: 15 },
      ASH_20: { OAK_20: 15, PINE_18: 20 },
      PINE_18: { OAK_20: 30, ASH_20: 25 },
    },
  },
};

function scaleSetupRules(rules, factor) {
  const scaleObj = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * factor)]));

  const scaledMatrix = {};
  for (const [mType, fromMap] of Object.entries(rules.materialMatrix)) {
    scaledMatrix[mType] = {};
    for (const [from, toMap] of Object.entries(fromMap)) {
      scaledMatrix[mType][from] = scaleObj(toMap);
    }
  }

  return {
    baseMinutes: scaleObj(rules.baseMinutes),
    warmupMinutes: scaleObj(rules.warmupMinutes),
    colorChangeMinutes: scaleObj(rules.colorChangeMinutes),
    toolChangeMinutes: scaleObj(rules.toolChangeMinutes),
    defaultMaterialChangeMinutes: scaleObj(rules.defaultMaterialChangeMinutes),
    materialMatrix: scaledMatrix,
  };
}

/**
 * Deterministic Mulberry32 PRNG for reproducible benchmark generation.
 */
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function generateInstance(rng, jobCount, machineCount) {
  const machines = MACHINE_CATALOG.slice(0, machineCount);
  const rawJobs = [];
  const loadByType = new Map(machines.map((m) => [m.type, 0]));

  for (let i = 0; i < jobCount; i += 1) {
    const machine = pick(rng, machines);
    const material = pick(rng, MATERIALS_BY_TYPE[machine.type]);
    const color = pick(rng, COLORS);
    const tool = pick(rng, TOOLS_BY_TYPE[machine.type]);
    const processingTimeMin = 30 + Math.floor(rng() * 15) * 15; // 30..240 min in 15m steps
    const priority = pick(rng, [1, 1, 1, 2, 2, 3]);

    loadByType.set(machine.type, (loadByType.get(machine.type) ?? 0) + processingTimeMin + 25);
    rawJobs.push({
      id: `J-${i + 1}`,
      orderId: `ORD-${i + 1}`,
      machineType: machine.type,
      material,
      color,
      tool,
      processingTimeMin,
      priority,
    });
  }

  const jobs = rawJobs.map((job) => {
    const typeLoad = Math.max(240, loadByType.get(job.machineType) ?? 480);
    // Due dates span a realistic tight-to-moderate window around expected machine load.
    const dueWorkMin = Math.max(
      job.processingTimeMin + 45,
      Math.round(typeLoad * (0.35 + rng() * 0.75))
    );
    const deadline = new Date(advanceWorkTime(T0, dueWorkMin, DEFAULT_CALENDAR)).toISOString();
    return { ...job, deadline };
  });

  return { jobs, machines };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarizeRuns(runsByStrategy) {
  const summary = {};
  for (const [label, rows] of Object.entries(runsByStrategy)) {
    const stat = (key) => ({
      mean: Number(mean(rows.map((r) => r[key])).toFixed(2)),
      median: Number(median(rows.map((r) => r[key])).toFixed(2)),
    });
    summary[label] = {
      lateCount: stat('lateCount'),
      totalTardinessMin: stat('totalTardinessMin'),
      totalSetupMin: stat('totalSetupMin'),
      makespanMin: stat('makespanMin'),
      runtimeMs: stat('runtimeMs'),
    };
  }
  return summary;
}

function runMainBenchmark() {
  const rng = createRng(SEED);
  const results = {};

  for (const n of SIZES) {
    const byStrategy = { FIFO: [], EDD: [], SPT: [], ATCS: [] };

    for (let run = 0; run < RUNS_PER_SIZE; run += 1) {
      // Distribute evenly across 2, 3, 4 machines (10 runs each per size).
      const machineCount = 2 + (run % 3);
      const { jobs, machines } = generateInstance(rng, n, machineCount);

      for (const rule of ['FIFO', 'EDD', 'SPT', 'ATCS']) {
        const tStart = performance.now();
        const res = schedule(jobs, machines, REALISTIC_RULES, {
          rule,
          startTime: T0,
          k1: 2.0,
          k2: 0.5,
        });
        const elapsedMs = performance.now() - tStart;

        byStrategy[rule].push({
          lateCount: res.metrics.lateCount,
          totalTardinessMin: res.metrics.totalTardinessMin,
          totalSetupMin: res.metrics.totalSetupMin,
          makespanMin: res.metrics.makespanMin,
          runtimeMs: elapsedMs,
        });
      }
    }

    results[n] = summarizeRuns(byStrategy);
  }

  return results;
}

function runSensitivityAndRegimes() {
  const rng = createRng(SEED + 999);
  const configs = [
    { label: 'EDD', rule: 'EDD' },
    { label: 'SPT', rule: 'SPT' },
    { label: 'ATCS(1.5, 0.3)', rule: 'ATCS', k1: 1.5, k2: 0.3 },
    { label: 'ATCS(2.0, 0.5)', rule: 'ATCS', k1: 2.0, k2: 0.5 },
    { label: 'ATCS(3.0, 1.0)', rule: 'ATCS', k1: 3.0, k2: 1.0 },
    { label: 'ATCS(1.5, 2.0)', rule: 'ATCS', k1: 1.5, k2: 2.0 },
  ];

  const lowSetupRules = scaleSetupRules(REALISTIC_RULES, 0.2);
  const highSetupRuns = Object.fromEntries(configs.map((c) => [c.label, []]));
  const lowSetupRuns = Object.fromEntries(configs.map((c) => [c.label, []]));

  for (let run = 0; run < RUNS_PER_SIZE; run += 1) {
    const { jobs, machines } = generateInstance(rng, 50, 3);
    for (const cfg of configs) {
      for (const [target, ruleset] of [
        [highSetupRuns, REALISTIC_RULES],
        [lowSetupRuns, lowSetupRules],
      ]) {
        const tStart = performance.now();
        const res = schedule(jobs, machines, ruleset, {
          rule: cfg.rule,
          k1: cfg.k1,
          k2: cfg.k2,
          startTime: T0,
        });
        target[cfg.label].push({
          lateCount: res.metrics.lateCount,
          totalTardinessMin: res.metrics.totalTardinessMin,
          totalSetupMin: res.metrics.totalSetupMin,
          makespanMin: res.metrics.makespanMin,
          runtimeMs: performance.now() - tStart,
        });
      }
    }
  }

  return {
    highSetup: summarizeRuns(highSetupRuns),
    lowSetup: summarizeRuns(lowSetupRuns),
  };
}

function formatStat(s) {
  return `${s.mean.toFixed(1)} / ${s.median.toFixed(1)}`;
}

function printTable(title, summaryMap) {
  console.log(`\n=== ${title} (mean / median) ===`);
  console.log(
    'Strategy'.padEnd(16) +
      'Late'.padEnd(14) +
      'Tardiness(m)'.padEnd(18) +
      'Setup(m)'.padEnd(16) +
      'Makespan(m)'.padEnd(18) +
      'Time(ms)'
  );
  for (const [label, s] of Object.entries(summaryMap)) {
    console.log(
      label.padEnd(16) +
        formatStat(s.lateCount).padEnd(14) +
        formatStat(s.totalTardinessMin).padEnd(18) +
        formatStat(s.totalSetupMin).padEnd(16) +
        formatStat(s.makespanMin).padEnd(18) +
        `${s.runtimeMs.mean.toFixed(2)} / ${s.runtimeMs.median.toFixed(2)}`
    );
  }
}

const mainResults = runMainBenchmark();
console.log(`Reproducible Scheduler Benchmark (Mulberry32 seed=${SEED}, ${RUNS_PER_SIZE} runs/size, 2-4 machines)`);
for (const n of SIZES) {
  printTable(`n=${n} jobs`, mainResults[n]);
}

const sensitivity = runSensitivityAndRegimes();
printTable('Sensitivity n=50, m=3 — Realistic Setup (x1.0)', sensitivity.highSetup);
printTable('Sensitivity n=50, m=3 — Low Setup (x0.2)', sensitivity.lowSetup);
