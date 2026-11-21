export function PageHeader({ title, count, subtitle, actions }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
          {count !== undefined && count !== null ? (
            <span className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-xs tabular-nums text-ink-secondary">
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
