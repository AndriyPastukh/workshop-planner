import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Money } from '../components/Money.jsx';
import { OrderFormModal } from '../components/OrderFormModal.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { PricingBreakdownTable } from '../components/PricingBreakdownTable.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { ordersApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  MACHINE_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_NEXT_ACTIONS,
  formatDateTime,
} from '../lib/format.js';

function fmtQty(value, unit = '') {
  const num = Number(value ?? 0);
  const str = Number.isFinite(num)
    ? num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    : '0';
  return unit ? `${str} ${unit}` : str;
}

function formatAuditEntry(entry) {
  if (entry.action === 'ORDER_CREATED') {
    const st = ORDER_STATUS_LABELS[entry.payload?.status] ?? entry.payload?.status ?? 'Чернетка';
    return `Створено замовлення (${st})`;
  }
  if (entry.action === 'ORDER_STATUS_CHANGED') {
    const fromLabel = ORDER_STATUS_LABELS[entry.payload?.from] ?? entry.payload?.from;
    const toLabel = ORDER_STATUS_LABELS[entry.payload?.to] ?? entry.payload?.to;
    return `Зміна статусу: ${fromLabel} → ${toLabel}`;
  }
  if (entry.action === 'ORDER_UPDATED') {
    return 'Оновлено параметри або позиції замовлення';
  }
  return entry.action;
}

export default function OrderDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [actualInputs, setActualInputs] = useState({});
  const [warningsBanner, setWarningsBanner] = useState([]);
  const [actionError, setActionError] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id),
    enabled: Boolean(id),
  });

  const order = data?.order;

  const transitionMutation = useMutation({
    mutationFn: ({ nextStatus, actualUsages }) =>
      ordersApi.transition(id, nextStatus, actualUsages),
    onSuccess: (res) => {
      setActionError('');
      setPendingAction(null);
      setCompleteModalOpen(false);
      if (Array.isArray(res.warnings) && res.warnings.length > 0) {
        setWarningsBanner(res.warnings);
      }
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err) => {
      setActionError(err.message || 'Не вдалося виконати перехід статусу');
      setPendingAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => ordersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      navigate('/orders', { replace: true });
    },
    onError: (err) => {
      setActionError(err.message || 'Не вдалося видалити замовлення');
      setPendingAction(null);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 rounded bg-subtle wp-skeleton" />
        <div className="h-12 w-72 rounded-2xl bg-subtle wp-skeleton" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-line bg-surface wp-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="space-y-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          До списку замовлень
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <div style={{ color: 'var(--st-danger-fg)' }}>
            {error?.message || 'Замовлення не знайдено'}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-xl border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
          >
            Повторити
          </button>
        </div>
      </div>
    );
  }

  const nextAction = ORDER_STATUS_NEXT_ACTIONS[order.status];
  const canEdit = order.status === 'draft' || order.status === 'quoted';
  const canCancel = !['done', 'cancelled'].includes(order.status);
  const canDelete = isOwner && (order.status === 'draft' || order.status === 'cancelled');
  const isOverdue =
    ['confirmed', 'in_progress'].includes(order.status) && Date.parse(order.deadline) < Date.now();

  const spentEntries = Object.entries(order.materialTotals?.spentByUnit ?? {}).filter(
    ([, val]) => val > 0
  );
  const spentLabel =
    spentEntries.length > 0
      ? spentEntries.map(([unit, qty]) => fmtQty(qty, unit)).join(' + ')
      : 'Ще не списано';

  const openCompleteDialog = () => {
    const initial = {};
    for (const item of order.items ?? []) {
      const def = item.actualMaterialQty ?? item.materialSummary?.plannedQty ?? item.plannedMaterialQty ?? 0;
      initial[item.id] = String(def);
    }
    setActualInputs(initial);
    setCompleteModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          До замовлень
        </Link>
      </div>

      <PageHeader
        title={order.code}
        subtitle={`${order.customer?.name ?? 'Клієнт'}${order.customer?.company ? ` · ${order.customer.company}` : ''}${order.customer?.phone ? ` · ${order.customer.phone}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {order.isRush ? <StatusBadge status="rush" /> : null}
            <StatusBadge status={order.status} />

            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-xs font-medium text-ink hover:bg-subtle"
              >
                <Pencil className="h-3.5 w-3.5" />
                Редагувати
              </button>
            ) : null}

            {nextAction ? (
              <button
                type="button"
                onClick={() => {
                  if (nextAction.status === 'done') {
                    openCompleteDialog();
                  } else {
                    setPendingAction({
                      type: 'transition',
                      nextStatus: nextAction.status,
                      label: nextAction.label,
                    });
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-5 text-sm font-medium text-on-cta hover:opacity-90"
              >
                <CheckCircle2 className="h-4 w-4" />
                {nextAction.label}
              </button>
            ) : null}

            {canCancel ? (
              <button
                type="button"
                onClick={() =>
                  setPendingAction({
                    type: 'transition',
                    nextStatus: 'cancelled',
                    label: 'Скасувати замовлення',
                    danger: true,
                  })
                }
                className="inline-flex h-10 items-center gap-1 rounded-full border border-line-strong bg-surface px-3.5 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent"
              >
                <XCircle className="h-3.5 w-3.5" />
                Скасувати
              </button>
            ) : null}

            {canDelete ? (
              <button
                type="button"
                onClick={() => setPendingAction({ type: 'delete', danger: true })}
                className="inline-flex h-10 items-center gap-1 rounded-full border border-line-strong bg-surface px-3.5 text-xs font-medium text-ink-muted hover:text-ink"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Видалити
              </button>
            ) : null}
          </div>
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
          className="flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-xs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              {warningsBanner.map((w, idx) => (
                <div key={idx}>{w.message}</div>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setWarningsBanner([])} className="font-medium underline">
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
          className="flex items-center justify-between rounded-2xl border px-4 py-2.5 text-xs"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Клієнт"
          value={<span className="block truncate text-lg font-semibold">{order.customer?.name}</span>}
          hint={order.customer?.email || order.customer?.company || 'Без нотаток'}
        />
        <StatCard
          label="Дедлайн"
          value={formatDateTime(order.deadline)}
          accent={isOverdue}
          hint={isOverdue ? 'Протермінований або на межі' : 'Контрольний термін'}
        />
        <StatCard
          label="Пріоритет"
          value={`P${order.priority}`}
          hint={order.isRush ? 'Термінове замовлення (RUSH)' : 'Стандартна черга'}
        />
        <StatCard
          label="До сплати"
          moneyValue={order.totalPrice}
          hint={`Собівартість ${order.totalCost?.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`}
        />
      </div>

      {order.notes ? (
        <div className="rounded-2xl border border-line bg-subtle/40 px-4 py-3 text-sm text-ink-secondary">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Примітка: </span>
          {order.notes}
        </div>
      ) : null}

      {/* Positions table */}
      <section className="space-y-2.5">
        <h2 className="text-base font-semibold text-ink">Позиції замовлення ({order.items?.length ?? 0})</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="h-10 border-b border-line bg-subtle font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-3.5 text-left font-normal">Позиція</th>
                <th className="px-3.5 text-left font-normal">Процес</th>
                <th className="px-3.5 text-left font-normal">Матеріал</th>
                <th className="px-3.5 text-right font-normal">К-сть</th>
                <th className="px-3.5 text-right font-normal">Час верстата</th>
                <th className="px-3.5 text-right font-normal">Собівартість</th>
                <th className="px-3.5 text-right font-normal">Ціна</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(order.items ?? []).map((item) => (
                <tr key={item.id} className="h-12">
                  <td className="px-3.5 py-2 font-medium text-ink">{item.title}</td>
                  <td className="px-3.5 py-2 text-ink-secondary whitespace-nowrap">
                    {MACHINE_TYPE_LABELS[item.machineType] ?? item.machineType}
                  </td>
                  <td className="px-3.5 py-2 font-mono text-ink-secondary whitespace-nowrap">
                    {item.material?.name} ({item.material?.code})
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono tabular-nums">{item.qty} шт</td>
                  <td className="px-3.5 py-2 text-right font-mono tabular-nums text-ink-secondary">
                    {(item.qty * item.runTimeH).toFixed(2)} год
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    <Money value={item.cost} className="text-ink-secondary" />
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    <Money value={item.price} className="font-semibold text-ink" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Receipt-style pricing breakdown */}
      <section className="space-y-2.5">
        <h2 className="text-base font-semibold text-ink">Деталізація ціни (чек)</h2>
        <PricingBreakdownTable items={order.items ?? []} totals={order.pricingSummary ?? null} />
      </section>

      {/* Order materials block */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Матеріали замовлення</h2>
          <Link
            to="/materials"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Склад матеріалів
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="h-10 border-b border-line bg-subtle font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-3.5 text-left font-normal">Позиція / Матеріал</th>
                <th className="px-3.5 text-right font-normal">Заплановано</th>
                <th className="px-3.5 text-right font-normal">Зарезервовано</th>
                <th className="px-3.5 text-right font-normal">Списано факт.</th>
                <th className="px-3.5 text-right font-normal">Відходи</th>
                <th className="px-3.5 text-right font-normal">Вартість</th>
                <th className="px-3.5 text-left font-normal">Статус</th>
                <th className="px-3.5 text-right font-normal">Рухи</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(order.items ?? []).map((item) => {
                const ms = item.materialSummary ?? {};
                const unit = ms.unit ?? item.material?.unit ?? 'од.';
                const showActualCost = ms.actualSpentQty > 0;
                return (
                  <tr key={item.id} className="h-12">
                    <td className="px-3.5 py-2">
                      <div className="font-medium text-ink">{item.title}</div>
                      <div className="font-mono text-[11px] text-ink-muted">
                        {item.material?.name} ({item.material?.code})
                      </div>
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                      {fmtQty(ms.plannedQty, unit)}
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums text-ink-secondary whitespace-nowrap">
                      {fmtQty(ms.reservedQty, unit)}
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums font-medium text-ink whitespace-nowrap">
                      {fmtQty(ms.actualSpentQty, unit)}
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums text-ink-secondary whitespace-nowrap">
                      {ms.wasteQty > 0 ? '+' : ''}
                      {fmtQty(ms.wasteQty, unit)}
                    </td>
                    <td className="px-3.5 py-2 text-right whitespace-nowrap">
                      {showActualCost ? (
                        <Money value={ms.actualCost} className="font-medium text-ink" />
                      ) : (
                        <span className="text-ink-muted" title="Планова вартість">
                          ~<Money value={ms.plannedCost} />
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap">
                      <StatusBadge status={ms.materialStatus ?? 'not_needed'} />
                    </td>
                    <td className="px-3.5 py-2 text-right whitespace-nowrap">
                      <Link
                        to={`/materials?material=${item.materialId}`}
                        className="font-mono text-[11px] font-medium text-accent hover:underline"
                      >
                        Рухи →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-subtle/50">
                <td colSpan={3} className="px-3.5 py-3 text-sm font-semibold text-ink">
                  Витрачено матеріалу
                </td>
                <td colSpan={2} className="px-3.5 py-3 text-right font-mono text-sm font-semibold text-ink">
                  {spentLabel}
                </td>
                <td className="px-3.5 py-3 text-right text-sm font-bold text-ink whitespace-nowrap">
                  <Money value={order.materialTotals?.totalActualCost ?? 0} />
                </td>
                <td colSpan={2} className="px-3.5 py-3 text-right font-mono text-[11px] text-ink-muted">
                  План: <Money value={order.materialTotals?.totalPlannedCost ?? 0} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Status timeline & stock movement ledger for this order */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold text-ink">Історія статусів</h2>
          {(order.auditLogs ?? []).length === 0 ? (
            <p className="text-xs text-ink-muted">Записи історії відсутні.</p>
          ) : (
            <ol className="space-y-2.5 text-xs">
              {order.auditLogs.map((log) => (
                <li
                  key={log.id}
                  className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-b-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium text-ink">{formatAuditEntry(log)}</div>
                    <div className="text-[11px] text-ink-muted">{log.user?.name ?? 'Система'}</div>
                  </div>
                  <div className="font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold text-ink">Рухи складу по замовленню</h2>
          {(order.stockMovements ?? []).length === 0 ? (
            <p className="text-xs text-ink-muted">Складських операцій ще не зафіксовано.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {order.stockMovements.map((mv) => (
                <div
                  key={mv.id}
                  className="flex items-start justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={mv.type} />
                      <Link
                        to={`/materials?material=${mv.materialId}`}
                        className="font-medium text-ink hover:text-accent hover:underline"
                      >
                        {mv.material?.name ?? mv.material?.code}
                      </Link>
                      <span className="font-mono font-semibold text-ink">
                        {fmtQty(mv.qty, mv.material?.unit ?? '')}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-muted">{mv.comment}</div>
                  </div>
                  <div className="text-right font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    <div>{formatDateTime(mv.createdAt)}</div>
                    <div className="font-sans">{mv.user?.name ?? 'Система'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <OrderFormModal open={editOpen} order={order} onClose={() => setEditOpen(false)} />

      {/* Complete order modal with actual material usage input */}
      <Modal
        open={completeModalOpen}
        onClose={() => setCompleteModalOpen(false)}
        title={`Завершення замовлення ${order.code}`}
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCompleteModalOpen(false)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={transitionMutation.isPending}
              onClick={() => {
                const actualUsages = (order.items ?? []).map((item) => {
                  const parsed = Number(actualInputs[item.id]);
                  const fallback = item.actualMaterialQty ?? item.materialSummary?.plannedQty ?? 0;
                  return {
                    orderItemId: item.id,
                    actualMaterialQty: Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback,
                  };
                });
                transitionMutation.mutate({ nextStatus: 'done', actualUsages });
              }}
              className="rounded-full bg-cta px-5 py-2 text-sm font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
            >
              {transitionMutation.isPending ? 'Збереження...' : 'Завершити і зафіксувати'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-secondary">
            Підтвердьте фактичну витрату матеріалу по кожній позиції. Перевитрата або економія
            автоматично запишеться у журнал рухів (`waste`).
          </p>
          {(order.items ?? []).map((item) => {
            const unit = item.material?.unit ?? 'од.';
            const planned = item.materialSummary?.plannedQty ?? item.plannedMaterialQty ?? 0;
            const currentVal = Number(actualInputs[item.id] ?? planned);
            const diff = Number((currentVal - planned).toFixed(3));
            return (
              <div key={item.id} className="rounded-xl border border-line bg-subtle/40 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-ink">{item.title}</div>
                  <div className="font-mono text-ink-muted">План: {fmtQty(planned, unit)}</div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <label className="text-ink-secondary" htmlFor={`actual-${item.id}`}>
                    Факт ({unit}):
                  </label>
                  <input
                    id={`actual-${item.id}`}
                    type="number"
                    min={0}
                    step={0.01}
                    value={actualInputs[item.id] ?? ''}
                    onChange={(e) =>
                      setActualInputs((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    className="h-9 w-32 rounded-xl border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent"
                  />
                  <span className="font-mono text-[11px] text-ink-muted">
                    Відходи: {diff > 0 ? '+' : ''}
                    {fmtQty(diff, unit)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        isPending={transitionMutation.isPending || deleteMutation.isPending}
        danger={Boolean(pendingAction?.danger)}
        title={
          pendingAction?.type === 'delete'
            ? `Видалити ${order.code}?`
            : `${pendingAction?.label ?? 'Підтвердити дію'}?`
        }
        message={
          pendingAction?.type === 'delete'
            ? 'Замовлення буде безповоротно видалено з бази даних.'
            : pendingAction?.nextStatus
              ? `Перевести ${order.code} у статус «${ORDER_STATUS_LABELS[pendingAction.nextStatus]}»?`
              : ''
        }
        confirmLabel={pendingAction?.type === 'delete' ? 'Видалити' : pendingAction?.label}
        onConfirm={() => {
          if (!pendingAction) return;
          if (pendingAction.type === 'delete') {
            deleteMutation.mutate();
          } else {
            transitionMutation.mutate({ nextStatus: pendingAction.nextStatus });
          }
        }}
      />
    </div>
  );
}
