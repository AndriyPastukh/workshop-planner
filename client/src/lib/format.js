export const ORDER_STATUS_LABELS = {
  draft: 'Чернетка',
  quoted: 'Прорахунок',
  confirmed: 'Підтверджено',
  in_progress: 'У роботі',
  done: 'Виконано',
  cancelled: 'Скасовано',
};

export const ORDER_STATUS_NEXT_ACTIONS = {
  draft: { status: 'quoted', label: 'У прорахунок' },
  quoted: { status: 'confirmed', label: 'Підтвердити' },
  confirmed: { status: 'in_progress', label: 'Запустити' },
  in_progress: { status: 'done', label: 'Завершити' },
};

export const MACHINE_TYPE_LABELS = {
  fdm_3d: '3D-друк FDM',
  resin_3d: '3D-друк смола',
  laser: 'Лазер CO2',
  cnc_wood: 'Фрезер ЧПК',
};

/**
 * Format numeric amount as deterministic Ukrainian currency: "1 250,00 ₴" (NBSP thousands, comma decimal).
 */
export function formatMoney(value) {
  const num = Number(value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  const sign = safe < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(safe).toFixed(2).split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${sign}${spacedInt},${decPart} ₴`;
}

/**
 * Format ISO date/time cleanly as "DD.MM HH:mm" (e.g., "21.11 14:30").
 */
export function formatDateTime(value, { utc = false } = {}) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const pad = (n) => String(n).padStart(2, '0');
  const day = utc ? date.getUTCDate() : date.getDate();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const hours = utc ? date.getUTCHours() : date.getHours();
  const mins = utc ? date.getUTCMinutes() : date.getMinutes();
  return `${pad(day)}.${pad(month)} ${pad(hours)}:${pad(mins)}`;
}

/**
 * Format duration in minutes into concise Ukrainian notation ("2 год 15 хв" or "45 хв").
 */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) {
    return `${m} хв`;
  }
  if (m === 0) {
    return `${h} год`;
  }
  return `${h} год ${m} хв`;
}
