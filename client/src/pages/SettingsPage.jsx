import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable.jsx';
import { FormField } from '../components/FormField.jsx';
import { Modal } from '../components/Modal.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { materialsApi, settingsApi, setupRulesApi, templatesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { MACHINE_TYPE_LABELS } from '../lib/format.js';

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-60';

const TABS = [
  { key: 'tariffs', label: 'Тарифи та ATCS' },
  { key: 'setup', label: 'Матриця переналаштувань' },
  { key: 'templates', label: 'Шаблони виробів' },
];

export default function SettingsPage() {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('tariffs');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Tab 1 state
  const [form, setForm] = useState(null);

  // Tab 2 state
  const [ruleTypeFilter, setRuleTypeFilter] = useState('');
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [rType, setRType] = useState('fdm_3d');
  const [rFrom, setRFrom] = useState('PLA');
  const [rTo, setRTo] = useState('PETG');
  const [rMin, setRMin] = useState(15);

  // Tab 3 state
  const [tplModal, setTplModal] = useState(null);
  const [tName, setTName] = useState('');
  const [tMaterialId, setTMaterialId] = useState('');
  const [tUsage, setTUsage] = useState(0.08);
  const [tRunTimeH, setTRunTimeH] = useState(1.0);
  const [tPrepH, setTPrepH] = useState(0.25);
  const [tPostH, setTPostH] = useState(0.25);
  const [tDefaultQty, setTDefaultQty] = useState(5);

  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const { data: rulesData } = useQuery({ queryKey: ['setup-rules'], queryFn: setupRulesApi.list });
  const { data: templatesData } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list });
  const { data: materialsData } = useQuery({ queryKey: ['materials'], queryFn: materialsApi.list });

  const materials = useMemo(() => materialsData?.materials ?? [], [materialsData]);
  const rules = useMemo(() => rulesData?.rules ?? [], [rulesData]);
  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData]);

  useEffect(() => {
    const s = settingsData?.settings;
    if (!s) return;
    setForm({
      workshopName: s.workshopName ?? '',
      laborRate: s.laborRate ?? 300,
      electricityRatePerKwh: s.electricityRatePerKwh ?? 4.32,
      overheadPct: Math.round((s.overheadPct ?? 0.15) * 1000) / 10,
      marginPct: Math.round((s.marginPct ?? 0.3) * 1000) / 10,
      rushSurcharge: Math.round((s.rushSurcharge ?? 0.25) * 1000) / 10,
      taxPct: Math.round((s.taxPct ?? 0.05) * 1000) / 10,
      atcsK1: s.atcsK1 ?? 2.0,
      atcsK2: s.atcsK2 ?? 0.5,
      failureRates: Object.fromEntries(
        Object.entries(s.failureRates ?? {}).map(([k, v]) => [k, Math.round(v * 1000) / 10])
      ),
      volumeDiscounts: (s.volumeDiscounts ?? []).map((tier) => ({
        minQty: tier.minQty,
        discountPct: Math.round(tier.discountPct * 1000) / 10,
      })),
    });
  }, [settingsData]);

  const saveSettingsMutation = useMutation({
    mutationFn: () =>
      settingsApi.update({
        workshopName: form.workshopName.trim(),
        laborRate: Number(form.laborRate),
        electricityRatePerKwh: Number(form.electricityRatePerKwh),
        overheadPct: Number(form.overheadPct) / 100,
        marginPct: Number(form.marginPct) / 100,
        rushSurcharge: Number(form.rushSurcharge) / 100,
        taxPct: Number(form.taxPct) / 100,
        atcsK1: Number(form.atcsK1),
        atcsK2: Number(form.atcsK2),
        failureRates: Object.fromEntries(
          Object.entries(form.failureRates).map(([k, v]) => [k, Number(v) / 100])
        ),
        volumeDiscounts: form.volumeDiscounts.map((t) => ({
          minQty: Number(t.minQty),
          discountPct: Number(t.discountPct) / 100,
        })),
      }),
    onSuccess: () => {
      setErrorMsg('');
      setNotice('Налаштування майстерні збережено.');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося зберегти налаштування'),
  });

  const upsertRuleMutation = useMutation({
    mutationFn: () =>
      setupRulesApi.upsert({
        machineType: rType,
        fromMaterial: rFrom.trim().toUpperCase(),
        toMaterial: rTo.trim().toUpperCase(),
        minutes: Number(rMin),
      }),
    onSuccess: () => {
      setErrorMsg('');
      setRuleModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['setup-rules'] });
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося зберегти правило'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => setupRulesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup-rules'] }),
  });

  const openTplModal = (mode, tpl = null) => {
    setErrorMsg('');
    if (tpl) {
      setTName(tpl.name);
      setTMaterialId(tpl.materialId);
      setTUsage(tpl.usage);
      setTRunTimeH(tpl.runTimeH);
      setTPrepH(tpl.prepH);
      setTPostH(tpl.postProcessH);
      setTDefaultQty(tpl.defaultQty);
    } else {
      setTName('');
      setTMaterialId(materials[0]?.id ?? '');
      setTUsage(0.08);
      setTRunTimeH(1.0);
      setTPrepH(0.25);
      setTPostH(0.25);
      setTDefaultQty(5);
    }
    setTplModal({ mode, tpl });
  };

  const saveTplMutation = useMutation({
    mutationFn: () => {
      const mat = materials.find((m) => m.id === tMaterialId);
      const payload = {
        name: tName.trim(),
        machineType: mat?.machineType ?? 'fdm_3d',
        materialId: tMaterialId,
        usage: Number(tUsage),
        runTimeH: Number(tRunTimeH),
        prepH: Number(tPrepH),
        postProcessH: Number(tPostH),
        defaultQty: Number(tDefaultQty),
      };
      if (tplModal.mode === 'edit') {
        return templatesApi.update(tplModal.tpl.id, payload);
      }
      return templatesApi.create(payload);
    },
    onSuccess: () => {
      setErrorMsg('');
      setTplModal(null);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося зберегти шаблон'),
  });

  const deleteTplMutation = useMutation({
    mutationFn: (id) => templatesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  const filteredRules = useMemo(
    () => rules.filter((r) => !ruleTypeFilter || r.machineType === ruleTypeFilter),
    [rules, ruleTypeFilter]
  );

  const ruleColumns = [
    {
      key: 'machineType',
      label: 'Обладнання',
      render: (row) => MACHINE_TYPE_LABELS[row.machineType] ?? row.machineType,
    },
    {
      key: 'pair',
      label: 'Перехід матеріалу',
      cellClassName: 'font-mono text-xs',
      render: (row) => `${row.fromMaterial} → ${row.toMaterial}`,
    },
    {
      key: 'minutes',
      label: 'Час setup',
      align: 'right',
      cellClassName: 'font-mono text-xs font-medium',
      render: (row) => `${row.minutes} хв`,
    },
    ...(isOwner
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) => (
              <button
                type="button"
                onClick={() => deleteRuleMutation.mutate(row.id)}
                className="rounded border border-line p-1 text-ink-muted hover:text-ink"
                aria-label="Видалити правило"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ),
          },
        ]
      : []),
  ];

  const tplColumns = [
    {
      key: 'name',
      label: 'Шаблон',
      render: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: 'machineType',
      label: 'Процес',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell text-xs text-ink-secondary',
      render: (row) => MACHINE_TYPE_LABELS[row.machineType] ?? row.machineType,
    },
    {
      key: 'material',
      label: 'Матеріал',
      cellClassName: 'font-mono text-xs text-ink-secondary',
      render: (row) => row.material?.code ?? '—',
    },
    {
      key: 'usage',
      label: 'Витрата / Час',
      align: 'right',
      cellClassName: 'font-mono text-xs tabular-nums',
      render: (row) => `${row.usage} · ${row.runTimeH} год`,
    },
    ...(isOwner
      ? [
          {
            key: 'actions',
            label: 'Дії',
            align: 'right',
            render: (row) => (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openTplModal('edit', row)}
                  className="rounded border border-line p-1 text-ink-muted hover:text-ink"
                  aria-label={`Редагувати ${row.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteTplMutation.mutate(row.id)}
                  className="rounded border border-line p-1 text-ink-muted hover:text-ink"
                  aria-label={`Видалити ${row.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Налаштування"
        subtitle="Економічні ставки, параметри ATCS (k1/k2), матриця переналаштувань та типові вироби"
      />

      {!isOwner ? (
        <div
          style={{
            backgroundColor: 'var(--st-quoted-bg)',
            color: 'var(--st-quoted-fg)',
            borderColor: 'var(--st-quoted-bd)',
          }}
          className="rounded-2xl border px-4 py-2.5 text-xs"
        >
          Режим перегляду — редагування глобальних ставок, правил переналаштування та шаблонів
          доступне лише власнику майстерні.
        </div>
      ) : null}

      {notice ? (
        <div
          style={{
            backgroundColor: 'var(--st-progress-bg)',
            color: 'var(--st-progress-fg)',
            borderColor: 'var(--st-progress-bd)',
          }}
          className="flex items-center justify-between rounded-2xl border px-4 py-2.5 text-xs"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

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

      <div className="flex flex-wrap gap-1 rounded-2xl bg-subtle p-1 w-max max-w-full" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`h-9 rounded-xl px-3.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tariffs' && form ? (
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Назва майстерні" className="sm:col-span-2">
              <input
                type="text"
                disabled={!isOwner}
                value={form.workshopName}
                onChange={(e) => setForm({ ...form, workshopName: e.target.value })}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="Ставка оператора (₴/год)">
              <input
                type="number"
                disabled={!isOwner}
                value={form.laborRate}
                onChange={(e) => setForm({ ...form, laborRate: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="Електроенергія (₴/кВт·год)">
              <input
                type="number"
                step={0.01}
                disabled={!isOwner}
                value={form.electricityRatePerKwh}
                onChange={(e) => setForm({ ...form, electricityRatePerKwh: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="Накладні (%)">
              <input
                type="number"
                step={0.5}
                disabled={!isOwner}
                value={form.overheadPct}
                onChange={(e) => setForm({ ...form, overheadPct: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="Маржа (%)">
              <input
                type="number"
                step={0.5}
                disabled={!isOwner}
                value={form.marginPct}
                onChange={(e) => setForm({ ...form, marginPct: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="RUSH-надбавка (%)">
              <input
                type="number"
                step={0.5}
                disabled={!isOwner}
                value={form.rushSurcharge}
                onChange={(e) => setForm({ ...form, rushSurcharge: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="Податок (%)">
              <input
                type="number"
                step={0.5}
                disabled={!isOwner}
                value={form.taxPct}
                onChange={(e) => setForm({ ...form, taxPct: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="ATCS k1 (вага терміновості)">
              <input
                type="number"
                step={0.1}
                disabled={!isOwner}
                value={form.atcsK1}
                onChange={(e) => setForm({ ...form, atcsK1: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
            <FormField label="ATCS k2 (вага переналашт.)">
              <input
                type="number"
                step={0.1}
                disabled={!isOwner}
                value={form.atcsK2}
                onChange={(e) => setForm({ ...form, atcsK2: e.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-2 lg:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-line bg-subtle/30 p-3">
              <div className="text-xs font-semibold text-ink-secondary">Коефіцієнти ризику браку (%)</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(MACHINE_TYPE_LABELS).map(([key, label]) => (
                  <FormField key={key} label={label}>
                    <input
                      type="number"
                      step={0.5}
                      disabled={!isOwner}
                      value={form.failureRates[key] ?? 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          failureRates: { ...form.failureRates, [key]: e.target.value },
                        })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </FormField>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-line bg-subtle/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-secondary">Знижки за партію</span>
                {isOwner ? (
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        volumeDiscounts: [...form.volumeDiscounts, { minQty: 50, discountPct: 18 }],
                      })
                    }
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + Додати поріг
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {form.volumeDiscounts.map((tier, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="text-ink-muted">Від</span>
                    <input
                      type="number"
                      disabled={!isOwner}
                      value={tier.minQty}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          volumeDiscounts: form.volumeDiscounts.map((t, i) =>
                            i === idx ? { ...t, minQty: e.target.value } : t
                          ),
                        })
                      }
                      className="h-8 w-20 rounded-lg border border-line bg-surface px-2 font-mono"
                    />
                    <span className="text-ink-muted">шт →</span>
                    <input
                      type="number"
                      step={0.5}
                      disabled={!isOwner}
                      value={tier.discountPct}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          volumeDiscounts: form.volumeDiscounts.map((t, i) =>
                            i === idx ? { ...t, discountPct: e.target.value } : t
                          ),
                        })
                      }
                      className="h-8 w-20 rounded-lg border border-line bg-surface px-2 font-mono"
                    />
                    <span className="text-ink-muted">%</span>
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            volumeDiscounts: form.volumeDiscounts.filter((_, i) => i !== idx),
                          })
                        }
                        className="ml-auto rounded p-1 text-ink-muted hover:text-ink"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isOwner ? (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={saveSettingsMutation.isPending}
                onClick={() => saveSettingsMutation.mutate()}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-5 text-sm font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saveSettingsMutation.isPending ? 'Збереження...' : 'Зберегти ставки'}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'setup' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={ruleTypeFilter}
              onChange={(e) => setRuleTypeFilter(e.target.value)}
              className="h-9 rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-accent"
            >
              <option value="">Усе обладнання</option>
              {Object.entries(MACHINE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {isOwner ? (
              <button
                type="button"
                onClick={() => setRuleModalOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cta px-4 text-xs font-medium text-on-cta hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Додати / оновити правило
              </button>
            ) : null}
          </div>
          <DataTable columns={ruleColumns} rows={filteredRules} emptyText="Правил переналаштування немає." />
        </div>
      ) : null}

      {tab === 'templates' ? (
        <div className="space-y-3">
          {isOwner ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => openTplModal('create')}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cta px-4 text-xs font-medium text-on-cta hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Новий шаблон
              </button>
            </div>
          ) : null}
          <DataTable columns={tplColumns} rows={templates} emptyText="Шаблонів виробів немає." />
        </div>
      ) : null}

      {/* Setup rule modal */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title="Правило переналаштування"
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRuleModalOpen(false)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={upsertRuleMutation.isPending}
              onClick={() => upsertRuleMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta"
            >
              Зберегти
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Обладнання">
            <select value={rType} onChange={(e) => setRType(e.target.value)} className={INPUT_CLASS}>
              {Object.entries(MACHINE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="З матеріалу (код)">
            <input type="text" value={rFrom} onChange={(e) => setRFrom(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
          </FormField>
          <FormField label="На матеріал (код)">
            <input type="text" value={rTo} onChange={(e) => setRTo(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
          </FormField>
          <FormField label="Тривалість (хв)">
            <input type="number" min={0} value={rMin} onChange={(e) => setRMin(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
          </FormField>
        </div>
      </Modal>

      {/* Template create/edit modal */}
      <Modal
        open={Boolean(tplModal)}
        onClose={() => setTplModal(null)}
        title={tplModal?.mode === 'edit' ? `Редагувати шаблон: ${tplModal.tpl.name}` : 'Новий шаблон виробу'}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setTplModal(null)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saveTplMutation.isPending || tName.trim().length < 2}
              onClick={() => saveTplMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta"
            >
              Зберегти
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Назва виробу" required>
            <input type="text" value={tName} onChange={(e) => setTName(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Матеріал (визначає процес)" required>
            <select value={tMaterialId} onChange={(e) => setTMaterialId(e.target.value)} className={INPUT_CLASS}>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({MACHINE_TYPE_LABELS[m.machineType]})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-2.5">
            <FormField label="Витрата / шт">
              <input type="number" step={0.01} value={tUsage} onChange={(e) => setTUsage(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
            </FormField>
            <FormField label="Час верстата (год)">
              <input type="number" step={0.05} value={tRunTimeH} onChange={(e) => setTRunTimeH(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
            </FormField>
            <FormField label="Підготовка (год)">
              <input type="number" step={0.05} value={tPrepH} onChange={(e) => setTPrepH(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
            </FormField>
            <FormField label="Постобробка (год)">
              <input type="number" step={0.05} value={tPostH} onChange={(e) => setTPostH(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
            </FormField>
            <FormField label="К-сть за замовч.">
              <input type="number" min={1} value={tDefaultQty} onChange={(e) => setTDefaultQty(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
            </FormField>
          </div>
        </div>
      </Modal>
    </div>
  );
}
