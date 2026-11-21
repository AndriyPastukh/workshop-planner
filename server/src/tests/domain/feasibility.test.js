import { describe, expect, it } from 'vitest';
import {
  calculateItemCost,
  checkFeasibility,
  compareStrategies,
  schedule,
  setupTime,
  snapToWorkTime,
} from '../../domain/index.js';

const T0 = '2026-05-04T09:00:00.000Z';

function addMinutesIso(baseIso, minutes) {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
}

const RULES = {
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

const MACHINES = [{ id: 'm1', type: 'fdm_3d', calendar: null }];

describe('feasibility domain', () => {
  it('returns ACCEPT_STANDARD when new order fits without delaying existing orders', () => {
    const currentJobs = [
      {
        id: 'J1',
        orderId: 'ORD-1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 180),
        priority: 1,
      },
      {
        id: 'J2',
        orderId: 'ORD-2',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 300),
        priority: 1,
      },
    ];

    const newOrder = {
      id: 'ORD-NEW',
      deadline: addMinutesIso(T0, 300),
      priority: 1,
      items: [{ id: 'N1', machineType: 'fdm_3d', material: 'PLA', processingTimeMin: 60 }],
    };

    const res = checkFeasibility(currentJobs, newOrder, MACHINES, RULES, { startTime: T0 });

    expect(res.feasible).toBe(true);
    expect(res.recommendation).toBe('ACCEPT_STANDARD');
    expect(res.meetsDeadline).toBe(true);
    expect(res.tardinessMin).toBe(0);
    expect(res.earliestFinish).toBe(addMinutesIso(T0, 220));
    expect(res.newlyDelayedOrders).toEqual([]);
    expect(res.recommendedRushSurcharge).toBe(0);
  });

  it('returns ACCEPT_WITH_RUSH when rush priority meets tight deadline and reports impacted orders', () => {
    const currentJobs = [
      {
        id: 'J1',
        orderId: 'ORD-1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 80),
        priority: 3,
      },
      {
        id: 'J2',
        orderId: 'ORD-2',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 150),
        priority: 2,
      },
    ];

    // Under normal priority=1: J1 [0..80] -> J2 [80..150] -> ORD-RUSH [150..220] (> +160, late)
    // Under rush priority: J1 [0..80] -> ORD-RUSH [80..150] (<= +160) -> J2 [150..220] (delayed)
    const newOrder = {
      id: 'ORD-RUSH',
      deadline: addMinutesIso(T0, 160),
      priority: 1,
      items: [{ id: 'NR1', machineType: 'fdm_3d', material: 'PLA', processingTimeMin: 60 }],
    };

    const res = checkFeasibility(currentJobs, newOrder, MACHINES, RULES, { startTime: T0 });

    expect(res.feasible).toBe(true);
    expect(res.meetsDeadline).toBe(false);
    expect(res.meetsDeadlineWithRush).toBe(true);
    expect(res.recommendation).toBe('ACCEPT_WITH_RUSH');
    expect(res.earliestFinish).toBe(addMinutesIso(T0, 220));
    expect(res.rushEarliestFinish).toBe(addMinutesIso(T0, 150));
    expect(res.recommendedRushSurcharge).toBeGreaterThan(0);
    expect(res.newlyDelayedOrders.some((d) => d.orderId === 'ORD-2')).toBe(true);
    expect(res.shiftedOrders.some((s) => s.orderId === 'ORD-2')).toBe(true);
  });

  it('returns NEGOTIATE_DEADLINE and proposes realistic suggestedDeadline when impossible even with rush', () => {
    const currentJobs = [
      {
        id: 'J1',
        orderId: 'ORD-1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 180),
        priority: 1,
      },
    ];

    const newOrder = {
      id: 'ORD-HUGE',
      deadline: addMinutesIso(T0, 120),
      priority: 1,
      items: [{ id: 'NH1', machineType: 'fdm_3d', material: 'PLA', processingTimeMin: 300 }],
    };

    const res = checkFeasibility(currentJobs, newOrder, MACHINES, RULES, { startTime: T0 });

    expect(res.feasible).toBe(true);
    expect(res.meetsDeadline).toBe(false);
    expect(res.meetsDeadlineWithRush).toBe(false);
    expect(res.recommendation).toBe('NEGOTIATE_DEADLINE');
    expect(res.recommendedRushSurcharge).toBeNull();
    expect(Date.parse(res.suggestedDeadline)).toBeGreaterThan(Date.parse(newOrder.deadline));
  });

  it('returns INFEASIBLE when no machine supports the requested item type', () => {
    const res = checkFeasibility(
      [],
      {
        id: 'ORD-CNC',
        deadline: addMinutesIso(T0, 300),
        items: [{ id: 'C1', machineType: 'cnc_wood', material: 'oak', processingTimeMin: 60 }],
      },
      MACHINES,
      RULES,
      { startTime: T0 }
    );

    expect(res.feasible).toBe(false);
    expect(res.meetsDeadline).toBe(false);
    expect(res.recommendation).toBe('INFEASIBLE');
    expect(res.earliestFinish).toBeNull();
    expect(res.recommendedRushSurcharge).toBeNull();
  });

  it('does not mutate currentJobs or newOrder objects', () => {
    const currentJobs = [
      {
        id: 'J1',
        orderId: 'ORD-1',
        machineType: 'fdm_3d',
        material: 'PLA',
        processingTimeMin: 60,
        deadline: addMinutesIso(T0, 200),
        priority: 1,
      },
    ];
    const newOrder = {
      id: 'ORD-2',
      deadline: addMinutesIso(T0, 250),
      priority: 1,
      items: [{ id: 'N1', machineType: 'fdm_3d', material: 'ABS', processingTimeMin: 60 }],
    };

    const jobsSnapshot = structuredClone(currentJobs);
    const orderSnapshot = structuredClone(newOrder);

    checkFeasibility(currentJobs, newOrder, MACHINES, RULES, { startTime: T0 });

    expect(currentJobs).toEqual(jobsSnapshot);
    expect(newOrder).toEqual(orderSnapshot);

    // Empty order items -> INFEASIBLE
    const emptyRes = checkFeasibility(
      currentJobs,
      { id: 'ORD-EMPTY', deadline: addMinutesIso(T0, 200), items: [] },
      MACHINES,
      RULES,
      { startTime: T0 }
    );
    expect(emptyRes.feasible).toBe(false);
    expect(emptyRes.recommendation).toBe('INFEASIBLE');

    // Barrel index exports check
    expect(typeof calculateItemCost).toBe('function');
    expect(typeof setupTime).toBe('function');
    expect(typeof snapToWorkTime).toBe('function');
    expect(typeof schedule).toBe('function');
    expect(typeof compareStrategies).toBe('function');
  });
});
