import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP_RULES } from '../../domain/setup.js';
import { simulateWhatIf } from '../../domain/whatIf.js';

const T0 = '2026-05-04T09:00:00.000Z';

describe('whatIf domain simulation', () => {
  const machines = [
    {
      id: 'm1',
      name: 'FDM #1',
      type: 'fdm_3d',
      hourlyRate: 90,
      depreciationPerH: 85,
      powerKw: 0.4,
      calendar: null,
      maintenanceWindows: [],
    },
  ];

  const materialsById = new Map([
    [
      'mat-pla',
      {
        id: 'mat-pla',
        code: 'PLA',
        pricePerUnit: 600,
        wastePct: 0.1,
        unit: 'кг',
      },
    ],
  ]);

  const baseSettings = {
    laborRate: 300,
    electricityRatePerKwh: 4.32,
    overheadPct: 0.15,
    marginPct: 0.3,
    rushSurcharge: 0.25,
    taxPct: 0.05,
    failureRates: { fdm_3d: 0.05 },
    volumeDiscounts: [],
    atcsK1: 2,
    atcsK2: 0.5,
  };

  const jobs = [
    {
      id: 'j1',
      orderId: 'o1',
      machineType: 'fdm_3d',
      material: 'PLA',
      qty: 4,
      processingTimeMin: 180,
      deadline: '2026-05-04T13:00:00.000Z',
      priority: 1,
    },
    {
      id: 'j2',
      orderId: 'o2',
      machineType: 'fdm_3d',
      material: 'ABS',
      qty: 2,
      processingTimeMin: 180,
      deadline: '2026-05-04T14:00:00.000Z',
      priority: 2,
    },
  ];

  const items = [
    {
      order: { isRush: false },
      item: {
        id: 'j1',
        machineType: 'fdm_3d',
        materialId: 'mat-pla',
        qty: 4,
        usage: 0.2,
        runTimeH: 0.75,
        prepH: 0.25,
        postProcessH: 0.25,
        setupMin: 15,
      },
    },
  ];

  it('reduces makespan and tardiness when adding virtual machines without mutating inputs', () => {
    const jobsSnap = structuredClone(jobs);
    const machinesSnap = structuredClone(machines);

    const res = simulateWhatIf({
      jobs: jobsSnap,
      machines: machinesSnap,
      rules: DEFAULT_SETUP_RULES,
      items,
      materialsById,
      baseSettings,
      startTime: T0,
      scenario: {
        extraMachines: { fdm_3d: 1 },
        enableBatchSplit: false,
      },
    });

    expect(res.baseline.machineCount).toBe(1);
    expect(res.simulated.machineCount).toBe(2);
    expect(res.simulated.virtualMachines).toHaveLength(1);
    expect(res.delta.makespanMin).toBeLessThan(0);
    expect(res.delta.totalTardinessMin).toBeLessThan(0);
    expect(jobsSnap).toEqual(jobs);
    expect(machinesSnap).toEqual(machines);
  });

  it('recalculates revenue and profit deltas when margin and electricity tariffs change', () => {
    const res = simulateWhatIf({
      jobs,
      machines,
      rules: DEFAULT_SETUP_RULES,
      items,
      materialsById,
      baseSettings,
      startTime: T0,
      scenario: {
        marginPct: 0.45,
        electricityRatePerKwh: 8.5,
      },
    });

    expect(res.simulated.finance.totalPrice).toBeGreaterThan(res.baseline.finance.totalPrice);
    expect(res.delta.estimatedProfit).toBeGreaterThan(0);
    expect(res.delta.totalCost).not.toBe(0);
  });
});
