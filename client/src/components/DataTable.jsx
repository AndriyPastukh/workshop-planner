export function DataTable({
  columns,
  rows = [],
  rowKey = (row) => row.id,
  isLoading = false,
  emptyText = 'Записів не знайдено.',
  emptyAction = null,
  onRowClick,
}) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="border-b border-line bg-subtle px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Завантаження реєстру...
        </div>
        <div className="divide-y divide-line">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="flex h-10 items-center gap-4 px-3">
              <div className="h-3 w-20 rounded wp-skeleton" />
              <div className="h-3 flex-1 rounded wp-skeleton" />
              <div className="h-3 w-24 rounded wp-skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm text-ink-secondary">{emptyText}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="h-11 border-b border-line bg-subtle">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 sm:px-4 font-mono text-[11.5px] font-normal uppercase tracking-[0.08em] text-ink-muted whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                } ${col.headerClassName ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, idx) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={idx < 8 ? { animationDelay: `${idx * 24}ms` } : undefined}
              className={`h-14 transition-colors duration-150 wp-row-enter ${
                onRowClick ? 'cursor-pointer hover:bg-subtle/60' : 'hover:bg-subtle/40'
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 sm:px-4 py-2 align-middle ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.cellClassName ?? ''}`}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
