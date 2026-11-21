import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../components/DataTable.jsx';
import { FormField } from '../components/FormField.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Money } from '../components/Money.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { customersApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDateTime } from '../lib/format.js';

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent';

export default function CustomersPage() {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [selectedId, setSelectedId] = useState('');
  const [formModal, setFormModal] = useState(null); // null | { mode: 'create'|'edit', customer }
  const [pendingDelete, setPendingDelete] = useState(null);

  const [cName, setCName] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: customersApi.list,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['customer', selectedId],
    queryFn: () => customersApi.get(selectedId),
    enabled: Boolean(selectedId),
  });

  const customers = useMemo(() => data?.customers ?? [], [data]);

  const stats = useMemo(() => {
    const totalRevenue = customers.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const totalOrders = customers.reduce((s, c) => s + (c.ordersCount || 0), 0);
    const avgCheck = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    return { totalRevenue, totalOrders, avgCheck };
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.company ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'spent') return (b.totalSpent || 0) - (a.totalSpent || 0);
      if (sortBy === 'orders') return (b.ordersCount || 0) - (a.ordersCount || 0);
      return a.name.localeCompare(b.name, 'uk');
    });
  }, [customers, search, sortBy]);

  const openForm = (mode, customer = null) => {
    setErrorMsg('');
    if (customer) {
      setCName(customer.name);
      setCCompany(customer.company ?? '');
      setCPhone(customer.phone ?? '');
      setCEmail(customer.email ?? '');
      setCNotes(customer.notes ?? '');
    } else {
      setCName('');
      setCCompany('');
      setCPhone('');
      setCEmail('');
      setCNotes('');
    }
    setFormModal({ mode, customer });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: cName.trim(),
        company: cCompany.trim() || null,
        phone: cPhone.trim() || null,
        email: cEmail.trim() || null,
        notes: cNotes.trim() || null,
      };
      if (formModal.mode === 'edit') {
        return customersApi.update(formModal.customer.id, payload);
      }
      return customersApi.create(payload);
    },
    onSuccess: () => {
      setErrorMsg('');
      setFormModal(null);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (selectedId) {
        queryClient.invalidateQueries({ queryKey: ['customer', selectedId] });
      }
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося зберегти клієнта'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => customersApi.remove(id),
    onSuccess: () => {
      setErrorMsg('');
      setPendingDelete(null);
      if (selectedId === pendingDelete?.id) setSelectedId('');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Не вдалося видалити клієнта');
      setPendingDelete(null);
    },
  });

  const columns = [
    {
      key: 'name',
      label: 'Клієнт',
      render: (row) => (
        <div className="min-w-0 max-w-[230px]">
          <div className="truncate font-medium text-ink">{row.name}</div>
          {row.company ? (
            <div className="truncate text-xs text-ink-muted">{row.company}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'contacts',
      label: 'Контакти',
      headerClassName: 'hidden md:table-cell',
      cellClassName: 'hidden md:table-cell text-xs text-ink-secondary',
      render: (row) => (
        <div className="min-w-0">
          <div className="font-mono">{row.phone || '—'}</div>
          {row.email ? <div className="truncate text-ink-muted">{row.email}</div> : null}
        </div>
      ),
    },
    {
      key: 'ordersCount',
      label: 'Замовлень',
      align: 'right',
      cellClassName: 'font-mono text-xs tabular-nums',
      render: (row) => row.ordersCount ?? 0,
    },
    {
      key: 'totalSpent',
      label: 'Сума угод',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      render: (row) => <Money value={row.totalSpent} className="text-xs font-medium text-ink" />,
    },
    {
      key: 'avgOrderValue',
      label: 'Середній чек',
      align: 'right',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell whitespace-nowrap',
      render: (row) => <Money value={row.avgOrderValue} className="text-xs text-ink-secondary" />,
    },
    {
      key: 'actions',
      label: 'Дії',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      render: (row) => (
        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => openForm('edit', row)}
            className="rounded border border-line p-1 text-ink-muted hover:border-line-strong hover:text-ink"
            aria-label={`Редагувати ${row.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {isOwner && (row.ordersCount ?? 0) === 0 ? (
            <button
              type="button"
              onClick={() => setPendingDelete(row)}
              className="rounded border border-line p-1 text-ink-muted hover:border-line-strong hover:text-ink"
              aria-label={`Видалити ${row.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const detailCustomer = detailData?.customer;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Клієнти"
        count={customers.length}
        subtitle="Реєстр замовників, історія угод і розрахунок середнього чека"
        actions={
          <button
            type="button"
            onClick={() => openForm('create')}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-sm font-medium text-on-cta transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Новий клієнт</span>
          </button>
        }
      />

      {errorMsg ? (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="flex items-center justify-between rounded-2xl border px-4 py-2.5 text-xs"
        >
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Усього клієнтів" value={customers.length} hint="Активна база" />
        <StatCard label="Загальна виручка" moneyValue={stats.totalRevenue} hint="Без скасованих" />
        <StatCard label="Середній чек" moneyValue={stats.avgCheck} hint="По всіх угодах" />
        <StatCard label="Замовлень" value={stats.totalOrders} hint="Усього виконань" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" strokeWidth={1.75} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ім’я, компанія, телефон..."
            aria-label="Пошук клієнтів"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-accent"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          aria-label="Сортування"
          className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="name">За ім’ям</option>
          <option value="spent">За сумою угод</option>
          <option value="orders">За к-стю замовлень</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        isLoading={isLoading}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyText="Клієнтів за пошуком не знайдено."
      />

      {/* Customer Detail Modal */}
      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId('')}
        title={detailCustomer ? `${detailCustomer.name}` : 'Картка клієнта'}
        maxWidth="max-w-2xl"
        footer={
          <button
            type="button"
            onClick={() => setSelectedId('')}
            className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
          >
            Закрити
          </button>
        }
      >
        {detailLoading ? (
          <div className="py-6 text-center font-mono text-xs text-ink-muted">Завантаження...</div>
        ) : detailCustomer ? (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
              <div>
                <div className="font-semibold text-ink">{detailCustomer.company || 'Приватна особа'}</div>
                <div className="font-mono text-ink-muted">
                  {detailCustomer.phone || '—'} · {detailCustomer.email || '—'}
                </div>
              </div>
              <div className="text-right font-mono">
                <div>
                  Виручка: <Money value={detailCustomer.totalSpent} className="font-semibold text-ink" />
                </div>
                <div className="text-ink-muted">
                  Середній чек: <Money value={detailCustomer.avgOrderValue} />
                </div>
              </div>
            </div>

            {detailCustomer.notes ? (
              <p className="text-ink-secondary">{detailCustomer.notes}</p>
            ) : null}

            <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="h-8 border-b border-line bg-subtle font-mono text-[10.5px] uppercase text-ink-muted">
                    <th className="px-3 text-left font-normal">Код</th>
                    <th className="px-3 text-left font-normal">Статус</th>
                    <th className="px-3 text-right font-normal">Дедлайн</th>
                    <th className="px-3 text-right font-normal">Сума</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(detailCustomer.orders ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-5 text-center text-ink-muted">
                        Замовлень поки немає.
                      </td>
                    </tr>
                  ) : (
                    detailCustomer.orders.map((ord) => (
                      <tr key={ord.id} className="h-10">
                        <td className="px-3">
                          <Link
                            to={`/orders/${ord.id}`}
                            onClick={() => setSelectedId('')}
                            className="font-mono font-medium text-accent hover:underline"
                          >
                            {ord.code}
                          </Link>
                        </td>
                        <td className="px-3">
                          <StatusBadge status={ord.status} />
                        </td>
                        <td className="px-3 text-right font-mono text-ink-secondary whitespace-nowrap">
                          {formatDateTime(ord.deadline)}
                        </td>
                        <td className="px-3 text-right">
                          <Money value={ord.totalPrice} className="font-medium text-ink" />
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

      {/* Customer Create/Edit Modal */}
      <Modal
        open={Boolean(formModal)}
        onClose={() => setFormModal(null)}
        title={formModal?.mode === 'edit' ? `Редагувати: ${formModal.customer.name}` : 'Новий клієнт'}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setFormModal(null)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending || cName.trim().length < 2}
              onClick={() => saveMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Збереження...' : 'Зберегти'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Ім’я / контакт" required>
            <input type="text" value={cName} onChange={(e) => setCName(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Компанія">
            <input type="text" value={cCompany} onChange={(e) => setCCompany(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Телефон">
            <input type="text" value={cPhone} onChange={(e) => setCPhone(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Email">
            <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Нотатки">
            <input type="text" value={cNotes} onChange={(e) => setCNotes(e.target.value)} className={INPUT_CLASS} />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        isPending={deleteMutation.isPending}
        danger
        title={`Видалити ${pendingDelete?.name ?? ''}?`}
        message="Клієнта без замовлень буде видалено з довідника."
        confirmLabel="Видалити"
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </div>
  );
}
