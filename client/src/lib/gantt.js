import { formatDateTime } from './format.js';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Compute normalized Gantt timeline bounds, axis ticks, and "Now" indicator position.
 */
export function computeGanttHorizon(entries = [], machines = [], nowMs = Date.now()) {
  let minMs = Infinity;
  let maxMs = -Infinity;

  for (const e of entries) {
    const s = Date.parse(e.setupStart ?? e.start);
    const end = Date.parse(e.end);
    if (Number.isFinite(s)) minMs = Math.min(minMs, s);
    if (Number.isFinite(end)) maxMs = Math.max(maxMs, end);
  }

  for (const m of machines) {
    for (const w of m.maintenanceWindows ?? []) {
      const wStart = Date.parse(w.start);
      const wEnd = Date.parse(w.end);
      if (!Number.isFinite(wStart) || !Number.isFinite(wEnd)) continue;
      if (entries.length === 0 || (wStart <= maxMs && wEnd >= minMs)) {
        minMs = Math.min(minMs, wStart);
        maxMs = Math.max(maxMs, wEnd);
      }
    }
  }

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    const spanMs = 8 * HOUR_MS;
    const endMs = nowMs + spanMs;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
      pct: frac * 100,
      label: formatDateTime(new Date(nowMs + spanMs * frac)),
    }));
    return { minMs: nowMs, maxMs: endMs, spanMs, ticks, nowPct: 0 };
  }

  const spanMs = Math.max(maxMs - minMs, 8 * HOUR_MS);
  const finalMaxMs = minMs + spanMs;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    pct: frac * 100,
    label: formatDateTime(new Date(minMs + spanMs * frac)),
  }));

  const nowPct =
    nowMs >= minMs && nowMs <= finalMaxMs
      ? Number((((nowMs - minMs) / spanMs) * 100).toFixed(2))
      : null;

  return { minMs, maxMs: finalMaxMs, spanMs, ticks, nowPct };
}

/**
 * Compute pixel-free percentage coordinates for maintenance windows and scheduled job bars on one lane.
 */
export function layoutGanttLane(entries = [], maintenanceWindows = [], horizon) {
  const spanMs = Math.max(1, horizon?.spanMs ?? 8 * HOUR_MS);
  const minMs = horizon?.minMs ?? 0;
  const maxMs = horizon?.maxMs ?? minMs + spanMs;

  const maintenanceBars = [];
  for (const w of maintenanceWindows) {
    const rawS = Date.parse(w.start);
    const rawE = Date.parse(w.end);
    if (!Number.isFinite(rawS) || !Number.isFinite(rawE)) continue;
    const s = Math.max(rawS, minMs);
    const e = Math.min(rawE, maxMs);
    if (e <= s) continue;
    const leftPct = clamp(((s - minMs) / spanMs) * 100, 0, 100);
    const widthPct = clamp(((e - s) / spanMs) * 100, 1, 100 - leftPct);
    maintenanceBars.push({ window: w, leftPct, widthPct });
  }

  const entryBars = [];
  for (const entry of entries) {
    const setupStartMs = Date.parse(entry.setupStart ?? entry.start);
    const endMs = Date.parse(entry.end);
    if (!Number.isFinite(setupStartMs) || !Number.isFinite(endMs)) continue;

    const totalEntryMs = Math.max(MIN_MS, endMs - setupStartMs);
    const setupRatio =
      (entry.setupMin ?? 0) > 0 ? Math.min(0.65, (entry.setupMin * MIN_MS) / totalEntryMs) : 0;
    const leftPct = clamp(((setupStartMs - minMs) / spanMs) * 100, 0, 98.5);
    const widthPct = clamp((totalEntryMs / spanMs) * 100, 1.5, 100 - leftPct);

    entryBars.push({
      entry,
      leftPct,
      widthPct,
      setupPct: Math.round(setupRatio * 100),
      isLate: (entry.tardinessMin ?? 0) > 0,
      batchLabel: entry.batchQty != null ? `П${entry.batchIndex ?? 1}` : null,
    });
  }

  return { maintenanceBars, entryBars };
}

/**
 * Client-side pre-flight conflict check before sending manual slot adjustments to the server (CLAUDE.md §7.5).
 */
export function checkManualMoveConflict({
  entry,
  targetMachine,
  proposedStart,
  siblingEntries = [],
  maintenanceWindows = [],
}) {
  const startMs =
    proposedStart instanceof Date ? proposedStart.getTime() : Date.parse(proposedStart);
  if (!entry || !targetMachine || !Number.isFinite(startMs)) {
    return { hasHardConflict: false, conflicts: [] };
  }

  const conflicts = [];
  const reqType = entry.orderItem?.machineType ?? entry.machineType;
  if (reqType && targetMachine.type !== reqType) {
    conflicts.push({
      code: 'MACHINE_TYPE_MISMATCH',
      severity: 'error',
      message: `Верстат «${targetMachine.name}» (${targetMachine.type}) несумісний із типом операції (${reqType}).`,
    });
  }

  const setupMin = Math.max(0, Number(entry.setupMin ?? 0));
  const procMin = Math.max(15, Number(entry.processingMin ?? 60));
  const estSetupStartMs = startMs - setupMin * MIN_MS;
  const estEndMs = startMs + procMin * MIN_MS;

  const mwList = maintenanceWindows.length > 0 ? maintenanceWindows : targetMachine.maintenanceWindows ?? [];
  const maintHit = mwList.find((w) => {
    const ws = Date.parse(w.start);
    const we = Date.parse(w.end);
    return Number.isFinite(ws) && Number.isFinite(we) && estSetupStartMs < we && estEndMs > ws;
  });
  if (maintHit) {
    conflicts.push({
      code: 'MAINTENANCE_CONFLICT',
      severity: 'error',
      message: `Перетин із вікном ТО «${maintHit.title}» (${formatDateTime(maintHit.start)}–${formatDateTime(maintHit.end)}).`,
    });
  }

  const siblingHit = siblingEntries.find((other) => {
    if (other.id === entry.id || other.machineId !== targetMachine.id) return false;
    const os = Date.parse(other.setupStart ?? other.start);
    const oe = Date.parse(other.end);
    return Number.isFinite(os) && Number.isFinite(oe) && estSetupStartMs < oe && estEndMs > os;
  });
  if (siblingHit) {
    conflicts.push({
      code: 'SCHEDULE_CONFLICT',
      severity: 'error',
      message: `Перетин із операцією ${siblingHit.orderItem?.order?.code ?? siblingHit.id} (${formatDateTime(siblingHit.start)}–${formatDateTime(siblingHit.end)}).`,
    });
  }

  const cal = targetMachine.calendar;
  if (cal && Array.isArray(cal.workDays)) {
    const d = new Date(startMs);
    const day = d.getUTCDay();
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const dateKey = d.toISOString().slice(0, 10);
    const holidays = Array.isArray(cal.holidays) ? cal.holidays : [];
    const shiftStart = cal.shiftStartHour ?? 9;
    const shiftEnd = cal.shiftEndHour ?? 18;
    if (!cal.workDays.includes(day) || holidays.includes(dateKey) || hour < shiftStart || hour >= shiftEnd) {
      conflicts.push({
        code: 'OUTSIDE_SHIFT',
        severity: 'warning',
        message: 'Старт поза графіком зміни (UTC) — сервер автоматично змістить на початок зміни.',
      });
    }
  }

  return {
    hasHardConflict: conflicts.some((c) => c.severity === 'error'),
    conflicts,
  };
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Serialize schedule entries to UTF-8 BOM CSV compatible with Microsoft Excel (Ukrainian locale ';').
 */
export function buildScheduleCsv(entries = []) {
  const headers = [
    'Замовлення',
    'Позиція',
    'Верстат',
    'Матеріал',
    'Партія',
    'Старт setup',
    'Старт роботи',
    'Завершення',
    'Setup (хв)',
    'Робота (хв)',
    'Запізнення (хв)',
    'Закріплено',
  ];

  const rows = [headers.map(escapeCsvCell).join(';')];
  for (const e of entries) {
    const batch = e.batchQty != null ? `П${e.batchIndex ?? 1} (${e.batchQty} шт)` : 'Повна';
    const cells = [
      e.orderItem?.order?.code ?? '',
      e.orderItem?.title ?? '',
      e.machine?.name ?? '',
      e.orderItem?.material?.code ?? '',
      batch,
      formatDateTime(e.setupStart ?? e.start),
      formatDateTime(e.start),
      formatDateTime(e.end),
      e.setupMin ?? 0,
      e.processingMin ?? 0,
      e.tardinessMin ?? 0,
      e.locked ? 'Так' : 'Ні',
    ];
    rows.push(cells.map(escapeCsvCell).join(';'));
  }

  return `\uFEFF${rows.join('\r\n')}`;
}

export function downloadCsvFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
