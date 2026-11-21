export function StatCard({ label, value, hint, accent = false, className = '' }) {
  return (
    <div
      className={`rounded-md border bg-surface px-3.5 py-2.5 ${
        accent ? 'border-accent/50' : 'border-line'
      } ${className}`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-lg font-semibold tabular-nums leading-tight ${
          accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-ink-secondary">{hint}</div> : null}
    </div>
  );
}
