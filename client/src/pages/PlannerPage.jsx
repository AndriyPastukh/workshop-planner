import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Lock, Play, RefreshCw, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../components/DataTable.jsx';
import { FormField } from '../components/FormField.jsx';
import { Modal } from '../components/Modal.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { materialsApi, quotesApi, scheduleApi } from '../lib/api.js';
import { MACHINE_TYPE_LABELS, formatDateTime, formatDuration } from '../lib/format.js';

const RULES = [
  { key: 'ATCS', label: 'ATCS (оптимальний)' },
  { key: 'EDD', label: 'EDD (за дедлайном)' },
  { key: 'SPT', label: 'SPT (найкоротші)' },
  { key: 'FIFO', label: 'FIFO (за чергою)' },
];

function toLocalDateTimeInput(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date(Date.now() + 2 * 24 * 60 * 60_000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlannerPage() {
  const queryClient = useQueryClient();

  const [selectedRule, setSelectedRule] = useState('ATCS');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [moveStart, setMoveStart] = useState('');
  const [moveMachineId, setMoveMachineId] = useState('');
  const [slotError, setSlotError] = useState('');

  const [feasibilityOpen, setFeasibilityOpen] = useState(false);
  const [feasMaterialId, setFeasMaterialId] = useState('');
  const [feasQty, setFeasQty] = useState(4);
  const [feasRunTimeH, setFeasRunTimeH] = useState(1.0);
  const [feasDeadline, setFeasDeadline] = useState(() => toLocalDateTimeInput());
  const [feasPriority, setFeasPriority] = useState(1);

  const { data: scheduleData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['schedule'],
    queryFn: scheduleApi.get,
  });

  const { data: compareData } = useQuery({
    queryKey: ['schedule', 'compare'],
    queryFn: scheduleApi.compare,
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: materialsApi.list,
    enabled: feasibilityOpen,
  });

  const machines = useMemo(() => scheduleData?.machines ?? [], [scheduleData]);
  const entries = useMemo(() => scheduleData?.entries ?? [], [scheduleData]);
  const metrics = scheduleData?.metrics ?? {};
  const materials = useMemo(() => materialsData?.materials ?? [], [materialsData]);

  useEffect(() => {
    if (feasibilityOpen && !feasMaterialId && materials.length > 0) {
      setFeasMaterialId(materials[0].id);
    }
  }, [feasibilityOpen, feasMaterialId, materials]);

  const rebuildMutation = useMutation({
    mutationFn: (rule) => scheduleApi.rebuild(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const updateSlotMutation = useMutation({
    mutationFn: ({ id, body }) => scheduleApi.updateEntry(id, body),
    onSuccess: (res) => {
      setSlotError('');
      if (res?.entry) {
        setSelectedEntry(res.entry);
        setMoveStart(toLocalDateTimeInput(res.entry.start));
        setMoveMachineId(res.entry.machineId);
      }
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => {
      setSlotError(err.message || 'Не вдалося оновити слот');
    },
  });

  const feasibilityMutation = useMutation({
    mutationFn: () =>
      quotesApi.feasibility({
        deadline: new Date(feasDeadline).toISOString(),
        priority: Number(feasPriority) || 1,
        rule: selectedRule,
        items: [
          {
            materialId: feasMaterialId,
            qty: Math.max(1, Number(feasQty) || 1),
            runTimeH: Math.max(0.1, Number(feasRunTimeH) || 1),
          },
        ],
      }),
  });

  // Compute timeline bounds for pure CSS Grid Gantt
  const horizon = useMemo(() => {
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const e of entries) {
      minMs = Math.min(minMs, Date.parse(e.setupStart));
      maxMs = Math.max(maxMs, Date.parse(e.end));
    }
    for (const m of machines) {
      for (const w of m.maintenanceWindows ?? []) {
        const wStart = Date.parse(w.start);
        const wEnd = Date.parse(w.end);
        if (entries.length === 0 || (wStart <= maxMs && wEnd >= minMs)) {
          minMs = Math.min(minMs, wStart);
          maxMs = Math.max(maxMs, wEnd);
        }
      }
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
      const now = Date.now();
      return { minMs: now, maxMs: now + 8 * 3600_000, spanMs: 8 * 3600_000, ticks: [] };
    }
    const spanMs = Math.max(maxMs - minMs, 8 * 3600_000);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
      pct: frac * 100,
      label: formatDateTime(new Date(minMs + spanMs * frac)),
    }));
    return { minMs, maxMs: minMs + spanMs, spanMs, ticks };
  }, [entries, machines]);

  const openInspector = (entry) => {
    setSlotError('');
    setSelectedEntry(entry);
    setMoveStart(toLocalDateTimeInput(entry.start));
    setMoveMachineId(entry.machineId);
  };

  const compatibleMachines = useMemo(() => {
    if (!selectedEntry) return [];
    const reqType = selectedEntry.orderItem?.machineType;
    return machines.filter((m) => m.type === reqType);
  }, [machines, selectedEntry]);

  const strategies = compareData?.strategies ?? {};

  const queueColumns = [
    {
      key: 'order',
      label: 'Замовлення / позиція',
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-ink">
              {row.orderItem?.order?.code}
            </span>
            <span className="font-mono text-[10.5px] text-ink-muted">
              {row.orderItem?.material?.code}
            </span>
          </div>
          <div className="truncate text-xs text-ink-secondary">{row.orderItem?.title}</div>
        </div>
      ),
    },
    {
      key: 'machine',
      label: 'Верстат',
      headerClassName: 'hidden md:table-cell',
      cellClassName: 'hidden md:table-cell text-xs text-ink-secondary whitespace-nowrap',
      render: (row) => row.machine?.name,
    },
    {
      key: 'window',
      label: 'Вікно виконання',
      cellClassName: 'font-mono text-xs tabular-nums whitespace-nowrap',
      render: (row) => `${formatDateTime(row.start)} → ${formatDateTime(row.end)}`,
    },
    {
      key: 'setupMin',
      label: 'Setup / Робота',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell font-mono text-xs tabular-nums whitespace-nowrap',
      render: (row) => `${row.setupMin} хв / ${formatDuration(row.processingMin)}`,
    },
    {
      key: 'tardinessMin',
      label: 'Стан',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      render: (row) =>
        row.tardinessMin > 0 ? (
          <StatusBadge status="overdue" label={`+${row.tardinessMin} хв`} />
        ) : (
          <StatusBadge status="ok" label="Вчасно" />
        ),
    },
    {
      key: 'locked',
      label: 'Слот',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell whitespace-nowrap',
      render: (row) =>
        row.locked ? (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-accent">
            <Lock className="h-3 w-3" /> Закріпл.
          </span>
        ) : (
          <span className="font-mono text-[11px] text-ink-muted">Гнучкий</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Планувальник"
        count={entries.length}
        subtitle="Календарна черга верстатів із переналаштуваннями (changeover) та оптимізацією ATCS"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedRule}
              onChange={(e) => setSelectedRule(e.target.value)}
              aria-label="Стратегія планування"
              className="h-10 rounded-full border border-line-strong bg-surface px-3.5 text-xs font-medium text-ink outline-none focus:border-accent"
            >
              {RULES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={rebuildMutation.isPending}
              onClick={() => rebuildMutation.mutate(selectedRule)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-xs font-medium text-on-cta transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rebuildMutation.isPending ? 'animate-spin' : ''}`} />
              <span>Перепланувати</span>
            </button>
            <button
              type="button"
              onClick={() => {
                feasibilityMutation.reset();
                setFeasibilityOpen(true);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-xs font-medium text-ink hover:bg-subtle"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>Чи встигну?</span>
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Робіт у плані" value={metrics.totalJobs ?? 0} hint="Активні операції" />
        <StatCard
          label="Запізнень"
          value={metrics.lateCount ?? 0}
          accent={(metrics.lateCount ?? 0) > 0}
          hint={`Сумарно ${formatDuration(metrics.totalTardinessMin ?? 0)}`}
        />
        <StatCard
          label="Сумарний setup"
          value={formatDuration(metrics.totalSetupMin ?? 0)}
          hint="Переналаштування обладнання"
        />
        <StatCard
          label="Завантаження"
          value={`${Math.round((metrics.avgUtilization ?? 0) * 100)}%`}
          hint={`Makespan ${formatDuration(metrics.makespanMin ?? 0)}`}
        />
      </div>

      {isError ? (
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <span style={{ color: 'var(--st-danger-fg)' }}>
            Помилка завантаження розкладу: {error?.message}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-xl border border-line-strong px-3 py-1 text-xs font-medium"
          >
            Повторити
          </button>
        </div>
      ) : null}

      {/* Pure CSS Grid Gantt Chart */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Діаграма Ганта за верстатами</h2>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm border border-line-strong bg-setup-hatch" />
              Переналаштування
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-4 rounded-sm border"
                style={{
                  backgroundColor: 'var(--st-confirmed-bg)',
                  borderColor: 'var(--st-confirmed-fg)',
                }}
              />
              Вчасно
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-4 rounded-sm border"
                style={{
                  backgroundColor: 'var(--st-danger-bg)',
                  borderColor: 'var(--st-danger-fg)',
                }}
              />
              Запізнення
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-3 sm:p-4">
          <div className="min-w-[740px] space-y-2.5">
            {/* Time axis header */}
            <div className="grid grid-cols-[170px_1fr] items-center gap-3 border-b border-line pb-2">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Верстат
              </div>
              <div className="relative h-5">
                {horizon.ticks.map((tick, idx) => (
                  <span
                    key={idx}
                    className={`absolute top-0 font-mono text-[10.5px] text-ink-muted whitespace-nowrap ${
                      idx === 0
                        ? 'translate-x-0'
                        : idx === horizon.ticks.length - 1
                          ? '-translate-x-full'
                          : '-translate-x-1/2'
                    }`}
                    style={{ left: `${tick.pct}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-xl wp-skeleton" />
                ))}
              </div>
            ) : (
              machines.map((machine) => {
                const mEntries = entries.filter((e) => e.machineId === machine.id);
                const maintWindows = machine.maintenanceWindows ?? [];
                return (
                  <div
                    key={machine.id}
                    className="grid grid-cols-[170px_1fr] items-center gap-3 border-b border-line pb-2.5 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-ink">{machine.name}</div>
                      <div className="font-mono text-[10.5px] text-ink-muted">
                        {MACHINE_TYPE_LABELS[machine.type] ?? machine.type} · {mEntries.length} роб.
                      </div>
                    </div>

                    <div className="relative h-11 overflow-hidden rounded-xl border border-line bg-subtle/40">
                      {/* Maintenance intervals */}
                      {maintWindows.map((w) => {
                        const s = Math.max(Date.parse(w.start), horizon.minMs);
                        const e = Math.min(Date.parse(w.end), horizon.maxMs);
                        if (e <= s) return null;
                        const left = ((s - horizon.minMs) / horizon.spanMs) * 100;
                        const width = Math.max(1, ((e - s) / horizon.spanMs) * 100);
                        return (
                          <div
                            key={w.id}
                            title={`ТО: ${w.title} (${formatDateTime(w.start)}–${formatDateTime(w.end)})`}
                            className="absolute inset-y-1 rounded bg-subtle bg-setup-hatch border border-dashed border-line-strong opacity-80"
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        );
                      })}

                      {/* Scheduled entries: hatched setup prefix + processing body */}
                      {mEntries.map((entry) => {
                        const setupStartMs = Date.parse(entry.setupStart);
                        const endMs = Date.parse(entry.end);
                        const totalEntryMs = Math.max(60_000, endMs - setupStartMs);
                        const setupRatio =
                          entry.setupMin > 0
                            ? Math.min(0.65, (entry.setupMin * 60_000) / totalEntryMs)
                            : 0;
                        const leftPct = Math.max(
                          0,
                          ((setupStartMs - horizon.minMs) / horizon.spanMs) * 100
                        );
                        const widthPct = Math.max(1.5, (totalEntryMs / horizon.spanMs) * 100);
                        const isLate = entry.tardinessMin > 0;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => openInspector(entry)}
                            title={`${entry.orderItem?.order?.code} · ${entry.orderItem?.title}\nСтарт: ${formatDateTime(entry.start)}\nSetup: ${entry.setupMin} хв, робота: ${entry.processingMin} хв`}
                            className="group absolute inset-y-1 flex overflow-hidden rounded-lg border text-left transition-transform hover:z-10 hover:scale-[1.01]"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              backgroundColor: isLate
                                ? 'var(--st-danger-bg)'
                                : 'var(--st-confirmed-bg)',
                              borderColor: isLate
                                ? 'var(--st-danger-fg)'
                                : 'var(--st-confirmed-fg)',
                              color: isLate ? 'var(--st-danger-fg)' : 'var(--st-confirmed-fg)',
                            }}
                          >
                            {setupRatio > 0 ? (
                              <span
                                className="h-full shrink-0 border-r border-current/25 bg-setup-hatch"
                                style={{ width: `${Math.round(setupRatio * 100)}%` }}
                              />
                            ) : null}
                            <span className="flex min-w-0 flex-1 items-center gap-1 px-1.5 font-mono text-[10px] font-semibold">
                              {entry.locked ? <Lock className="h-2.5 w-2.5 shrink-0" /> : null}
                              <span className="truncate">{entry.orderItem?.order?.code}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Strategy comparison (FIFO / EDD / SPT / ATCS) */}
      {Object.keys(strategies).length > 0 ? (
        <section className="space-y-2.5">
          <h2 className="text-base font-semibold text-ink">
            Порівняння стратегій планування на поточній черзі
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="h-10 border-b border-line bg-subtle font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-3.5 text-left font-normal">Правило</th>
                  <th className="px-3.5 text-right font-normal">Запізнень</th>
                  <th className="px-3.5 text-right font-normal">Сумарне запізн.</th>
                  <th className="px-3.5 text-right font-normal">Сумарний setup</th>
                  <th className="px-3.5 text-right font-normal">Makespan</th>
                  <th className="px-3.5 text-right font-normal">Завантаж.</th>
                  <th className="px-3.5 text-right font-normal">Дія</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {['FIFO', 'EDD', 'SPT', 'ATCS'].map((rule) => {
                  const m = strategies[rule];
                  if (!m) return null;
                  const isBestSetup = compareData?.bestBySetup === rule;
                  const isBestTardiness = compareData?.bestByTardiness === rule;
                  return (
                    <tr key={rule} className="h-11">
                      <td className="px-3.5 font-mono font-semibold text-ink whitespace-nowrap">
                        <span>{rule}</span>
                        {isBestSetup || isBestTardiness ? (
                          <span
                            className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-accent"
                            style={{ backgroundColor: 'var(--accent-soft)' }}
                          >
                            Оптимально
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3.5 text-right font-mono tabular-nums">{m.lateCount}</td>
                      <td className="px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatDuration(m.totalTardinessMin)}
                      </td>
                      <td className="px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatDuration(m.totalSetupMin)}
                      </td>
                      <td className="px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatDuration(m.makespanMin)}
                      </td>
                      <td className="px-3.5 text-right font-mono tabular-nums">
                        {Math.round((m.avgUtilization ?? 0) * 100)}%
                      </td>
                      <td className="px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={rebuildMutation.isPending}
                          onClick={() => {
                            setSelectedRule(rule);
                            rebuildMutation.mutate(rule);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
                        >
                          <Play className="h-3 w-3" />
                          Застосувати
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Full queue table */}
      <section className="space-y-2.5">
        <h2 className="text-base font-semibold text-ink">Детальний список операцій</h2>
        <DataTable
          columns={queueColumns}
          rows={entries}
          isLoading={isLoading}
          onRowClick={openInspector}
          emptyText="Черга планування порожня."
        />
      </section>

      {/* Slot Inspector / Manual Reschedule Modal */}
      <Modal
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
        title={
          selectedEntry
            ? `Операція ${selectedEntry.orderItem?.order?.code ?? ''} · ${selectedEntry.orderItem?.title ?? ''}`
            : ''
        }
        maxWidth="max-w-lg"
        footer={
          selectedEntry ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={updateSlotMutation.isPending}
                onClick={() =>
                  updateSlotMutation.mutate({
                    id: selectedEntry.id,
                    body: { locked: !selectedEntry.locked },
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
              >
                {selectedEntry.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {selectedEntry.locked ? 'Зняти фіксацію' : 'Закріпити слот'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEntry(null)}
                  className="rounded-xl border border-line-strong bg-surface px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
                >
                  Закрити
                </button>
                <button
                  type="button"
                  disabled={updateSlotMutation.isPending || !moveStart}
                  onClick={() =>
                    updateSlotMutation.mutate({
                      id: selectedEntry.id,
                      body: {
                        machineId: moveMachineId,
                        start: new Date(moveStart).toISOString(),
                      },
                    })
                  }
                  className="rounded-full bg-cta px-4 py-2 text-xs font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
                >
                  Перемістити слот
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {selectedEntry ? (
          <div className="space-y-3 text-xs">
            {slotError ? (
              <div
                role="alert"
                style={{
                  backgroundColor: 'var(--st-danger-bg)',
                  color: 'var(--st-danger-fg)',
                  borderColor: 'var(--st-danger-bd)',
                }}
                className="rounded-xl border px-3 py-2"
              >
                {slotError}
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-xl border border-line bg-subtle/40 px-3 py-2">
              <div>
                <Link
                  to={`/orders/${selectedEntry.orderItem?.orderId}`}
                  onClick={() => setSelectedEntry(null)}
                  className="font-mono font-semibold text-accent hover:underline"
                >
                  {selectedEntry.orderItem?.order?.code}
                </Link>
                <div className="text-ink-secondary">
                  Матеріал: {selectedEntry.orderItem?.material?.name} ({selectedEntry.orderItem?.material?.code})
                </div>
              </div>
              {selectedEntry.tardinessMin > 0 ? (
                <StatusBadge status="overdue" label={`Запізнення ${selectedEntry.tardinessMin} хв`} />
              ) : (
                <StatusBadge status="ok" label="Вчасно" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="rounded-xl border border-line p-2.5">
                <div className="text-[10px] uppercase text-ink-muted">Переналаштування</div>
                <div className="mt-0.5 font-semibold text-ink">{selectedEntry.setupMin} хв</div>
              </div>
              <div className="rounded-xl border border-line p-2.5">
                <div className="text-[10px] uppercase text-ink-muted">Обробка</div>
                <div className="mt-0.5 font-semibold text-ink">
                  {formatDuration(selectedEntry.processingMin)}
                </div>
              </div>
            </div>

            <FormField label="Верстат">
              <select
                value={moveMachineId}
                onChange={(e) => setMoveMachineId(e.target.value)}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {compatibleMachines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Новий старт обробки">
              <input
                type="datetime-local"
                value={moveStart}
                onChange={(e) => setMoveStart(e.target.value)}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
          </div>
        ) : null}
      </Modal>

      {/* Feasibility Simulation Modal ("Чи встигну?") */}
      <Modal
        open={feasibilityOpen}
        onClose={() => setFeasibilityOpen(false)}
        title="Перевірка здійсненності («Чи встигну?»)"
        maxWidth="max-w-xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setFeasibilityOpen(false)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Закрити
            </button>
            <button
              type="button"
              disabled={feasibilityMutation.isPending || !feasMaterialId}
              onClick={() => feasibilityMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
            >
              {feasibilityMutation.isPending ? 'Моделювання...' : 'Перевірити чергу'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <FormField label="Матеріал" className="sm:col-span-2">
              <select
                value={feasMaterialId}
                onChange={(e) => setFeasMaterialId(e.target.value)}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({MACHINE_TYPE_LABELS[m.machineType]})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Кількість (шт)">
              <input
                type="number"
                min={1}
                value={feasQty}
                onChange={(e) => setFeasQty(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
            <FormField label="Час на од. (год)">
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={feasRunTimeH}
                onChange={(e) => setFeasRunTimeH(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
            <FormField label="Бажаний дедлайн">
              <input
                type="datetime-local"
                value={feasDeadline}
                onChange={(e) => setFeasDeadline(e.target.value)}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
            <FormField label="Пріоритет (1–5)">
              <input
                type="number"
                min={1}
                max={5}
                value={feasPriority}
                onChange={(e) => setFeasPriority(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
          </div>

          {feasibilityMutation.data ? (
            <div
              className="space-y-2 rounded-2xl border p-3.5"
              style={{
                backgroundColor: feasibilityMutation.data.meetsDeadline
                  ? 'var(--st-progress-bg)'
                  : 'var(--st-quoted-bg)',
                borderColor: feasibilityMutation.data.meetsDeadline
                  ? 'var(--st-progress-bd)'
                  : 'var(--st-quoted-bd)',
                color: feasibilityMutation.data.meetsDeadline
                  ? 'var(--st-progress-fg)'
                  : 'var(--st-quoted-fg)',
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Рекомендація: {feasibilityMutation.data.recommendation}</span>
              </div>
              <div className="font-mono text-[11px]">
                Найраніше завершення:{' '}
                <strong>{formatDateTime(feasibilityMutation.data.earliestFinish)}</strong>
                {feasibilityMutation.data.suggestedDeadline ? (
                  <>
                    {' · '}Реалістичний дедлайн:{' '}
                    <strong>{formatDateTime(feasibilityMutation.data.suggestedDeadline)}</strong>
                  </>
                ) : null}
                {feasibilityMutation.data.recommendedRushSurcharge > 0 ? (
                  <>
                    {' · '}Реком. RUSH-націнка:{' '}
                    <strong>
                      {Math.round(feasibilityMutation.data.recommendedRushSurcharge * 100)}%
                    </strong>
                  </>
                ) : null}
              </div>
              {feasibilityMutation.data.newlyDelayedOrders?.length > 0 ? (
                <div className="text-[11px]">
                  Ризик затримки інших замовлень:{' '}
                  {feasibilityMutation.data.newlyDelayedOrders.map((o) => o.orderCode).join(', ')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
