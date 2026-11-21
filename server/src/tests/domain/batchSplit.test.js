import { describe, expect, it } from 'vitest';
import { expandJobsWithBatchSplit, splitJobIntoBatches } from '../../domain/batchSplit.js';
import { schedule } from '../../domain/scheduler.js';

const T0 = '2026-05-04T09:00:00.000Z';

const ZERO_SETUP_RULES = {
  baseMinutes: { fdm_3d: 5 },
  warmupMinutes: { fdm_3d: 5 },
  colorChangeMinutes: { fdm_3d: 0 },
  toolChangeMinutes: { fdm_3d: 0 },
  defaultMaterialChangeMinutes: { fdm_3d: 10 },
  materialMatrix: {},
};

const TWO_FDM_MACHINES = [
  { id: 'fdm-1', type: 'fdm_3d', calendar: null },
  { id: 'fdm-2', type: 'fdm_3d', calendar: null },
];

describe('batchSplit domain', () => {
  it('splits large integer jobs evenly across parallel compatible machines', () => {
    const job = {
      id: 'item-1',
      orderId: 'ord-1',
      machineType: 'fdm_3d',
      material: 'PLA',
      qty: 5,
      processingTimeMin: 250,
      deadline: '2026-05-04T18:00:00.000Z',
      priority: 1,
    };

    const batches = splitJobIntoBatches(job, TWO_FDM_MACHINES);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({
      id: 'item-1::b1',
      parentJobId: 'item-1',
      batchIndex: 1,
      batchQty: 3,
      qty: 3,
      processingTimeMin: 150,
    });
    expect(batches[1]).toMatchObject({
      id: 'item-1::b2',
      parentJobId: 'item-1',
      batchIndex: 2,
      batchQty: 2,
      qty: 2,
      processingTimeMin: 100,
    });
  });

  it('keeps small, locked, non-integer, or single-machine jobs unsplit', () => {
    const small = { id: 's1', machineType: 'fdm_3d', qty: 3, processingTimeMin: 90 };
    expect(splitJobIntoBatches(small, TWO_FDM_MACHINES)).toEqual([small]);

    const locked = { id: 'l1', machineType: 'fdm_3d', qty: 6, processingTimeMin: 180, locked: true };
    expect(splitJobIntoBatches(locked, TWO_FDM_MACHINES)).toEqual([locked]);

    const large = { id: 'x1', machineType: 'fdm_3d', qty: 6, processingTimeMin: 180 };
    expect(splitJobIntoBatches(large, [TWO_FDM_MACHINES[0]])).toEqual([large]);

    const mixed = expandJobsWithBatchSplit([small, large], TWO_FDM_MACHINES);
    expect(mixed).toHaveLength(3);
  });

  it('reduces makespan when enableBatchSplit is active across parallel machines', () => {
    const jobs = [
      {
        id: 'BIG_JOB',
        orderId: 'ORD-B',
        machineType: 'fdm_3d',
        material: 'PLA',
        qty: 6,
        processingTimeMin: 240,
        deadline: '2026-05-04T18:00:00.000Z',
        priority: 1,
      },
    ];

    const single = schedule(jobs, TWO_FDM_MACHINES, ZERO_SETUP_RULES, {
      rule: 'ATCS',
      startTime: T0,
      enableBatchSplit: false,
    });
    const split = schedule(jobs, TWO_FDM_MACHINES, ZERO_SETUP_RULES, {
      rule: 'ATCS',
      startTime: T0,
      enableBatchSplit: true,
    });

    expect(single.entries).toHaveLength(1);
    expect(split.entries).toHaveLength(2);
    expect(new Set(split.entries.map((e) => e.machineId)).size).toBe(2);
    expect(split.entries.map((e) => e.batchIndex).sort()).toEqual([1, 2]);
    expect(split.entries.reduce((sum, e) => sum + e.batchQty, 0)).toBe(6);
    expect(split.metrics.makespanMin).toBeLessThan(single.metrics.makespanMin);
  });
});
