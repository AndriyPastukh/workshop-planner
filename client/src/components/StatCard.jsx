export function StatCard({ label, value, hint, accent = false, className = '' }) {
  return (
    <div
      className={`rounded-2xl border bg-surface px-4 py-3.5 ${
        accent ? 'border-accent/50' : 'border-line'
      } ${className}`}
    >
      <div className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-muted">{label}</div>
      <div
        className={`mt-1.5 font-mono text-[28px] font-semibold leading-tight tracking-tight tabular-nums ${
          accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-sm text-ink-muted">{hint}</div> : null}
    </div>
  );
}
