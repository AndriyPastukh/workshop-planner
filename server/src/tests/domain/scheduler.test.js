import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../domain/calendar.js';
import { compareStrategies, schedule } from '../../domain/scheduler.js';

const T0 = '2026-05-04T09:00:00.000Z';

function addMinutesIso(baseIso, minutes) {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
}

const EXAMPLE_3_RULES = {
  baseMinutes: { fdm_3d: 10 },
  warmupMinutes: { fdm_3d: 10 },
  colorChangeMinutes: { fdm_3d: 0 },
  toolChangeMinutes: { fdm_3d: 0 },
  defaultMaterialChangeMinutes: { fdm_3d: 60 },
  materialMatrix: {
    fdm_3d: {
      PLA: { ABS: 60 },
      ABS: { PLA: 60 },
    },
  },
};

const EXAMPLE_3_MACHINES = [{ id: 'm1', type: 'fdm_3d', calendar: null }];

const EXAMPLE_3_JOBS = [
  {
    id: 'J1',
    orderId: 'ORD-1',
    machineType: 'fdm_3d',
    material: 'PLA',
    processingTimeMin: 60,
    deadline: addMinutesIso(T0, 140),
    priority: 2,
  },
  {
    id: 'J2',
    orderId: 'ORD-2',
    machineType: 'fdm_3d',
    material: 'ABS',
    processingTimeMin: 60,
    deadline: addMinutesIso(T0, 210),
    priority: 1,
  },
  {
    id: 'J3',
    orderId: 'ORD-3',
    machineType: 'fdm_3d',
    material: 'PLA',
    processingTimeMin: 60,
    deadline: addMinutesIso(T0, 220),
    priority: 2,
  },
  {
    id: 'J4',
    orderId: 'ORD-4',
    machineType: 'fdm_3d',
    material: 'ABS',
    processingTimeMin: 60,
    deadline: addMinutesIso(T0, 360),
    priority: 1,
  },
];

describe('scheduler domain', () => {
  it('matches Example 3 reference metrics and confirms ATCS beats FIFO, EDD, and SPT', () => {
    const fifo = schedule(EXAMPLE_3_JOBS, EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, {
      rule: 'FIFO',
      startTime: T0,
    });
    const edd = schedule(EXAMPLE_3_JOBS, EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, {
      rule: 'EDD',
      startTime: T0,
    });
    const spt = schedule(EXAMPLE_3_JOBS, EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, {
      rule: 'SPT',
      startTime: T0,
    });
    const atcs = schedule(EXAMPLE_3_JOBS, EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, {
      rule: 'ATCS',
      k1: 2,
      k2: 0.5,
      startTime: T0,
    });

    for (const baseline of [fifo, edd, spt]) {
      expect(baseline.entries.map((e) => e.jobId)).toEqual(['J1', 'J2', 'J3', 'J4']);
      expect(baseline.metrics.lateCount).toBe(2);
      expect(baseline.metrics.totalTardinessMin).toBe(230);
      expect(baseline.metrics.totalSetupMin).toBe(230);
      expect(baseline.metrics.makespanMin).toBe(470);
    }

    expect(atcs.entries.map((e) => e.jobId)).toEqual(['J1', 'J3', 'J2', 'J4']);
    expect(atcs.metrics.lateCount).toBe(1);
    expect(atcs.metrics.totalTardinessMin).toBe(70);
    expect(atcs.metrics.totalSetupMin).toBe(110);
    expect(atcs.metrics.makespanMin).toBe(350);

    expect(atcs.metrics.lateCount).toBeLessThan(fifo.metrics.lateCount);
    expect(atcs.metrics.totalTardinessMin).toBeLessThan(edd.metrics.totalTardinessMin);
    expect(atcs.metrics.totalSetupMin).toBeLessThan(spt.metrics.totalSetupMin);
  });

  it('compares all 4 strategies without mutating caller inputs', () => {
    const jobsCopy = structuredClone(EXAMPLE_3_JOBS);
    const machinesCopy = structuredClone(EXAMPLE_3_MACHINES);

    const comparison = compareStrategies(jobsCopy, machinesCopy, EXAMPLE_3_RULES, {
      startTime: T0,
    });

    expect(Object.keys(comparison.strategies)).toEqual(['FIFO', 'EDD', 'SPT', 'ATCS']);
    expect(comparison.bestByTardiness).toBe('ATCS');
    expect(comparison.bestBySetup).toBe('ATCS');
    expect(jobsCopy).toEqual(EXAMPLE_3_JOBS);
    expect(machinesCopy).toEqual(EXAMPLE_3_MACHINES);
  });

  it('schedules across multiple heterogeneous machines and machine-specific durations', () => {
    const machines = [
      { id: 'fdm-1', type: 'fdm_3d', calendar: null },
      { id: 'fdm-2', type: 'fdm_3d', calendar: null },
      { id: 'laser-1', type: 'laser', calendar: null },
    ];
    const jobs = [
      {
        id: 'F1',
        orderId: 'O1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 90,
        processingTimeByMachine: { 'fdm-1': 90, 'fdm-2': 60 },
        deadline: addMinutesIso(T0, 150),
        priority: 1,
      },
      {
        id: 'F2',
        orderId: 'O2',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 150),
        priority: 1,
      },
      {
        id: 'L1',
        orderId: 'O3',
        machineType: 'laser',
        material: 'plywood',
        processingTimeMin: 30,
        deadline: addMinutesIso(T0, 90),
        priority: 1,
      },
    ];

    const res = schedule(jobs, machines, EXAMPLE_3_RULES, { rule: 'ATCS', startTime: T0 });
    expect(res.entries).toHaveLength(3);
    expect(res.unscheduled).toHaveLength(0);

    const f1 = res.entries.find((e) => e.jobId === 'F1');
    const f2 = res.entries.find((e) => e.jobId === 'F2');
    const l1 = res.entries.find((e) => e.jobId === 'L1');
    expect(f1.machineId).not.toBe(f2.machineId);
    expect(l1.machineId).toBe('laser-1');
  });

  it('respects working calendar shift boundaries and adds overnight warmup', () => {
    const machines = [{ id: 'm1', type: 'fdm_3d', calendar: DEFAULT_CALENDAR }];
    const friAfternoon = '2026-05-08T16:00:00.000Z';
    const jobs = [
      {
        id: 'W1',
        orderId: 'OW1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 180,
        deadline: '2026-05-11T16:00:00.000Z',
        priority: 1,
      },
      {
        id: 'W2',
        orderId: 'OW2',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: '2026-05-11T16:00:00.000Z',
        priority: 1,
      },
    ];

    const res = schedule(jobs, machines, EXAMPLE_3_RULES, { rule: 'FIFO', startTime: friAfternoon });
    const w1 = res.entries.find((e) => e.jobId === 'W1');
    const w2 = res.entries.find((e) => e.jobId === 'W2');

    // W1 setup: 20m (16:00..16:20), remaining Fri shift: 100m -> 80m left on Mon 09:00..10:20
    expect(w1.setupStart).toBe('2026-05-08T16:00:00.000Z');
    expect(w1.end).toBe('2026-05-11T10:20:00.000Z');
    // W2 runs on Monday same day (10:20..), base setup 10m -> ends 11:30
    expect(w2.setupStart).toBe('2026-05-11T10:20:00.000Z');
    expect(w2.setupMin).toBe(10);
    expect(w2.end).toBe('2026-05-11T11:30:00.000Z');
  });

  it('preserves locked jobs, fills gaps before them, and schedules after them using their material', () => {
    const jobs = [
      {
        id: 'LOCKED_ABS',
        orderId: 'OL',
        machineType: 'fdm_3d',
        material: 'ABS',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 200),
        priority: 1,
      },
      {
        id: 'FIT_BEFORE',
        orderId: 'O1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 40,
        deadline: addMinutesIso(T0, 250),
        priority: 1,
      },
      {
        id: 'TOO_LONG',
        orderId: 'O2',
        machineType: 'fdm_3d',
        material: 'ABS',
        processingTimeMin: 90,
        deadline: addMinutesIso(T0, 350),
        priority: 2,
      },
    ];

    const locked = [
      {
        jobId: 'LOCKED_ABS',
        machineId: 'm1',
        setupStart: addMinutesIso(T0, 90),
        setupEnd: addMinutesIso(T0, 100),
        start: addMinutesIso(T0, 100),
        end: addMinutesIso(T0, 160),
        setupMin: 10,
      },
    ];

    const res = schedule(jobs, EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, {
      rule: 'ATCS',
      startTime: T0,
      locked,
    });

    const lockedEntry = res.entries.find((e) => e.jobId === 'LOCKED_ABS');
    const fitBefore = res.entries.find((e) => e.jobId === 'FIT_BEFORE');
    const tooLong = res.entries.find((e) => e.jobId === 'TOO_LONG');

    expect(lockedEntry.locked).toBe(true);
    expect(lockedEntry.start).toBe(addMinutesIso(T0, 100));
    expect(lockedEntry.end).toBe(addMinutesIso(T0, 160));

    // FIT_BEFORE takes [0..60] before the locked block [90..160]
    expect(fitBefore.setupStart).toBe(T0);
    expect(fitBefore.end).toBe(addMinutesIso(T0, 60));

    // TOO_LONG jumps past locked block at +160 and shares ABS with LOCKED_ABS -> base setup 10 min
    expect(tooLong.setupStart).toBe(addMinutesIso(T0, 160));
    expect(tooLong.setupMin).toBe(10);
    expect(tooLong.end).toBe(addMinutesIso(T0, 260));
  });

  it('handles edge cases: empty queues, no machines, ineligible jobs, impossible deadlines, zero setups', () => {
    expect(schedule([], EXAMPLE_3_MACHINES, EXAMPLE_3_RULES, { startTime: T0 }).metrics).toEqual({
      totalJobs: 0,
      scheduledJobs: 0,
      unscheduledJobs: 0,
      lateCount: 0,
      totalTardinessMin: 0,
      maxTardinessMin: 0,
      totalSetupMin: 0,
      totalProcessingMin: 0,
      makespanMin: 0,
      utilizationByMachine: { m1: 0 },
      avgUtilization: 0,
    });

    const noMachinesRes = schedule(EXAMPLE_3_JOBS, [], EXAMPLE_3_RULES, { startTime: T0 });
    expect(noMachinesRes.entries).toHaveLength(0);
    expect(noMachinesRes.unscheduled).toHaveLength(4);

    // Zero setup rules (sBar === 0 guard in ATCS) + unschedulable job + impossible deadlines
    const zeroSetupRules = {
      baseMinutes: { fdm_3d: 0 },
      warmupMinutes: { fdm_3d: 0 },
      colorChangeMinutes: { fdm_3d: 0 },
      toolChangeMinutes: { fdm_3d: 0 },
      defaultMaterialChangeMinutes: { fdm_3d: 0 },
      materialMatrix: {},
    };
    const mixedJobs = [
      {
        id: 'OK1',
        orderId: 'O1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 10), // already impossible
        priority: 1,
      },
      {
        id: 'OK2',
        orderId: 'O2',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 20), // already impossible
        priority: 1,
      },
      {
        id: 'BAD_TYPE',
        orderId: 'O3',
        machineType: 'cnc_wood',
        material: 'oak',
        processingTimeMin: 30,
        deadline: addMinutesIso(T0, 200),
        priority: 1,
      },
    ];

    const edgeRes = schedule(mixedJobs, EXAMPLE_3_MACHINES, zeroSetupRules, {
      rule: 'ATCS',
      startTime: T0,
    });
    expect(edgeRes.entries).toHaveLength(2);
    expect(edgeRes.unscheduled).toEqual([
      { jobId: 'BAD_TYPE', orderId: 'O3', reason: 'NO_ELIGIBLE_MACHINE' },
    ]);
    expect(edgeRes.metrics.totalSetupMin).toBe(0);
    expect(edgeRes.metrics.lateCount).toBe(2);
    expect(edgeRes.metrics.totalTardinessMin).toBe((60 - 10) + (120 - 20));

    // Unsupported rule throws
    expect(() => schedule([], EXAMPLE_3_MACHINES, zeroSetupRules, { rule: 'RANDOM' })).toThrow();

    // EligibleMachineIds filtering, inline job.locked flag, and SPT/EDD tie-breaks
    const twoMachines = [
      { id: 'm1', type: 'fdm_3d', calendar: null },
      { id: 'm2', type: 'fdm_3d', calendar: null },
    ];
    const constrainedJobs = [
      {
        id: 'L_INLINE',
        orderId: 'O1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 30,
        deadline: addMinutesIso(T0, 100),
        priority: 1,
        locked: true,
        machineId: 'm1',
        start: T0,
        end: addMinutesIso(T0, 30),
      },
      {
        id: 'ONLY_M2',
        orderId: 'O2',
        eligibleMachineIds: ['m2'],
        material: 'PLA',
        processingTimeMin: 20,
        deadline: addMinutesIso(T0, 80),
        priority: 1,
      },
      {
        id: 'SHORT_LATE',
        orderId: 'O3',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 20,
        deadline: addMinutesIso(T0, 120),
        priority: 1,
      },
    ];
    const constrainedRes = compareStrategies(constrainedJobs, twoMachines, zeroSetupRules, {
      startTime: T0,
    });
    expect(constrainedRes.schedules.SPT.entries.find((e) => e.jobId === 'ONLY_M2').machineId).toBe(
      'm2'
    );
    expect(constrainedRes.schedules.EDD.entries.find((e) => e.jobId === 'L_INLINE').locked).toBe(
      true
    );
  });
});
