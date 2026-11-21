import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable.jsx';
import { FormField } from '../components/FormField.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Money } from '../components/Money.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { materialsApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { MACHINE_TYPE_LABELS, formatDateTime } from '../lib/format.js';

const STATUS_TABS = [
  { key: '', label: 'Усі' },
  { key: 'ok', label: 'Ок' },
  { key: 'low', label: 'Мало' },
  { key: 'deficit', label: 'Дефіцит' },
];

function fmtQty(value, unit = '') {
  const num = Number(value ?? 0);
  const str = Number.isFinite(num)
    ? num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    : '0';
  return unit ? `${str} ${unit}` : str;
}

function StockLevelBar({ availableQty, minStockQty }) {
  const baseline = Math.max(minStockQty * 2, availableQty, 1);
  const pct = Math.max(0, Math.min(100, (availableQty / baseline) * 100));
  const color =
    availableQty < 0
      ? 'var(--st-danger-fg)'
      : availableQty <= minStockQty
        ? 'var(--st-quoted-fg)'
        : 'var(--st-progress-fg)';

  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
      <div
        className="h-full rounded-full wp-progress-fill"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function MaterialsPage() {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [statusFilter, setStatusFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [search, setSearch] = useState('');

  const [historyMaterialId, setHistoryMaterialId] = useState(() => searchParams.get('material') || '');
  const [actionModal, setActionModal] = useState(null); // { mode: 'receipt' | 'adjust', material }
  const [qtyInput, setQtyInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const paramId = searchParams.get('material');
    if (paramId) {
      setHistoryMaterialId(paramId);
    }
  }, [searchParams]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['materials'],
    queryFn: materialsApi.list,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['material', historyMaterialId],
    queryFn: () => materialsApi.get(historyMaterialId),
    enabled: Boolean(historyMaterialId),
  });

  const materials = useMemo(() => data?.materials ?? [], [data]);
  const shortages = useMemo(() => data?.shortages ?? [], [data]);
  const summary = data?.summary ?? {
    totalMaterials: materials.length,
    totalStockValue: 0,
    lowStockCount: 0,
    deficitCount: 0,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (statusFilter && m.status !== statusFilter) return false;
      if (machineFilter && m.machineType !== machineFilter) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.code.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [materials, statusFilter, machineFilter, search]);

  const stockMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.mode === 'receipt') {
        return materialsApi.receipt(payload.materialId, {
          qty: payload.qty,
          comment: payload.comment,
        });
      }
      return materialsApi.adjust(payload.materialId, {
        deltaQty: payload.qty,
        comment: payload.comment,
      });
    },
    onSuccess: (_res, variables) => {
      setActionError('');
      setPendingConfirm(null);
      setActionModal(null);
      setQtyInput('');
      setCommentInput('');
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['material', variables.materialId] });
    },
    onError: (err) => {
      setActionError(err.message || 'Помилка оновлення залишку');
      setPendingConfirm(null);
    },
  });

  const openAction = (mode, material) => {
    setActionError('');
    setQtyInput(mode === 'receipt' ? '1' : '-0.1');
    setCommentInput(
      mode === 'receipt' ? 'Поповнення складу від постачальника' : 'Інвентаризація складу'
    );
    setActionModal({ mode, material });
  };

  const closeHistory = () => {
    setHistoryMaterialId('');
    if (searchParams.has('material')) {
      const next = new URLSearchParams(searchParams);
      next.delete('material');
      setSearchParams(next, { replace: true });
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Матеріал',
      render: (row) => (
        <div className="min-w-0 max-w-[240px]">
          <div className="truncate font-medium text-ink">{row.name}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <span>{row.code}</span>
            <span>·</span>
            <span>{MACHINE_TYPE_LABELS[row.machineType] ?? row.machineType}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'stockQty',
      label: 'На складі',
      align: 'right',
      cellClassName: 'font-mono text-xs tabular-nums whitespace-nowrap',
      render: (row) => fmtQty(row.stockQty, row.unit),
    },
    {
      key: 'reservedQty',
      label: 'Зарезервовано',
      align: 'right',
      headerClassName: 'hidden md:table-cell',
      cellClassName: 'hidden md:table-cell font-mono text-xs tabular-nums text-ink-secondary whitespace-nowrap',
      render: (row) => fmtQty(row.reservedQty, row.unit),
    },
    {
      key: 'inWorkQty',
      label: 'У роботі',
      align: 'right',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell font-mono text-xs tabular-nums text-ink-secondary whitespace-nowrap',
      render: (row) => fmtQty(row.inWorkQty, row.unit),
    },
    {
      key: 'availableQty',
      label: 'Доступно',
      align: 'right',
      cellClassName: 'font-mono text-xs tabular-nums whitespace-nowrap min-w-[110px]',
      render: (row) => (
        <div>
          <div className={row.availableQty < 0 ? 'font-semibold text-accent' : 'font-medium text-ink'}>
            {fmtQty(row.availableQty, row.unit)}
          </div>
          <StockLevelBar availableQty={row.availableQty} minStockQty={row.minStockQty} />
        </div>
      ),
    },
    {
      key: 'minStockQty',
      label: 'Мін. залишок',
      align: 'right',
      headerClassName: 'hidden xl:table-cell',
      cellClassName: 'hidden xl:table-cell font-mono text-xs tabular-nums text-ink-muted whitespace-nowrap',
      render: (row) => fmtQty(row.minStockQty, row.unit),
    },
    {
      key: 'status',
      label: 'Статус',
      cellClassName: 'whitespace-nowrap',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'stockValue',
      label: 'Вартість',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell whitespace-nowrap',
      render: (row) => <Money value={row.stockValue} className="text-xs font-medium text-ink" />,
    },
    {
      key: 'actions',
      label: 'Дії',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      render: (row) => (
        <div className="inline-flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => openAction('receipt', row)}
            className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
            title="Оформити прихід"
          >
            <Plus className="h-3 w-3" />
            Прихід
          </button>
          {isOwner ? (
            <button
              type="button"
              onClick={() => openAction('adjust', row)}
              className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-line-strong hover:text-ink"
              title="Ручне коригування (тільки власник)"
              aria-label={`Коригувати ${row.code}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setHistoryMaterialId(row.id)}
            className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-line-strong hover:text-ink"
            title="Історія руху"
            aria-label={`Історія ${row.code}`}
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  const historyMaterial = detailData?.material;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Матеріали та склад"
        count={summary.totalMaterials}
        subtitle="Складські залишки, резерви під підтверджені замовлення та прогноз дефіциту"
      />

      {actionError ? (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="flex items-center justify-between rounded-xl border px-3.5 py-2 text-xs"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Позицій складу" value={summary.totalMaterials} hint="Активні матеріали" />
        <StatCard
          label="Вартість складу"
          moneyValue={summary.totalStockValue}
          hint="За обліковими цінами"
        />
        <StatCard label="Малий залишок" value={summary.lowStockCount} hint="Доступно ≤ мін. норми" />
        <StatCard
          label="Дефіцит за планом"
          value={summary.deficitCount}
          accent={summary.deficitCount > 0}
          hint="Потребують закупівлі"
        />
      </div>

      {shortages.length > 0 ? (
        <div
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="rounded-2xl border p-4 text-xs"
        >
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Прогноз дефіциту за планом ({shortages.length})</span>
          </div>
          <div className="space-y-1.5">
            {shortages.map((s) => (
              <div key={s.materialId} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{s.materialName}</span>{' '}
                  <span className="font-mono">({s.materialCode})</span>: не вистачає{' '}
                  <strong className="font-mono">{fmtQty(s.deficitQty, s.unit)}</strong>
                  {s.deficitDate ? (
                    <>
                      {' · '}критична дата: <strong className="font-mono">{formatDateTime(s.deficitDate)}</strong>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.affectedOrders.map((ord) => (
                    <Link
                      key={ord.orderId}
                      to={`/orders/${ord.orderId}`}
                      className="rounded-full border border-current/30 px-2 py-0.5 font-mono text-[11px] hover:bg-white/20"
                    >
                      {ord.orderCode}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-2xl bg-subtle p-1" role="tablist" aria-label="Статус складу">
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
                  active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            aria-label="Тип обладнання"
            className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Усе обладнання</option>
            {Object.entries(MACHINE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-initial">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" strokeWidth={1.75} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Назва або код матеріалу..."
              aria-label="Пошук матеріалів"
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm">
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
          rows={filtered}
          isLoading={isLoading}
          onRowClick={(row) => setHistoryMaterialId(row.id)}
          emptyText="Матеріалів за обраними фільтрами не знайдено."
        />
      )}

      {/* Stock Receipt / Owner Adjustment Form Modal */}
      <Modal
        open={Boolean(actionModal)}
        onClose={() => setActionModal(null)}
        title={
          actionModal
            ? actionModal.mode === 'receipt'
              ? `Прихід: ${actionModal.material.name}`
              : `Ручне коригування: ${actionModal.material.name}`
            : ''
        }
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setActionModal(null)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скасувати
            </button>
            <button
              type="button"
              onClick={() => {
                const parsedQty = Number(qtyInput);
                const trimmed = commentInput.trim();
                if (!Number.isFinite(parsedQty) || parsedQty === 0) {
                  setActionError('Вкажіть коректну ненульову кількість');
                  return;
                }
                if (actionModal.mode === 'receipt' && parsedQty <= 0) {
                  setActionError('Кількість приходу має бути більшою за 0');
                  return;
                }
                if (trimmed.length < 2) {
                  setActionError('Додайте коментар (мінімум 2 символи)');
                  return;
                }
                setPendingConfirm({
                  mode: actionModal.mode,
                  materialId: actionModal.material.id,
                  materialName: actionModal.material.name,
                  unit: actionModal.material.unit,
                  qty: parsedQty,
                  comment: trimmed,
                });
              }}
              className="rounded-full bg-cta px-5 py-2 text-sm font-medium text-on-cta hover:opacity-90"
            >
              Далі
            </button>
          </>
        }
      >
        {actionModal ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2 font-mono text-xs text-ink-secondary">
              Поточний залишок на складі: <strong>{fmtQty(actionModal.material.stockQty, actionModal.material.unit)}</strong>
              {' · '}доступно: <strong>{fmtQty(actionModal.material.availableQty, actionModal.material.unit)}</strong>
            </div>

            <FormField
              label={
                actionModal.mode === 'receipt'
                  ? `Кількість приходу (${actionModal.material.unit})`
                  : `Зміна залишку ± (${actionModal.material.unit})`
              }
              required
            >
              <input
                type="number"
                step={0.01}
                min={actionModal.mode === 'receipt' ? 0.001 : undefined}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>

            <FormField label="Коментар" required>
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
              />
            </FormField>
          </div>
        ) : null}
      </Modal>

      {/* Confirmation step before mutating stock */}
      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        onClose={() => setPendingConfirm(null)}
        isPending={stockMutation.isPending}
        title={
          pendingConfirm?.mode === 'receipt'
            ? 'Підтвердити прихід матеріалу?'
            : 'Підтвердити коригування залишку?'
        }
        message={
          pendingConfirm
            ? `${pendingConfirm.materialName}: ${pendingConfirm.qty > 0 ? '+' : ''}${fmtQty(pendingConfirm.qty, pendingConfirm.unit)} (${pendingConfirm.comment}).`
            : ''
        }
        confirmLabel={pendingConfirm?.mode === 'receipt' ? 'Зарахувати прихід' : 'Застосувати'}
        onConfirm={() => {
          if (pendingConfirm) {
            stockMutation.mutate(pendingConfirm);
          }
        }}
      />

      {/* Movement history modal */}
      <Modal
        open={Boolean(historyMaterialId)}
        onClose={closeHistory}
        title={
          historyMaterial
            ? `Журнал руху: ${historyMaterial.name} (${historyMaterial.code})`
            : 'Журнал руху матеріалу'
        }
        maxWidth="max-w-3xl"
        footer={
          <button
            type="button"
            onClick={closeHistory}
            className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
          >
            Закрити
          </button>
        }
      >
        {detailLoading ? (
          <div className="py-6 text-center font-mono text-xs text-ink-muted">Завантаження рухів...</div>
        ) : historyMaterial ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2">
                <div className="text-[10px] uppercase text-ink-muted">На складі</div>
                <div className="mt-0.5 font-semibold text-ink">
                  {fmtQty(historyMaterial.stockQty, historyMaterial.unit)}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2">
                <div className="text-[10px] uppercase text-ink-muted">Зарезервовано</div>
                <div className="mt-0.5 font-semibold text-ink">
                  {fmtQty(historyMaterial.reservedQty, historyMaterial.unit)}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2">
                <div className="text-[10px] uppercase text-ink-muted">Доступно</div>
                <div className="mt-0.5 font-semibold text-ink">
                  {fmtQty(historyMaterial.availableQty, historyMaterial.unit)}
                </div>
              </div>
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-2xl border border-line">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="h-8 border-b border-line bg-subtle text-[10.5px] font-mono uppercase text-ink-muted">
                    <th className="px-3 text-left font-normal">Дата</th>
                    <th className="px-3 text-left font-normal">Тип</th>
                    <th className="px-3 text-right font-normal">К-сть</th>
                    <th className="px-3 text-left font-normal">Замовлення / коментар</th>
                    <th className="px-3 text-left font-normal">Хто</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(historyMaterial.stockMovements ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                        Записів руху поки немає.
                      </td>
                    </tr>
                  ) : (
                    historyMaterial.stockMovements.map((mv) => (
                      <tr key={mv.id} className="h-10">
                        <td className="px-3 font-mono text-[11px] text-ink-muted whitespace-nowrap">
                          {formatDateTime(mv.createdAt)}
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <StatusBadge status={mv.type} />
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums whitespace-nowrap text-ink">
                          {fmtQty(mv.qty, historyMaterial.unit)}
                        </td>
                        <td className="px-3 text-ink-secondary">
                          {mv.order ? (
                            <Link
                              to={`/orders/${mv.order.id}`}
                              onClick={closeHistory}
                              className="mr-1.5 font-mono font-medium text-accent hover:underline"
                            >
                              {mv.order.code}
                            </Link>
                          ) : null}
                          <span>{mv.comment}</span>
                        </td>
                        <td className="px-3 text-ink-muted whitespace-nowrap">
                          {mv.user?.name ?? 'Система'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
