import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormField } from '../components/FormField.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { scheduleApi, settingsApi } from '../lib/api.js';
import { MACHINE_TYPE_LABELS, formatDuration, formatMoney } from '../lib/format.js';

const MACHINE_TYPES = ['fdm_3d', 'resin_3d', 'laser', 'cnc_wood'];
const RULES = ['ATCS', 'EDD', 'SPT', 'FIFO'];

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent';

function formatSignedDuration(deltaMin) {
  const val = Math.round(Number(deltaMin ?? 0));
  if (val === 0) return '0 хв';
  return `${val > 0 ? '+' : '−'}${formatDuration(Math.abs(val))}`;
}

function formatSignedMoney(val) {
  const num = Number(val ?? 0);
  if (Math.abs(num) < 0.005) return '0,00 ₴';
  return `${num > 0 ? '+' : ''}${formatMoney(num)}`;
}

function buildInitialScenario(settings) {
  return {
    extraMachines: { fdm_3d: 0, resin_3d: 0, laser: 0, cnc_wood: 0 },
    rule: 'ATCS',
    k1: settings?.atcsK1 ?? 2.0,
    k2: settings?.atcsK2 ?? 0.5,
    enableBatchSplit: false,
    ignoreLocks: false,
    marginPct: Math.round((settings?.marginPct ?? 0.3) * 100),
    laborRate: settings?.laborRate ?? 300,
    electricityRatePerKwh: settings?.electricityRatePerKwh ?? 4.32,
    rushSurcharge: Math.round((settings?.rushSurcharge ?? 0.25) * 100),
  };
}

function toPayload(form) {
  return {
    extraMachines: form.extraMachines,
    rule: form.rule,
    k1: Math.max(0.1, Number(form.k1) || 2),
    k2: Math.max(0.1, Number(form.k2) || 0.5),
    enableBatchSplit: Boolean(form.enableBatchSplit),
    ignoreLocks: Boolean(form.ignoreLocks),
    marginPct: Math.max(0, Number(form.marginPct) || 0) / 100,
    laborRate: Math.max(0, Number(form.laborRate) || 0),
    electricityRatePerKwh: Math.max(0, Number(form.electricityRatePerKwh) || 0),
    rushSurcharge: Math.max(0, Number(form.rushSurcharge) || 0) / 100,
  };
}

export default function WhatIfPage() {
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const baseSettings = settingsData?.settings;
  const [form, setForm] = useState(() => buildInitialScenario(null));
  const [initialized, setInitialized] = useState(false);

  const simMutation = useMutation({
    mutationFn: (payload) => scheduleApi.whatIf(payload),
  });

  useEffect(() => {
    if (baseSettings && !initialized) {
      const next = buildInitialScenario(baseSettings);
      setForm(next);
      setInitialized(true);
      simMutation.mutate(toPayload(next));
    } else if (!initialized && !baseSettings) {
      simMutation.mutate(toPayload(form));
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSettings, initialized]);

  const result = simMutation.data;
  const base = result?.baseline;
  const sim = result?.simulated;
  const delta = result?.delta;

  const setExtraMachine = (type, nextVal) => {
    const clamped = Math.max(0, Math.min(5, Math.floor(Number(nextVal) || 0)));
    setForm((prev) => ({
      ...prev,
      extraMachines: { ...prev.extraMachines, [type]: clamped },
    }));
  };

  const resetScenario = () => {
    const fresh = buildInitialScenario(baseSettings);
    setForm(fresh);
    simMutation.mutate(toPayload(fresh));
  };

  const comparisonRows = result
    ? [
        {
          label: 'Кількість верстатів',
          base: `${base.machineCount} шт`,
          sim: `${sim.machineCount} шт`,
          delta:
            sim.machineCount === base.machineCount
              ? '0'
              : `+${sim.machineCount - base.machineCount} шт`,
          tone: sim.machineCount > base.machineCount ? 'good' : 'neutral',
        },
        {
          label: 'Запізнення (кількість)',
          base: `${base.metrics.lateCount}`,
          sim: `${sim.metrics.lateCount}`,
          delta:
            delta.lateCount === 0
              ? '0'
              : `${delta.lateCount > 0 ? '+' : ''}${delta.lateCount}`,
          tone: delta.lateCount < 0 ? 'good' : delta.lateCount > 0 ? 'bad' : 'neutral',
        },
        {
          label: 'Сумарна затримка',
          base: formatDuration(base.metrics.totalTardinessMin),
          sim: formatDuration(sim.metrics.totalTardinessMin),
          delta: formatSignedDuration(delta.totalTardinessMin),
          tone:
            delta.totalTardinessMin < 0 ? 'good' : delta.totalTardinessMin > 0 ? 'bad' : 'neutral',
        },
        {
          label: 'Сумарний setup',
          base: formatDuration(base.metrics.totalSetupMin),
          sim: formatDuration(sim.metrics.totalSetupMin),
          delta: formatSignedDuration(delta.totalSetupMin),
          tone: delta.totalSetupMin < 0 ? 'good' : delta.totalSetupMin > 0 ? 'bad' : 'neutral',
        },
        {
          label: 'Тривалість плану (Makespan)',
          base: formatDuration(base.metrics.makespanMin),
          sim: formatDuration(sim.metrics.makespanMin),
          delta: formatSignedDuration(delta.makespanMin),
          tone: delta.makespanMin < 0 ? 'good' : delta.makespanMin > 0 ? 'bad' : 'neutral',
        },
        {
          label: 'Середнє завантаження',
          base: `${Math.round((base.metrics.avgUtilization ?? 0) * 100)}%`,
          sim: `${Math.round((sim.metrics.avgUtilization ?? 0) * 100)}%`,
          delta: `${delta.avgUtilization > 0 ? '+' : ''}${Math.round((delta.avgUtilization ?? 0) * 100)}%`,
          tone: 'neutral',
        },
        {
          label: 'Собівартість черги',
          base: formatMoney(base.finance.totalCost),
          sim: formatMoney(sim.finance.totalCost),
          delta: formatSignedMoney(delta.totalCost),
          tone: delta.totalCost < 0 ? 'good' : delta.totalCost > 0 ? 'bad' : 'neutral',
        },
        {
          label: 'Виручка (з податком)',
          base: formatMoney(base.finance.totalPrice),
          sim: formatMoney(sim.finance.totalPrice),
          delta: formatSignedMoney(delta.totalPrice),
          tone: delta.totalPrice > 0 ? 'good' : 'neutral',
        },
        {
          label: 'Оціночний прибуток',
          base: formatMoney(base.finance.estimatedProfit),
          sim: formatMoney(sim.finance.estimatedProfit),
          delta: formatSignedMoney(delta.estimatedProfit),
          tone: delta.estimatedProfit > 0 ? 'good' : delta.estimatedProfit < 0 ? 'bad' : 'neutral',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Симуляція «Що якщо?»"
        subtitle="Безпечне моделювання додаткових верстатів, параметрів ATCS, розбиття партій і тарифів без запису в БД"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetScenario}
              disabled={simMutation.isPending}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-xs font-medium text-ink hover:bg-subtle disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Скинути</span>
            </button>
            <button
              type="button"
              onClick={() => simMutation.mutate(toPayload(form))}
              disabled={simMutation.isPending}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-5 text-xs font-medium text-on-cta transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{simMutation.isPending ? 'Моделювання...' : 'Запустити симуляцію'}</span>
            </button>
          </div>
        }
      />

      {/* Scenario controls */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink">Додаткове обладнання</h2>
          <div className="space-y-2.5">
            {MACHINE_TYPES.map((type) => {
              const count = form.extraMachines[type] ?? 0;
              return (
                <div key={type} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-secondary">{MACHINE_TYPE_LABELS[type]}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Зменшити ${MACHINE_TYPE_LABELS[type]}`}
                      onClick={() => setExtraMachine(type, count - 1)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-subtle/50 font-mono text-sm text-ink hover:bg-subtle"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-ink">
                      +{count}
                    </span>
                    <button
                      type="button"
                      aria-label={`Додати ${MACHINE_TYPE_LABELS[type]}`}
                      onClick={() => setExtraMachine(type, count + 1)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-subtle/50 font-mono text-sm text-ink hover:bg-subtle"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink">Алгоритм планування</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <FormField label="Правило черги" className="col-span-2">
              <select
                value={form.rule}
                onChange={(e) => setForm((p) => ({ ...p, rule: e.target.value }))}
                className={INPUT_CLASS}
              >
                {RULES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="ATCS k1 (дедлайн)">
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={form.k1}
                onChange={(e) => setForm((p) => ({ ...p, k1: Number(e.target.value) }))}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="ATCS k2 (setup)">
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={form.k2}
                onChange={(e) => setForm((p) => ({ ...p, k2: Number(e.target.value) }))}
                className={INPUT_CLASS}
              />
            </FormField>
          </div>
          <div className="space-y-1.5 pt-1 text-xs">
            <label className="flex cursor-pointer items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={form.enableBatchSplit}
                onChange={(e) => setForm((p) => ({ ...p, enableBatchSplit: e.target.checked }))}
                className="accent-[var(--accent)]"
              />
              <span>Увімкнути розбиття великих партій</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-ink-secondary">
              <input
                type="checkbox"
                checked={form.ignoreLocks}
                onChange={(e) => setForm((p) => ({ ...p, ignoreLocks: e.target.checked }))}
                className="accent-[var(--accent)]"
              />
              <span>Ігнорувати закріплення (locked)</span>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink">Тарифи та маржа (ціноутворення)</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <FormField label="Маржа (%)">
              <input
                type="number"
                min={0}
                step={1}
                value={form.marginPct}
                onChange={(e) => setForm((p) => ({ ...p, marginPct: Number(e.target.value) }))}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="Праця (₴/год)">
              <input
                type="number"
                min={0}
                step={10}
                value={form.laborRate}
                onChange={(e) => setForm((p) => ({ ...p, laborRate: Number(e.target.value) }))}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="Електрика (₴/кВт·год)">
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.electricityRatePerKwh}
                onChange={(e) =>
                  setForm((p) => ({ ...p, electricityRatePerKwh: Number(e.target.value) }))
                }
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="Націнка RUSH (%)">
              <input
                type="number"
                min={0}
                step={1}
                value={form.rushSurcharge}
                onChange={(e) => setForm((p) => ({ ...p, rushSurcharge: Number(e.target.value) }))}
                className={INPUT_CLASS}
              />
            </FormField>
          </div>
        </div>
      </section>

      {simMutation.isError ? (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="rounded-2xl border px-4 py-3 text-xs"
        >
          {simMutation.error?.message || 'Помилка виконання симуляції'}
        </div>
      ) : null}

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard
              label="Запізнень у сценарії"
              value={sim.metrics.lateCount}
              accent={sim.metrics.lateCount > 0}
              hint={`Δ ${delta.lateCount > 0 ? '+' : ''}${delta.lateCount} до бази`}
            />
            <StatCard
              label="Сумарна затримка"
              value={formatDuration(sim.metrics.totalTardinessMin)}
              hint={`Δ ${formatSignedDuration(delta.totalTardinessMin)}`}
            />
            <StatCard
              label="Makespan плану"
              value={formatDuration(sim.metrics.makespanMin)}
              hint={`Δ ${formatSignedDuration(delta.makespanMin)}`}
            />
            <StatCard
              label="Оціночний прибуток"
              moneyValue={sim.finance.estimatedProfit}
              accent={delta.estimatedProfit > 0}
              hint={`Δ ${formatSignedMoney(delta.estimatedProfit)}`}
            />
          </div>

          {sim.virtualMachines?.length > 0 || sim.batchSplitEntriesCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-subtle/40 px-4 py-2.5 text-xs">
              <Sparkles className="h-4 w-4 text-accent" />
              {sim.virtualMachines?.length > 0 ? (
                <span className="text-ink-secondary">
                  Віртуальні верстати:{' '}
                  <strong className="text-ink">
                    {sim.virtualMachines.map((m) => m.name).join(', ')}
                  </strong>
                </span>
              ) : null}
              {sim.batchSplitEntriesCount > 0 ? (
                <span className="font-mono text-ink-secondary">
                  · Розбитих партій: <strong className="text-ink">{sim.batchSplitEntriesCount}</strong>
                </span>
              ) : null}
            </div>
          ) : null}

          <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="h-10 border-b border-line bg-subtle font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 text-left font-normal">Показник</th>
                  <th className="px-4 text-right font-normal">Базовий план</th>
                  <th className="px-4 text-right font-normal">Сценарій ({sim.rule})</th>
                  <th className="px-4 text-right font-normal">Δ Зміна</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="h-11">
                    <td className="px-4 font-medium text-ink">{row.label}</td>
                    <td className="px-4 text-right font-mono tabular-nums text-ink-secondary">
                      {row.base}
                    </td>
                    <td className="px-4 text-right font-mono font-semibold tabular-nums text-ink">
                      {row.sim}
                    </td>
                    <td
                      className="px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap"
                      style={{
                        color:
                          row.tone === 'good'
                            ? 'var(--st-progress-fg)'
                            : row.tone === 'bad'
                              ? 'var(--st-danger-fg)'
                              : 'var(--text-secondary)',
                      }}
                    >
                      {row.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
