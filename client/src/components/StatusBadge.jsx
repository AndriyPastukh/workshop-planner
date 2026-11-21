import { ORDER_STATUS_LABELS } from '../lib/format.js';

const VARIANT_STYLES = {
  draft: {
    bg: 'var(--st-draft-bg)',
    color: 'var(--st-draft-fg)',
    borderColor: 'var(--st-draft-bd)',
    dot: 'var(--st-draft-fg)',
    label: ORDER_STATUS_LABELS.draft,
  },
  quoted: {
    bg: 'var(--st-quoted-bg)',
    color: 'var(--st-quoted-fg)',
    borderColor: 'var(--st-quoted-bd)',
    dot: 'var(--st-quoted-fg)',
    label: ORDER_STATUS_LABELS.quoted,
  },
  confirmed: {
    bg: 'var(--st-confirmed-bg)',
    color: 'var(--st-confirmed-fg)',
    borderColor: 'var(--st-confirmed-bd)',
    dot: 'var(--st-confirmed-fg)',
    label: ORDER_STATUS_LABELS.confirmed,
  },
  in_progress: {
    bg: 'var(--st-progress-bg)',
    color: 'var(--st-progress-fg)',
    borderColor: 'var(--st-progress-bd)',
    dot: 'var(--accent)',
    label: ORDER_STATUS_LABELS.in_progress,
  },
  done: {
    bg: 'var(--st-done-bg)',
    color: 'var(--st-done-fg)',
    borderColor: 'var(--st-done-bd)',
    dot: 'var(--st-done-fg)',
    label: ORDER_STATUS_LABELS.done,
  },
  cancelled: {
    bg: 'var(--st-cancelled-bg)',
    color: 'var(--st-cancelled-fg)',
    borderColor: 'var(--st-cancelled-bd)',
    dot: 'var(--st-cancelled-fg)',
    label: ORDER_STATUS_LABELS.cancelled,
  },
  rush: {
    bg: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderColor: 'var(--st-progress-bd)',
    dot: 'var(--accent)',
    label: 'Терміново',
  },
  overdue: {
    bg: 'var(--st-danger-bg)',
    color: 'var(--st-danger-fg)',
    borderColor: 'var(--st-danger-bd)',
    dot: 'var(--st-danger-fg)',
    label: 'Ризик зриву',
  },
  low_stock: {
    bg: 'var(--st-danger-bg)',
    color: 'var(--st-danger-fg)',
    borderColor: 'var(--st-danger-bd)',
    dot: 'var(--st-danger-fg)',
    label: 'Малий залишок',
  },
};

export function StatusBadge({ status, label, className = '' }) {
  const cfg = VARIANT_STYLES[status] ?? VARIANT_STYLES.draft;
  return (
    <span
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        borderColor: cfg.borderColor,
      }}
      className={`inline-flex h-[22px] items-center gap-1 sm:gap-1.5 rounded border px-1.5 sm:px-2 text-[11px] font-medium leading-none whitespace-nowrap ${className}`}
    >
      <span
        style={{ backgroundColor: cfg.dot }}
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        aria-hidden="true"
      />
      <span>{label ?? cfg.label}</span>
    </span>
  );
}
