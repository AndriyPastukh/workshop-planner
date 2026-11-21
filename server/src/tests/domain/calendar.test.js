import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR,
  advanceWorkTime,
  isDifferentWorkDay,
  isWorkingDay,
  snapToWorkTime,
  toTimestampMs,
  workMinutesBetween,
} from '../../domain/calendar.js';

describe('calendar domain', () => {
  it('identifies working days and skips weekends and holidays in UTC', () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: ['2026-05-06'] };

    // Monday 2026-05-04 -> working day
    expect(isWorkingDay(Date.parse('2026-05-04T10:00:00Z'), cal)).toBe(true);
    // Wednesday 2026-05-06 -> holiday
    expect(isWorkingDay(Date.parse('2026-05-06T10:00:00Z'), cal)).toBe(false);
    // Saturday 2026-05-09 -> weekend
    expect(isWorkingDay(Date.parse('2026-05-09T10:00:00Z'), cal)).toBe(false);
    // Sunday 2026-05-10 -> weekend
    expect(isWorkingDay(Date.parse('2026-05-10T10:00:00Z'), cal)).toBe(false);
  });

  it('snaps timestamps to valid shift boundaries', () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: ['2026-05-06'] };

    // Before shift -> 09:00 same day
    expect(new Date(snapToWorkTime('2026-05-04T07:15:00Z', cal)).toISOString()).toBe(
      '2026-05-04T09:00:00.000Z'
    );
    // Inside shift -> unchanged
    expect(new Date(snapToWorkTime('2026-05-04T13:30:00Z', cal)).toISOString()).toBe(
      '2026-05-04T13:30:00.000Z'
    );
    // Exactly at shift end (18:00) -> next working day 09:00
    expect(new Date(snapToWorkTime('2026-05-04T18:00:00Z', cal)).toISOString()).toBe(
      '2026-05-05T09:00:00.000Z'
    );
    // Tuesday after shift before Wednesday holiday -> Thursday 09:00
    expect(new Date(snapToWorkTime('2026-05-05T19:00:00Z', cal)).toISOString()).toBe(
      '2026-05-07T09:00:00.000Z'
    );
    // Friday evening -> Monday 09:00
    expect(new Date(snapToWorkTime('2026-05-08T18:30:00Z', cal)).toISOString()).toBe(
      '2026-05-11T09:00:00.000Z'
    );
    // 24/7 mode (calendar === null) -> unchanged
    expect(new Date(snapToWorkTime('2026-05-09T03:00:00Z', null)).toISOString()).toBe(
      '2026-05-09T03:00:00.000Z'
    );
  });

  it('advances work time within shifts, overnight, across weekends, and in 24/7 mode', () => {
    const cal = DEFAULT_CALENDAR;

    // Within same shift: Mon 09:00 + 120 min -> Mon 11:00
    expect(new Date(advanceWorkTime('2026-05-04T09:00:00Z', 120, cal)).toISOString()).toBe(
      '2026-05-04T11:00:00.000Z'
    );

    // Overnight: Mon 17:00 + 120 min -> 60 min Mon (18:00) + 60 min Tue (10:00)
    expect(new Date(advanceWorkTime('2026-05-04T17:00:00Z', 120, cal)).toISOString()).toBe(
      '2026-05-05T10:00:00.000Z'
    );

    // Across weekend: Fri 16:00 + 180 min -> 120 min Fri + 60 min Mon 10:00
    expect(new Date(advanceWorkTime('2026-05-08T16:00:00Z', 180, cal)).toISOString()).toBe(
      '2026-05-11T10:00:00.000Z'
    );

    // Multi-day duration: 15 hours (900 min) starting Mon 09:00 -> 9h Mon + 6h Tue -> Tue 15:00
    expect(new Date(advanceWorkTime('2026-05-04T09:00:00Z', 900, cal)).toISOString()).toBe(
      '2026-05-05T15:00:00.000Z'
    );

    // Zero duration -> unchanged
    expect(new Date(advanceWorkTime('2026-05-04T09:00:00Z', 0, cal)).toISOString()).toBe(
      '2026-05-04T09:00:00.000Z'
    );

    // 24/7 mode (calendar === null) -> straight UTC addition
    expect(new Date(advanceWorkTime('2026-05-08T16:00:00Z', 180, null)).toISOString()).toBe(
      '2026-05-08T19:00:00.000Z'
    );
  });

  it('computes working minutes between timestamps and detects different UTC work days', () => {
    const cal = DEFAULT_CALENDAR;

    expect(workMinutesBetween('2026-05-04T09:00:00Z', '2026-05-04T12:30:00Z', cal)).toBe(210);
    // Fri 16:00 to Mon 10:00 -> 120 min Fri + 60 min Mon = 180 min
    expect(workMinutesBetween('2026-05-08T16:00:00Z', '2026-05-11T10:00:00Z', cal)).toBe(180);
    // Same timestamp -> 0
    expect(workMinutesBetween('2026-05-04T12:00:00Z', '2026-05-04T12:00:00Z', cal)).toBe(0);
    // Reversed range -> negative working minutes
    expect(workMinutesBetween('2026-05-04T12:00:00Z', '2026-05-04T10:00:00Z', cal)).toBe(-120);
    // 24/7 mode
    expect(workMinutesBetween('2026-05-08T16:00:00Z', '2026-05-11T10:00:00Z', null)).toBe(
      (2 * 24 + 18) * 60
    );

    expect(
      isDifferentWorkDay(Date.parse('2026-05-04T09:00:00Z'), Date.parse('2026-05-04T17:59:00Z'))
    ).toBe(false);
    expect(
      isDifferentWorkDay(Date.parse('2026-05-04T17:59:00Z'), Date.parse('2026-05-05T09:00:00Z'))
    ).toBe(true);
  });

  it('throws on invalid calendar configurations and timestamps, and handles Date / 24-7 checks', () => {
    expect(isWorkingDay(new Date('2026-05-09T10:00:00Z'), null)).toBe(true);
    expect(toTimestampMs(new Date('2026-05-04T09:00:00Z'))).toBe(
      Date.parse('2026-05-04T09:00:00Z')
    );
    expect(() => toTimestampMs(Number.NaN)).toThrow();
    expect(() => toTimestampMs('not-a-date')).toThrow();
    expect(() =>
      snapToWorkTime('2026-05-04T09:00:00Z', { workDays: [], shiftStartHour: 9, shiftEndHour: 18 })
    ).toThrow();
    expect(() =>
      snapToWorkTime('2026-05-04T09:00:00Z', {
        workDays: [1],
        shiftStartHour: 18,
        shiftEndHour: 9,
      })
    ).toThrow();
  });
});
