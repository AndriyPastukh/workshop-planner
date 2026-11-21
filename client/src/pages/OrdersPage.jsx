import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { Money } from '../components/Money.jsx';
import { OrderFormModal } from '../components/OrderFormModal.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { ordersApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_NEXT_ACTIONS,
  formatDateTime,
} from '../lib/format.js';

const STATUS_TABS = [
  { key: '', label: 'Усі' },
  { key: 'in_progress', label: 'У роботі' },
  { key: 'confirmed', label: 'Підтверджено' },
  { key: 'quoted', label: 'Прорахунок' },
  { key: 'draft', label: 'Чернетка' },
  { key: 'done', label: 'Виконано' },
  { key: 'cancelled', label: 'Скасовано' },
];

export default function OrdersPage() {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [rushOnly, setRushOnly] = useState(false);

  const [pendingAction, setPendingAction] = useState(null);
  const [formState, setFormState] = useState({ open: false, order: null });
  const [warningsBanner, setWarningsBanner] = useState([]);
  const [actionError, setActionError] = useState('');

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['orders', { status: statusFilter, search, rushOnly }],
    queryFn: () =>
      ordersApi.list({
        status: statusFilter || undefined,
        search: search.trim() || undefined,
        isRush: rushOnly ? 'true' : undefined,
      }),
  });

  const orders = useMemo(() => data?.orders ?? [], [data]);

  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }) => ordersApi.transition(id, nextStatus),
    onSuccess: (res) => {
      setActionError('');
      if (Array.isArray(res.warnings) && res.warnings.length > 0) {
        setWarningsBanner(res.warnings);
      }
      setPendingAction(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => {
      setActionError(err.message || 'Не вдалося змінити статус');
      setPendingAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => ordersApi.remove(id),
    onSuccess: () => {
      setActionError('');
      setPendingAction(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (err) => {
      setActionError(err.message || 'Не вдалося видалити замовлення');
      setPendingAction(null);
    },
  });

  const stats = useMemo(() => {
    const now = Date.now();
    const active = orders.filter((o) => o.status === 'confirmed' || o.status === 'in_progress');
    const rushOrLate = active.filter((o) => o.isRush || Date.parse(o.deadline) < now);
    const activeTotal = active.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    return {
      total: orders.length,
      activeCount: active.length,
      rushOrLateCount: rushOrLate.length,
      activeTotal,
    };
  }, [orders]);

  const columns = [
    {
      key: 'code',
      label: 'Код',
      cellClassName: 'whitespace-nowrap',
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <Link
              to={`/orders/${row.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs font-medium text-ink whitespace-nowrap hover:text-accent hover:underline"
            >
              {row.code}
            </Link>
            {row.isRush ? (
              <span
                className="hidden sm:inline-block rounded border px-1 py-0.5 font-mono text-[10px] font-medium leading-none text-accent"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  borderColor: 'var(--st-progress-bd)',
                }}
              >
                RUSH
              </span>
            ) : null}
          </div>
          {/* Compact mobile-only summary so 360px fits cleanly without horizontal page scroll */}
          <div className="mt-0.5 flex items-center gap-1 md:hidden max-w-[106px]">
            <span className="truncate text-[11px] text-ink-secondary">{row.customer?.name}</span>
            {row.isRush ? (
              <span
                className="shrink-0 font-mono text-[9px] font-semibold text-accent"
                title="Термінове"
              >
                R
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'Клієнт',
      headerClassName: 'hidden md:table-cell',
      cellClassName: 'hidden md:table-cell max-w-[138px]',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{row.customer?.name}</div>
          {row.customer?.company ? (
            <div className="truncate text-xs text-ink-muted">{row.customer.company}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'items',
      label: 'Позиції',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell max-w-[148px]',
      render: (row) => {
        const first = row.items?.[0];
        const extra = (row.items?.length ?? 0) - 1;
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-ink-secondary">{first?.title ?? '—'}</span>
            {extra > 0 ? (
              <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                +{extra}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Статус',
      cellClassName: 'whitespace-nowrap',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'priority',
      label: 'Пріор.',
      align: 'right',
      headerClassName: 'hidden 2xl:table-cell',
      cellClassName: 'hidden 2xl:table-cell font-mono text-xs text-ink-secondary',
      render: (row) => `P${row.priority}`,
    },
    {
      key: 'deadline',
      label: 'Дедлайн',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell whitespace-nowrap',
      render: (row) => {
        const isActive = row.status === 'confirmed' || row.status === 'in_progress';
        const pastDue = isActive && Date.parse(row.deadline) < Date.now();
        return (
          <span
            className={`font-mono text-xs tabular-nums ${
              pastDue ? 'font-medium text-accent' : 'text-ink-secondary'
            }`}
          >
            {formatDateTime(row.deadline)}
          </span>
        );
      },
    },
    {
      key: 'cost',
      label: 'Собівартість',
      align: 'right',
      headerClassName: 'hidden xl:table-cell',
      cellClassName: 'hidden xl:table-cell text-ink-secondary whitespace-nowrap',
      render: (row) => <Money value={row.totalCost} className="text-xs" />,
    },
    {
      key: 'price',
      label: 'Ціна',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      render: (row) => (
        <div className="text-right">
          <Money value={row.totalPrice} className="text-xs font-medium text-ink" />
          <div className="mt-0.5 font-mono text-[10px] text-ink-muted sm:hidden">
            {formatDateTime(row.deadline)}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Дії',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell whitespace-nowrap',
      render: (row) => {
        const nextAction = ORDER_STATUS_NEXT_ACTIONS[row.status];
        const canEdit = row.status === 'draft' || row.status === 'quoted';
        const canDelete = isOwner && (row.status === 'draft' || row.status === 'cancelled');
        return (
          <div className="inline-flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setFormState({ open: true, order: row })}
                className="rounded border border-line p-1 text-ink-muted hover:border-line-strong hover:text-ink"
                title="Редагувати замовлення"
                aria-label={`Редагувати ${row.code}`}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
            {nextAction ? (
              <button
                type="button"
                onClick={() =>
                  setPendingAction({
                    type: 'transition',
                    order: row,
                    nextStatus: nextAction.status,
                    label: nextAction.label,
                  })
                }
                className="rounded border border-line-strong bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
              >
                {nextAction.label}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => setPendingAction({ type: 'delete', order: row })}
                className="rounded border border-line p-1 text-ink-muted hover:border-line-strong hover:text-ink"
                title="Видалити замовлення"
                aria-label={`Видалити ${row.code}`}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Замовлення"
        count={orders.length}
        subtitle="Виробничий реєстр індивідуальних замовлень майстерні"
        actions={
          <button
            type="button"
            onClick={() => setFormState({ open: true, order: null })}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-sm font-medium text-on-cta transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Нове замовлення</span>
          </button>
        }
      />

      {warningsBanner.length > 0 ? (
        <div
          role="status"
          style={{
            backgroundColor: 'var(--st-confirmed-bg)',
            color: 'var(--st-confirmed-fg)',
            borderColor: 'var(--st-confirmed-bd)',
          }}
          className="flex items-start justify-between gap-3 rounded-md border px-3.5 py-2.5 text-xs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <div className="space-y-0.5">
              {warningsBanner.map((w, idx) => (
                <div key={idx}>{w.message}</div>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWarningsBanner([])}
            className="font-medium underline"
          >
            Сховати
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="flex items-center justify-between rounded-md border px-3.5 py-2 text-xs"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="У вибірці" value={stats.total} hint="Замовлень у таблиці" />
        <StatCard label="Активна черга" value={stats.activeCount} hint="Підтверджено + у роботі" />
        <StatCard
          label="Термінові / ризик"
          value={stats.rushOrLateCount}
          accent={stats.rushOrLateCount > 0}
          hint="Потребують пріоритету"
        />
        <StatCard
          label="Сума активних"
          moneyValue={stats.activeTotal}
          hint="Очікувана виручка черги"
        />
      </div>

      {/* Filters strip */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-2xl bg-subtle p-1" role="tablist" aria-label="Фільтр за статусом">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(tab.key)}
                className={`h-9 rounded-xl px-3.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-initial">
            <Search
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Код, клієнт, позиція..."
              aria-label="Пошук замовлень"
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-accent"
            />
          </div>

          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-ink-secondary select-none">
            <input
              type="checkbox"
              checked={rushOnly}
              onChange={(e) => setRushOnly(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>Термінові</span>
          </label>
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 text-sm">
          <span style={{ color: 'var(--st-danger-fg)' }}>
            Помилка завантаження: {error?.message || 'невідома помилка'}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border border-line-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-subtle"
          >
            Повторити
          </button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={orders}
          isLoading={isLoading}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          emptyText="За обраними фільтрами замовлень не знайдено."
          emptyAction={
            <button
              type="button"
              onClick={() => {
                setStatusFilter('');
                setSearch('');
                setRushOnly(false);
              }}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скинути фільтри
            </button>
          }
        />
      )}

      {/* Confirm transition / deletion dialog */}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        isPending={statusMutation.isPending || deleteMutation.isPending}
        danger={pendingAction?.type === 'delete'}
        title={
          pendingAction?.type === 'delete'
            ? `Видалити ${pendingAction.order.code}?`
            : `Змінити статус ${pendingAction?.order?.code ?? ''}?`
        }
        message={
          pendingAction?.type === 'delete'
            ? 'Замовлення буде безповоротно видалено з бази даних.'
            : pendingAction
              ? `Перевести замовлення зі статусу «${ORDER_STATUS_LABELS[pendingAction.order.status]}» у «${ORDER_STATUS_LABELS[pendingAction.nextStatus]}»?`
              : ''
        }
        confirmLabel={pendingAction?.type === 'delete' ? 'Видалити' : pendingAction?.label}
        onConfirm={() => {
          if (!pendingAction) {
            return;
          }
          if (pendingAction.type === 'delete') {
            deleteMutation.mutate(pendingAction.order.id);
          } else {
            statusMutation.mutate({
              id: pendingAction.order.id,
              nextStatus: pendingAction.nextStatus,
            });
          }
        }}
      />

      <OrderFormModal
        open={formState.open}
        order={formState.order}
        onClose={() => setFormState({ open: false, order: null })}
      />
    </div>
  );
}
