export function PageHeader({ title, count, subtitle, actions }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <h1 className="text-[40px] font-bold leading-none tracking-[-0.045em] text-ink sm:text-5xl lg:text-[64px]">
            {title}
          </h1>
          {count !== undefined && count !== null ? (
            <span className="mt-1 rounded-lg bg-subtle px-2 py-0.5 font-mono text-sm tabular-nums text-ink-secondary">
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-4 max-w-xl text-base text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
