export const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const DEFAULT_CALENDAR = {
  workDays: [1, 2, 3, 4, 5],
  shiftStartHour: 9,
  shiftEndHour: 18,
  holidays: [],
};

/**
 * Convert Date, ISO timestamp string, or Unix ms number into UTC epoch milliseconds.
 */
export function toTimestampMs(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric timestamp: ${value}`);
    }
    return value;
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  return ms;
}

function normalizeCalendar(calendar) {
  const workDays = calendar.workDays ?? DEFAULT_CALENDAR.workDays;
  const shiftStartHour = calendar.shiftStartHour ?? DEFAULT_CALENDAR.shiftStartHour;
  const shiftEndHour = calendar.shiftEndHour ?? DEFAULT_CALENDAR.shiftEndHour;
  const holidays = Array.isArray(calendar.holidays) ? calendar.holidays : [];

  if (!Array.isArray(workDays) || workDays.length === 0) {
    throw new Error('Calendar must define at least one working day');
  }
  if (shiftEndHour <= shiftStartHour) {
    throw new Error('Calendar shiftEndHour must be strictly greater than shiftStartHour');
  }

  return { workDays, shiftStartHour, shiftEndHour, holidays: new Set(holidays) };
}

function utcDayStartMs(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatUtcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Check whether the UTC date of a timestamp is a scheduled working day (excluding holidays).
 */
export function isWorkingDay(dateMs, calendar = DEFAULT_CALENDAR) {
  if (calendar == null) {
    return true;
  }
  const ms = toTimestampMs(dateMs);
  const { workDays, holidays } = normalizeCalendar(calendar);
  const day = new Date(ms).getUTCDay();
  return workDays.includes(day) && !holidays.has(formatUtcDate(ms));
}

/**
 * Compare whether two timestamps fall on different UTC calendar days (used to trigger shift warmup).
 */
export function isDifferentWorkDay(aMs, bMs) {
  return formatUtcDate(toTimestampMs(aMs)) !== formatUtcDate(toTimestampMs(bMs));
}

/**
 * Advance a timestamp to the nearest valid working shift instant (no-op when calendar is null / 24-7).
 */
export function snapToWorkTime(value, calendar) {
  const ms = toTimestampMs(value);
  if (calendar == null) {
    return ms;
  }

  const cal = normalizeCalendar(calendar);
  let dayMs = utcDayStartMs(ms);

  // Guard iteration count to avoid infinite loops on degenerate holiday-only calendars.
  for (let i = 0; i < 3660; i += 1) {
    const day = new Date(dayMs).getUTCDay();
    if (cal.workDays.includes(day) && !cal.holidays.has(formatUtcDate(dayMs))) {
      const shiftStartMs = dayMs + cal.shiftStartHour * HOUR_MS;
      const shiftEndMs = dayMs + cal.shiftEndHour * HOUR_MS;

      if (ms <= shiftStartMs) {
        return shiftStartMs;
      }
      if (ms < shiftEndMs) {
        return ms;
      }
    }
    dayMs += DAY_MS;
  }

  throw new Error('Could not find a working day within 10 years');
}

/**
 * Advance forward by durationMin working minutes, pausing outside shifts and across weekends/holidays.
 */
export function advanceWorkTime(startValue, durationMin, calendar) {
  const startMs = toTimestampMs(startValue);
  if (durationMin <= 0) {
    return startMs;
  }
  if (calendar == null) {
    return startMs + durationMin * MIN_MS;
  }

  const cal = normalizeCalendar(calendar);
  let cursor = snapToWorkTime(startMs, calendar);
  let remaining = durationMin;

  while (remaining > 0) {
    const dayMs = utcDayStartMs(cursor);
    const shiftEndMs = dayMs + cal.shiftEndHour * HOUR_MS;
    const availMin = (shiftEndMs - cursor) / MIN_MS;

    if (remaining <= availMin) {
      return cursor + remaining * MIN_MS;
    }

    remaining -= availMin;
    cursor = snapToWorkTime(shiftEndMs, calendar);
  }

  return cursor;
}

/**
 * Count working minutes elapsed between two instants (negative when toValue < fromValue).
 */
export function workMinutesBetween(fromValue, toValue, calendar) {
  const fromMs = toTimestampMs(fromValue);
  const toMs = toTimestampMs(toValue);

  if (fromMs === toMs) {
    return 0;
  }
  if (toMs < fromMs) {
    return -workMinutesBetween(toMs, fromMs, calendar);
  }
  if (calendar == null) {
    return (toMs - fromMs) / MIN_MS;
  }

  const cal = normalizeCalendar(calendar);
  let cursor = snapToWorkTime(fromMs, calendar);
  let totalMin = 0;

  while (cursor < toMs) {
    const dayMs = utcDayStartMs(cursor);
    const shiftEndMs = dayMs + cal.shiftEndHour * HOUR_MS;
    const segmentEndMs = Math.min(shiftEndMs, toMs);

    if (segmentEndMs > cursor) {
      totalMin += (segmentEndMs - cursor) / MIN_MS;
    }
    if (segmentEndMs >= toMs) {
      break;
    }
    cursor = snapToWorkTime(shiftEndMs, calendar);
  }

  return totalMin;
}
