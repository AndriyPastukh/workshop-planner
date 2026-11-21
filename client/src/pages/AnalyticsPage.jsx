import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Money } from '../components/Money.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { analyticsApi, scheduleApi } from '../lib/api.js';
import { MACHINE_TYPE_LABELS, formatDuration } from '../lib/format.js';

export default function AnalyticsPage() {
  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: analyticsApi.summary,
  });

  const { data: compareData } = useQuery({
    queryKey: ['schedule', 'compare'],
    queryFn: scheduleApi.compare,
  });

  const summary = summaryData ?? {
    ordersCount: 0,
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    avgMarginPct: 0,
    byMachineType: [],
    topCustomers: [],
  };

  const byMachine = summary.byMachineType ?? [];
  const maxRevenueMachine = Math.max(1, ...byMachine.map((r) => r.revenue || 0));
  const topCustomers = summary.topCustomers ?? [];
  const maxRevenueCust = Math.max(1, ...topCustomers.map((c) => c.totalSpent || 0));
  const strategies = compareData?.strategies ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Аналітика"
        subtitle="Прибутковість по напрямах обладнання, ТОП-клієнти та порівняння правил планування"
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Виручка"
          moneyValue={summary.totalRevenue ?? 0}
          hint={`${summary.ordersCount ?? 0} активних і виконаних`}
        />
        <StatCard
          label="Собівартість"
          moneyValue={summary.totalCost ?? 0}
          hint="Матеріал + верстати + накл."
        />
        <StatCard
          label="Оціночний прибуток"
          moneyValue={summary.totalProfit ?? 0}
          accent
          hint="Маржа до оподаткування"
        />
        <StatCard
          label="Середня маржа"
          value={isLoading ? '—' : `${summary.avgMarginPct ?? 0}%`}
          hint="Відносно собівартості"
        />
      </div>

      {/* Profitability by machine type */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">
          Прибутковість по типах обладнання
        </h2>
        {byMachine.length === 0 ? (
          <p className="text-xs text-ink-muted">Недостатньо замовлень для аналізу.</p>
        ) : (
          <div className="space-y-4">
            {byMachine.map((row) => {
              const revPct = Math.round(((row.revenue || 0) / maxRevenueMachine) * 100);
              const costPct = Math.round(((row.cost || 0) / maxRevenueMachine) * 100);
              return (
                <div key={row.machineType} className="space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-ink">
                        {MACHINE_TYPE_LABELS[row.machineType] ?? row.machineType}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-ink-muted">
                        {row.itemsCount} поз. · {row.totalQty} шт · {row.totalRunHours} год
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 font-mono">
                      <span className="text-ink-muted">
                        Собіварт.: <Money value={row.cost} />
                      </span>
                      <span className="font-semibold text-ink">
                        Виручка: <Money value={row.revenue} />
                      </span>
                      <span className="font-semibold text-accent">
                        +<Money value={row.profit} />
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full wp-progress-fill"
                        style={{ width: `${revPct}%`, backgroundColor: 'var(--st-confirmed-fg)' }}
                      />
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full wp-progress-fill bg-ink-muted/60"
                        style={{ width: `${costPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top customers */}
        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">ТОП-клієнти за виручкою</h2>
            <Link to="/customers" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Усі клієнти <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="space-y-2.5 text-xs">
            {topCustomers.map((c) => {
              const barPct = Math.round(((c.totalSpent || 0) / maxRevenueCust) * 100);
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{c.name}</div>
                      <div className="font-mono text-[11px] text-ink-muted">
                        {c.ordersCount} замовл. · середній чек <Money value={c.avgOrderValue} />
                      </div>
                    </div>
                    <Money value={c.totalSpent} className="shrink-0 font-mono font-semibold text-ink" />
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full wp-progress-fill"
                      style={{ width: `${barPct}%`, backgroundColor: 'var(--accent)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scheduling rules benchmark snapshot */}
        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Ефективність алгоритмів черги</h2>
            <Link to="/planner" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              У планувальник <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {Object.keys(strategies).length === 0 ? (
            <p className="text-xs text-ink-muted">Завантаження порівняння...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="h-8 border-b border-line font-mono text-[10.5px] uppercase text-ink-muted">
                    <th className="text-left font-normal">Правило</th>
                    <th className="text-right font-normal">Запізн.</th>
                    <th className="text-right font-normal">Затримка</th>
                    <th className="text-right font-normal">Setup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {['FIFO', 'EDD', 'SPT', 'ATCS'].map((rule) => {
                    const m = strategies[rule];
                    if (!m) return null;
                    const highlight = compareData?.bestBySetup === rule || compareData?.bestByTardiness === rule;
                    return (
                      <tr key={rule} className="h-10">
                        <td className={`font-mono font-semibold ${highlight ? 'text-accent' : 'text-ink'}`}>
                          {rule}
                        </td>
                        <td className="text-right font-mono tabular-nums">{m.lateCount}</td>
                        <td className="text-right font-mono tabular-nums">
                          {formatDuration(m.totalTardinessMin)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatDuration(m.totalSetupMin)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
