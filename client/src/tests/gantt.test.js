import { describe, expect, it } from 'vitest';
import {
  buildScheduleCsv,
  checkManualMoveConflict,
  computeGanttHorizon,
  layoutGanttLane,
} from '../lib/gantt.js';

const BASE_MS = Date.parse('2026-05-04T09:00:00.000Z');
const isoAt = (offsetMin) => new Date(BASE_MS + offsetMin * 60_000).toISOString();

describe('client gantt algorithms', () => {
  it('computes horizon bounds, ticks, and in-range nowPct marker', () => {
    const entries = [
      { id: 'e1', setupStart: isoAt(0), start: isoAt(15), end: isoAt(120) },
      { id: 'e2', setupStart: isoAt(120), start: isoAt(135), end: isoAt(300) },
    ];
    const machines = [{ id: 'm1', type: 'fdm_3d', maintenanceWindows: [] }];

    const horizon = computeGanttHorizon(entries, machines, BASE_MS + 150 * 60_000);
    expect(horizon.minMs).toBe(BASE_MS);
    expect(horizon.spanMs).toBe(8 * 3_600_000); // minimum 8h horizon enforced
    expect(horizon.ticks).toHaveLength(5);
    expect(horizon.nowPct).toBeCloseTo((150 / 480) * 100, 1);

    const outOfRange = computeGanttHorizon(entries, machines, BASE_MS - 60_000);
    expect(outOfRange.nowPct).toBeNull();
  });

  it('handles empty entries when computing fallback Gantt horizon', () => {
    const empty = computeGanttHorizon([], [], BASE_MS);
    expect(empty.minMs).toBe(BASE_MS);
    expect(empty.spanMs).toBe(8 * 3_600_000);
    expect(empty.nowPct).toBe(0);
  });

  it('lays out maintenance windows and job bars with batch badges and setup ratio', () => {
    const horizon = {
      minMs: BASE_MS,
      maxMs: BASE_MS + 480 * 60_000,
      spanMs: 480 * 60_000,
    };

    const lane = layoutGanttLane(
      [
        {
          id: 'e1',
          setupStart: isoAt(0),
          start: isoAt(20),
          end: isoAt(100),
          setupMin: 20,
          tardinessMin: 0,
          batchIndex: 1,
          batchQty: 3,
        },
        {
          id: 'e2',
          setupStart: isoAt(120),
          start: isoAt(120),
          end: isoAt(240),
          setupMin: 0,
          tardinessMin: 35,
          batchQty: null,
        },
      ],
      [{ id: 'mw1', title: 'ТО', start: isoAt(100), end: isoAt(120) }],
      horizon
    );

    expect(lane.maintenanceBars).toHaveLength(1);
    expect(lane.maintenanceBars[0].leftPct).toBeCloseTo((100 / 480) * 100, 2);

    expect(lane.entryBars).toHaveLength(2);
    expect(lane.entryBars[0]).toMatchObject({
      setupPct: 20,
      isLate: false,
      batchLabel: 'П1',
    });
    expect(lane.entryBars[1]).toMatchObject({
      setupPct: 0,
      isLate: true,
      batchLabel: null,
    });
  });

  it('detects machine type mismatch on manual move', () => {
    const machine = { id: 'laser-1', name: 'CO2 Лазер', type: 'laser', calendar: null };
    const entry = {
      id: 'e1',
      machineId: 'fdm-1',
      setupMin: 10,
      processingMin: 60,
      orderItem: { machineType: 'fdm_3d' },
    };

    const res = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: isoAt(30),
    });

    expect(res.hasHardConflict).toBe(true);
    expect(res.conflicts[0].code).toBe('MACHINE_TYPE_MISMATCH');
  });

  it('detects maintenance window and sibling overlaps as hard errors', () => {
    const machine = {
      id: 'm1',
      name: 'FDM #1',
      type: 'fdm_3d',
      calendar: null,
      maintenanceWindows: [{ id: 'mw1', title: 'Чистка', start: isoAt(60), end: isoAt(120) }],
    };
    const entry = {
      id: 'e1',
      machineId: 'm1',
      setupMin: 10,
      processingMin: 60,
      orderItem: { machineType: 'fdm_3d' },
    };
    const siblings = [
      {
        id: 'e2',
        machineId: 'm1',
        setupStart: isoAt(180),
        start: isoAt(190),
        end: isoAt(250),
        orderItem: { order: { code: 'WP-2026-002' } },
      },
    ];

    const maintHit = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: isoAt(40),
      siblingEntries: siblings,
    });
    expect(maintHit.hasHardConflict).toBe(true);
    expect(maintHit.conflicts.map((c) => c.code)).toContain('MAINTENANCE_CONFLICT');

    const siblingHit = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: isoAt(175),
      siblingEntries: siblings,
    });
    expect(siblingHit.hasHardConflict).toBe(true);
    expect(siblingHit.conflicts.map((c) => c.code)).toContain('SCHEDULE_CONFLICT');
  });

  it('emits soft OUTSIDE_SHIFT warning without blocking non-conflicting slots', () => {
    const machine = {
      id: 'm1',
      name: 'FDM #1',
      type: 'fdm_3d',
      calendar: { workDays: [1, 2, 3, 4, 5], shiftStartHour: 9, shiftEndHour: 18, holidays: [] },
      maintenanceWindows: [],
    };
    const entry = {
      id: 'e1',
      machineId: 'm1',
      setupMin: 10,
      processingMin: 60,
      orderItem: { machineType: 'fdm_3d' },
    };

    // 2026-05-09 is Saturday (outside workDays)
    const weekend = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: '2026-05-09T10:00:00.000Z',
    });
    expect(weekend.hasHardConflict).toBe(false);
    expect(weekend.conflicts.map((c) => c.code)).toEqual(['OUTSIDE_SHIFT']);

    const validSlot = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: '2026-05-04T11:00:00.000Z',
    });
    expect(validSlot.hasHardConflict).toBe(false);
    expect(validSlot.conflicts).toEqual([]);
  });

  it('exports schedule rows as UTF-8 BOM semicolon CSV with batch labels and escaped quotes', () => {
    const csv = buildScheduleCsv([
      {
        orderItem: {
          order: { code: 'WP-2026-010' },
          title: 'Корпус "Альфа"',
          material: { code: 'PLA' },
        },
        machine: { name: 'Bambu Lab X1C' },
        batchIndex: 2,
        batchQty: 5,
        setupStart: isoAt(0),
        start: isoAt(15),
        end: isoAt(90),
        setupMin: 15,
        processingMin: 75,
        tardinessMin: 0,
        locked: true,
      },
    ]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(';');
    expect(csv).toContain('"Корпус ""Альфа"""');
    expect(csv).toContain('"П2 (5 шт)"');
    expect(csv).toContain('"Так"');
  });

  it('skips out-of-range maintenance windows and warns on after-hours weekday moves', () => {
    const horizon = {
      minMs: BASE_MS,
      maxMs: BASE_MS + 480 * 60_000,
      spanMs: 480 * 60_000,
    };
    const lane = layoutGanttLane(
      [],
      [{ id: 'mw-old', title: 'Минуле ТО', start: isoAt(-120), end: isoAt(-60) }],
      horizon
    );
    expect(lane.maintenanceBars).toHaveLength(0);

    const machine = {
      id: 'm1',
      name: 'FDM #1',
      type: 'fdm_3d',
      calendar: { workDays: [1, 2, 3, 4, 5], shiftStartHour: 9, shiftEndHour: 18, holidays: [] },
      maintenanceWindows: [],
    };
    const entry = {
      id: 'e1',
      machineId: 'm1',
      setupMin: 10,
      processingMin: 60,
      orderItem: { machineType: 'fdm_3d' },
    };

    const lateEvening = checkManualMoveConflict({
      entry,
      targetMachine: machine,
      proposedStart: '2026-05-04T19:30:00.000Z',
    });
    expect(lateEvening.hasHardConflict).toBe(false);
    expect(lateEvening.conflicts[0].code).toBe('OUTSIDE_SHIFT');
  });
});
