import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarRange, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Money } from '../components/Money.jsx';
import { OrderFormModal } from '../components/OrderFormModal.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { analyticsApi, materialsApi, scheduleApi } from '../lib/api.js';
import {
  MACHINE_TYPE_LABELS,
  formatDateTime,
  formatDuration,
} from '../lib/format.js';

const STATUS_KEYS = ['in_progress', 'confirmed', 'quoted', 'draft', 'done', 'cancelled'];

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: analyticsApi.dashboard,
  });

  const { data: scheduleData } = useQuery({
    queryKey: ['schedule'],
    queryFn: scheduleApi.get,
  });

  const { data: warehouseData } = useQuery({
    queryKey: ['materials'],
    queryFn: materialsApi.list,
  });

  const kpi = dashData?.scheduleKpi ?? scheduleData?.metrics ?? {};
  const lateCount = kpi.lateCount ?? 0;
  const avgUtilPct = Math.round((kpi.avgUtilization ?? 0) * 100);
  const lowStockCount = dashData?.lowStockCount ?? 0;
  const ordersByStatus = dashData?.ordersByStatus ?? {};
  const totalOrders = Object.values(ordersByStatus).reduce((s, n) => s + Number(n || 0), 0);
  const upcomingDeadlines = dashData?.upcomingDeadlines ?? [];
  const lowStockMaterials = dashData?.lowStockMaterials ?? [];
  const shortages = warehouseData?.shortages ?? [];
  const machines = scheduleData?.machines ?? [];
  const entries = scheduleData?.entries ?? [];
  const utilByMachine = scheduleData?.metrics?.utilizationByMachine ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Огляд"
        subtitle="Оперативний стан виробництва, черги верстатів і складу на сьогодні"
        actions={
          <>
            <Link
              to="/planner"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-subtle"
            >
              <CalendarRange className="h-4 w-4" strokeWidth={1.75} />
              <span>Планувальник</span>
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-sm font-medium text-on-cta transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Нове замовлення</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Активна черга"
          value={dashLoading ? '—' : (dashData?.activeOrdersCount ?? 0)}
          hint="Підтверджено + у роботі"
        />
        <StatCard
          label="Запізнення"
          value={dashLoading ? '—' : lateCount}
          accent={lateCount > 0}
          hint={`Сумарно ${formatDuration(kpi.totalTardinessMin ?? 0)}`}
        />
        <StatCard
          label="Завантаження цеху"
          value={`${avgUtilPct}%`}
          hint={`Setup ${formatDuration(kpi.totalSetupMin ?? 0)}`}
        />
        <StatCard
          label="Ризики складу"
          value={dashLoading ? '—' : lowStockCount}
          accent={lowStockCount > 0}
          hint="Дефіцит або малий залишок"
        />
      </div>

      {/* Upcoming deadlines + Machine utilization */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Найближчі дедлайни</h2>
            <Link
              to="/orders"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              Усі замовлення
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {upcomingDeadlines.length === 0 ? (
            <p className="py-4 text-xs text-ink-muted">Активних замовлень із дедлайнами немає.</p>
          ) : (
            <div className="divide-y divide-line">
              {upcomingDeadlines.map((ord) => {
                const isLate = Date.parse(ord.deadline) < Date.now();
                return (
                  <Link
                    key={ord.id}
                    to={`/orders/${ord.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-subtle/40 rounded-lg px-1.5 -mx-1.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-ink">{ord.code}</span>
                        <StatusBadge status={ord.status} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-secondary">
                        {ord.customer?.name} · {ord._count?.items ?? 0} поз.
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`font-mono text-xs tabular-nums ${
                          isLate ? 'font-semibold text-accent' : 'text-ink-secondary'
                        }`}
                      >
                        {formatDateTime(ord.deadline)}
                      </div>
                      <Money value={ord.totalPrice} className="text-xs font-medium text-ink" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Завантаження верстатів</h2>
            <Link
              to="/machines"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              Верстати
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {machines.length === 0 ? (
            <p className="py-4 text-xs text-ink-muted">Дані про обладнання завантажуються...</p>
          ) : (
            <div className="space-y-3">
              {machines.map((m) => {
                const pct = Math.min(100, Math.round((utilByMachine[m.id] ?? 0) * 100));
                const jobsCount = entries.filter((e) => e.machineId === m.id).length;
                return (
                  <div key={m.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 truncate font-medium text-ink">
                        {m.name}{' '}
                        <span className="font-normal text-ink-muted">
                          ({MACHINE_TYPE_LABELS[m.type] ?? m.type})
                        </span>
                      </div>
                      <div className="shrink-0 font-mono text-ink-secondary tabular-nums">
                        {jobsCount} роб. · <strong className="text-ink">{pct}%</strong>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full wp-progress-fill"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: pct > 85 ? 'var(--accent)' : 'var(--st-progress-fg)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Orders by status + Warehouse risk warnings */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Статуси замовлень</h2>
            <span className="font-mono text-xs text-ink-muted">Усього: {totalOrders}</span>
          </div>
          <div className="space-y-2.5">
            {STATUS_KEYS.map((key) => {
              const count = Number(ordersByStatus[key] ?? 0);
              const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
              return (
                <Link
                  key={key}
                  to={`/orders`}
                  className="block rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-subtle/40"
                >
                  <div className="flex items-center justify-between text-xs">
                    <StatusBadge status={key} />
                    <span className="font-mono tabular-nums text-ink-secondary">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full wp-progress-fill bg-ink-muted/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Складські попередження</h2>
            <Link
              to="/materials"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              На склад
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {lowStockMaterials.length === 0 && shortages.length === 0 ? (
            <p className="py-4 text-xs text-ink-muted">Усі матеріали мають достатній запас.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {lowStockMaterials.map((m) => {
                const deficitInfo = shortages.find((s) => s.materialId === m.id);
                return (
                  <Link
                    key={m.id}
                    to={`/materials?material=${m.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 transition-colors hover:border-line-strong hover:bg-subtle/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0"
                          style={{
                            color: m.isNegative ? 'var(--st-danger-fg)' : 'var(--st-quoted-fg)',
                          }}
                        />
                        <span className="truncate font-medium text-ink">{m.name}</span>
                        <span className="font-mono text-[11px] text-ink-muted">({m.code})</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-ink-secondary">
                        Доступно: {m.availableQty} {m.unit} · мін. {m.minStockQty} {m.unit}
                        {deficitInfo?.deficitDate
                          ? ` · дефіцит з ${formatDateTime(deficitInfo.deficitDate)}`
                          : ''}
                      </div>
                    </div>
                    <StatusBadge status={m.isNegative ? 'deficit' : 'low'} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <OrderFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
