import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { customersApi, materialsApi, ordersApi, pricingApi, templatesApi } from '../lib/api.js';
import { FormField } from './FormField.jsx';
import { Modal } from './Modal.jsx';
import { PricingBreakdownTable } from './PricingBreakdownTable.jsx';

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent';

function toLocalDateTimeInput(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date(Date.now() + 3 * 24 * 60 * 60_000);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeEmptyItem(material) {
  return {
    title: material ? `Деталь (${material.code})` : 'Нова деталь',
    materialId: material?.id ?? '',
    qty: 2,
    usage: 0.08,
    runTimeH: 0.8,
    prepH: 0.25,
    postProcessH: 0.25,
    setupMin: 15,
  };
}

export function OrderFormModal({ open, onClose, order = null, onSaved }) {
  const isEdit = Boolean(order);
  const canEditItems = !order || order.status === 'draft' || order.status === 'quoted';
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: customersApi.list,
    enabled: open,
  });
  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: materialsApi.list,
    enabled: open,
  });
  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
    enabled: open,
  });

  const customers = useMemo(() => customersData?.customers ?? [], [customersData]);
  const materials = useMemo(() => materialsData?.materials ?? [], [materialsData]);
  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData]);

  const [customerId, setCustomerId] = useState('');
  const [deadline, setDeadline] = useState(() => toLocalDateTimeInput());
  const [priority, setPriority] = useState(1);
  const [status, setStatus] = useState('draft');
  const [isRush, setIsRush] = useState(false);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [submitError, setSubmitError] = useState('');

  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Sync form state whenever modal opens or target order changes
  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitError('');
    if (order) {
      setCustomerId(order.customerId ?? '');
      setDeadline(toLocalDateTimeInput(order.deadline));
      setPriority(order.priority ?? 1);
      setStatus(order.status ?? 'draft');
      setIsRush(Boolean(order.isRush));
      setNotes(order.notes ?? '');
      setItems(
        (order.items ?? []).map((it) => ({
          title: it.title,
          materialId: it.materialId,
          qty: it.qty,
          usage: it.usage,
          runTimeH: it.runTimeH,
          prepH: it.prepH ?? 0,
          postProcessH: it.postProcessH ?? 0,
          setupMin: it.setupMin ?? 15,
        }))
      );
    } else {
      setCustomerId(customers[0]?.id ?? '');
      setDeadline(toLocalDateTimeInput());
      setPriority(1);
      setStatus('draft');
      setIsRush(false);
      setNotes('');
      setItems([makeEmptyItem(materials[0])]);
    }
  }, [open, order, customers, materials]);

  // Debounced live pricing recalculation (250 ms)
  const previewPayload = useMemo(() => {
    const validItems = items
      .filter((it) => it.materialId && Number(it.qty) > 0)
      .map((it) => ({
        title: it.title || 'Позиція',
        materialId: it.materialId,
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        usage: Math.max(0, Number(it.usage) || 0),
        runTimeH: Math.max(0, Number(it.runTimeH) || 0),
        prepH: Math.max(0, Number(it.prepH) || 0),
        postProcessH: Math.max(0, Number(it.postProcessH) || 0),
        setupMin: Math.max(0, Number(it.setupMin) || 0),
      }));
    if (validItems.length === 0) {
      return null;
    }
    return { isRush, items: validItems };
  }, [items, isRush]);

  useEffect(() => {
    if (!open || !previewPayload) {
      setPreviewData(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await pricingApi.preview(previewPayload);
        if (!cancelled) {
          setPreviewData(res);
        }
      } catch {
        // Keep last preview or let submit surface validation details
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, previewPayload]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId && !isEdit) {
        throw new Error('Оберіть клієнта');
      }
      const isoDeadline = new Date(deadline).toISOString();
      if (isEdit) {
        const patch = {
          deadline: isoDeadline,
          priority: Number(priority),
          isRush,
          notes: notes.trim() || null,
          ...(canEditItems && previewPayload ? { items: previewPayload.items } : {}),
        };
        return ordersApi.update(order.id, patch);
      }
      return ordersApi.create({
        customerId,
        deadline: isoDeadline,
        priority: Number(priority),
        status,
        isRush,
        notes: notes.trim() || null,
        items: previewPayload?.items ?? [],
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      if (res?.order?.id) {
        queryClient.invalidateQueries({ queryKey: ['order', res.order.id] });
      }
      onSaved?.(res.order);
      onClose();
    },
    onError: (err) => {
      setSubmitError(err.message || 'Не вдалося зберегти замовлення');
    },
  });

  const updateItem = (idx, patch) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const applyTemplate = (idx, tplId) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) {
      return;
    }
    updateItem(idx, {
      title: tpl.name,
      materialId: tpl.materialId,
      qty: tpl.defaultQty,
      usage: tpl.usage,
      runTimeH: tpl.runTimeH,
      prepH: tpl.prepH,
      postProcessH: tpl.postProcessH,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Редагувати ${order.code}` : 'Нове замовлення'}
      maxWidth="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
          >
            Скасувати
          </button>
          <button
            type="button"
            disabled={mutation.isPending || !previewPayload}
            onClick={() => mutation.mutate()}
            className="rounded-full bg-cta px-5 py-2 text-sm font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Збереження...' : isEdit ? 'Зберегти зміни' : 'Створити замовлення'}
          </button>
        </>
      }
    >
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {submitError ? (
          <div
            role="alert"
            style={{
              backgroundColor: 'var(--st-danger-bg)',
              color: 'var(--st-danger-fg)',
              borderColor: 'var(--st-danger-bd)',
            }}
            className="rounded-xl border px-3 py-2 text-xs"
          >
            {submitError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!isEdit ? (
            <FormField label="Клієнт" required className="sm:col-span-2">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className={INPUT_CLASS}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.company ? `(${c.company})` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          <FormField label="Дедлайн" required>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={INPUT_CLASS}
            />
          </FormField>

          <FormField label="Пріоритет (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 1)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </FormField>

          {!isEdit ? (
            <FormField label="Початковий статус">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="draft">Чернетка</option>
                <option value="quoted">Прорахунок</option>
                <option value="confirmed">Підтверджено (резерв)</option>
              </select>
            </FormField>
          ) : null}

          <FormField label="Режим" className="flex flex-col justify-end">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs text-ink">
              <input
                type="checkbox"
                checked={isRush}
                onChange={(e) => setIsRush(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span>Термінове (RUSH)</span>
            </label>
          </FormField>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Позиції замовлення ({items.length})
            </span>
            {canEditItems ? (
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, makeEmptyItem(materials[0])])}
                className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink hover:bg-subtle"
              >
                <Plus className="h-3.5 w-3.5" />
                Додати позицію
              </button>
            ) : (
              <span className="text-[11px] text-ink-muted">
                Позиції заблоковані для статусу {order.status}
              </span>
            )}
          </div>

          {items.map((item, idx) => {
            const mat = materials.find((m) => m.id === item.materialId);
            return (
              <div key={idx} className="space-y-2 rounded-2xl border border-line bg-subtle/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-medium text-ink-muted">
                    Позиція #{idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {canEditItems && templates.length > 0 ? (
                      <select
                        value=""
                        onChange={(e) => applyTemplate(idx, e.target.value)}
                        className="h-7 rounded-lg border border-line bg-surface px-2 text-xs text-ink-secondary"
                      >
                        <option value="">Заповнити з шаблону...</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {canEditItems && items.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded p-1 text-ink-muted hover:text-ink"
                        aria-label="Видалити позицію"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                  <FormField label="Назва" className="sm:col-span-3">
                    <input
                      type="text"
                      disabled={!canEditItems}
                      value={item.title}
                      onChange={(e) => updateItem(idx, { title: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Матеріал" className="sm:col-span-3">
                    <select
                      disabled={!canEditItems}
                      value={item.materialId}
                      onChange={(e) => updateItem(idx, { materialId: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.pricePerUnit} ₴/{m.unit})
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="К-сть (шт)">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      disabled={!canEditItems}
                      value={item.qty}
                      onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>

                  <FormField label={`Витрата (${mat?.unit ?? 'од.'}/шт)`}>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      disabled={!canEditItems}
                      value={item.usage}
                      onChange={(e) => updateItem(idx, { usage: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>

                  <FormField label="Машин. (год/шт)">
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      disabled={!canEditItems}
                      value={item.runTimeH}
                      onChange={(e) => updateItem(idx, { runTimeH: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>

                  <FormField label="Підгот. (год)">
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      disabled={!canEditItems}
                      value={item.prepH}
                      onChange={(e) => updateItem(idx, { prepH: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>

                  <FormField label="Постобр. (год)">
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      disabled={!canEditItems}
                      value={item.postProcessH}
                      onChange={(e) => updateItem(idx, { postProcessH: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>

                  <FormField label="Setup (хв)">
                    <input
                      type="number"
                      min={0}
                      step={5}
                      disabled={!canEditItems}
                      value={item.setupMin}
                      onChange={(e) => updateItem(idx, { setupMin: Number(e.target.value) })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>
                </div>
              </div>
            );
          })}
        </div>

        <FormField label="Примітка">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Побажання щодо упакування, кольору тощо..."
            className={INPUT_CLASS}
          />
        </FormField>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            <span>Деталізація ціни (живий чек)</span>
            {previewLoading ? <span className="font-mono text-[11px] text-ink-muted">Оновлення...</span> : null}
          </div>
          <PricingBreakdownTable
            items={previewData?.items ?? []}
            totals={previewData?.totals ?? null}
            isLoading={previewLoading}
          />
        </div>
      </div>
    </Modal>
  );
}
