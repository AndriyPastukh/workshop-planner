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
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="border-b border-line bg-subtle px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Завантаження реєстру...
        </div>
        <div className="divide-y divide-line">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="flex h-10 items-center gap-4 px-3">
              <div className="h-3 w-20 rounded bg-subtle" />
              <div className="h-3 flex-1 rounded bg-subtle" />
              <div className="h-3 w-24 rounded bg-subtle" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 rounded-md border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm text-ink-secondary">{emptyText}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="h-8 border-b border-line bg-subtle">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-1.5 sm:px-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                } ${col.headerClassName ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`h-10 transition-colors ${
                onRowClick ? 'cursor-pointer hover:bg-subtle/60' : 'hover:bg-subtle/40'
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-1.5 sm:px-2 py-1.5 align-middle ${
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
