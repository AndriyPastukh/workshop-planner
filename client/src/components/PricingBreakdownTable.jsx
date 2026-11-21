import { Money } from './Money.jsx';
import { formatMoney } from '../lib/format.js';

function fmtNum(value, maxDecimals = 3) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) {
    return '0';
  }
  return num.toLocaleString('uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

function fmtPct(rate) {
  const pct = Number(rate ?? 0) * 100;
  return `${fmtNum(pct, 1)}%`;
}

function normalizeItem(item) {
  const rawBd = item.breakdown ?? item.pricingBreakdown ?? {};
  const rates = item.appliedRates ?? rawBd.appliedRates ?? {};
  const inp = item.inputs ?? rawBd.inputs ?? {};

  const qty = inp.qty ?? item.qty ?? 1;
  const unit = item.unit ?? inp.unit ?? item.material?.unit ?? 'од.';
  const usage = inp.usage ?? item.usage ?? 0;
  const pricePerUnit = inp.pricePerUnit ?? item.material?.pricePerUnit ?? 0;
  const wastePct = rates.wastePct ?? inp.wastePct ?? item.material?.wastePct ?? 0;
  const runTimeH = inp.runTimeH ?? item.runTimeH ?? 0;
  const hourlyRate = inp.hourlyRate ?? 0;
  const setupTimeH = inp.setupTimeH ?? Number(((item.setupMin ?? 0) / 60).toFixed(2));
  const batchShare = inp.batchShare ?? item.batchShare ?? 1;
  const prepH = inp.prepH ?? item.prepH ?? 0;
  const postProcessH = inp.postProcessH ?? item.postProcessH ?? 0;
  const laborRate = inp.laborRate ?? 0;

  const base = rawBd.base ?? 0;
  const withRisk = rawBd.withRisk ?? base;
  const risk = rawBd.risk ?? Math.max(0, Number((withRisk - base).toFixed(2)));
  const cost = rawBd.cost ?? withRisk;
  const overhead = rawBd.overhead ?? Math.max(0, Number((cost - withRisk).toFixed(2)));
  const margin =
    rawBd.margin ??
    Number(((cost * (rates.marginPct ?? 0))).toFixed(2));
  const rush = rawBd.rush ?? 0;
  const discount = rawBd.discount ?? 0;
  const priceBeforeTax = rawBd.priceBeforeTax ?? cost + margin + rush - discount;
  const tax = rawBd.tax ?? rawBd.taxAmount ?? Math.max(0, Number(((rawBd.price ?? priceBeforeTax) - priceBeforeTax).toFixed(2)));
  const price = rawBd.price ?? priceBeforeTax + tax;
  const unitPrice = rawBd.unitPrice ?? (qty > 0 ? price / qty : price);
  const estimatedProfit = rawBd.estimatedProfit ?? Number((priceBeforeTax - cost).toFixed(2));

  return {
    title: item.title || item.materialName || item.material?.name || 'Позиція',
    materialCode: item.materialCode ?? item.material?.code ?? '',
    qty,
    unit,
    rates,
    breakdown: {
      material: rawBd.material ?? 0,
      machine: rawBd.machine ?? 0,
      setup: rawBd.setup ?? 0,
      labor: rawBd.labor ?? 0,
      base,
      risk,
      withRisk,
      overhead,
      cost,
      margin,
      rush,
      discount,
      priceBeforeTax,
      tax,
      price,
      unitPrice,
      estimatedProfit,
    },
    formulas: {
      material: `${fmtNum(qty, 0)} шт × ${fmtNum(usage)} ${unit} × ${fmtNum(pricePerUnit)} ₴/${unit} × (1 + ${fmtPct(wastePct)} відх.)`,
      machine: hourlyRate > 0
        ? `${fmtNum(qty, 0)} шт × ${fmtNum(runTimeH, 2)} год × ${fmtNum(hourlyRate)} ₴/год`
        : `${fmtNum(qty, 0)} шт × ${fmtNum(runTimeH, 2)} год`,
      setup: laborRate > 0
        ? `${fmtNum(setupTimeH, 2)} год × ${fmtNum(laborRate)} ₴/год${batchShare > 1 ? ` ÷ ${batchShare}` : ''}`
        : `${fmtNum(setupTimeH, 2)} год`,
      labor: laborRate > 0
        ? `(${fmtNum(prepH, 2)} + ${fmtNum(postProcessH, 2)}) год × ${fmtNum(laborRate)} ₴/год`
        : `${fmtNum(prepH + postProcessH, 2)} год`,
      risk: `база ${formatMoney(base)} ÷ (1 − ${fmtPct(rates.failureRate ?? 0)}) − база`,
      overhead: `${formatMoney(withRisk)} × ${fmtPct(rates.overheadPct ?? 0)}`,
      margin: `${formatMoney(cost)} × ${fmtPct(rates.marginPct ?? 0)}`,
      rush: `націнка +${fmtPct(rates.rushSurcharge ?? 0)} за терміновість`,
      discount: `знижка −${fmtPct(rates.volumeDiscount ?? 0)} за обсяг (${fmtNum(qty, 0)} шт)`,
      tax: `${formatMoney(priceBeforeTax)} × ${fmtPct(rates.taxPct ?? 0)}`,
    },
  };
}

function ItemReceipt({ item, showHeader }) {
  const b = item.breakdown;
  const f = item.formulas;
  const r = item.rates;

  const rows = [
    { key: 'material', label: 'Матеріал', formula: f.material, amount: b.material },
    { key: 'machine', label: 'Верстат', formula: f.machine, amount: b.machine },
    { key: 'setup', label: 'Переналаштування', formula: f.setup, amount: b.setup },
    { key: 'labor', label: 'Робота оператора', formula: f.labor, amount: b.labor },
    { key: 'risk', label: 'Ризик браку', formula: f.risk, amount: b.risk, sign: '+' },
    { key: 'overhead', label: 'Накладні витрати', formula: f.overhead, amount: b.overhead, sign: '+' },
    {
      key: 'cost',
      label: 'Повна собівартість',
      formula: 'база + ризик + накладні',
      amount: b.cost,
      tone: 'subtotal',
    },
    {
      key: 'margin',
      label: 'Маржа (прибуток)',
      formula: f.margin,
      amount: b.margin,
      sign: '+',
      tone: 'margin',
    },
  ];

  if ((r.rushSurcharge ?? 0) > 0 || b.rush > 0) {
    rows.push({
      key: 'rush',
      label: 'Терміновість (RUSH)',
      formula: f.rush,
      amount: b.rush,
      sign: '+',
    });
  }

  if ((r.volumeDiscount ?? 0) > 0 || b.discount > 0) {
    rows.push({
      key: 'discount',
      label: 'Знижка за обсяг',
      formula: f.discount,
      amount: b.discount,
      sign: '−',
    });
  }

  rows.push({
    key: 'tax',
    label: 'Податок',
    formula: f.tax,
    amount: b.tax,
    sign: '+',
  });

  const marginPct =
    b.priceBeforeTax > 0 ? ((b.estimatedProfit / b.priceBeforeTax) * 100).toFixed(1) : '0.0';

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {showHeader ? (
        <div className="flex items-center justify-between gap-2 border-b border-line bg-subtle/60 px-3.5 py-2 text-xs">
          <div className="font-medium text-ink">
            {item.title}{' '}
            {item.materialCode ? (
              <span className="font-mono text-[11px] text-ink-muted">({item.materialCode})</span>
            ) : null}
          </div>
          <div className="font-mono text-[11px] text-ink-secondary">
            {item.qty} шт × {formatMoney(b.unitPrice)}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="h-8 border-b border-line bg-subtle text-[10.5px] font-mono uppercase tracking-[0.06em] text-ink-muted">
              <th className="px-3 text-left font-normal">Складова</th>
              <th className="px-3 text-left font-normal">Формула з числами</th>
              <th className="px-3 text-right font-normal">Сума ₴</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const isSubtotal = row.tone === 'subtotal';
              const isMargin = row.tone === 'margin';
              return (
                <tr
                  key={row.key}
                  style={isMargin ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                  className={isSubtotal ? 'bg-subtle/70 font-medium' : ''}
                >
                  <td
                    className={`px-3 py-1.5 whitespace-nowrap ${
                      isMargin ? 'font-medium text-accent' : 'text-ink'
                    }`}
                  >
                    {row.label}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-muted">
                    {row.formula}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                      isMargin ? 'font-semibold text-accent' : isSubtotal ? 'font-semibold text-ink' : 'text-ink'
                    }`}
                  >
                    {row.sign === '−' ? '−' : row.sign === '+' && row.amount > 0 ? '+' : ''}
                    <Money value={row.amount} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-subtle/40">
              <td className="px-3 py-2.5 text-sm font-semibold text-ink">Підсумок позиції</td>
              <td className="px-3 py-2.5 font-mono text-[11px] text-ink-secondary">
                Прибуток: <Money value={b.estimatedProfit} className="font-medium text-accent" /> ({marginPct}%)
                {' · '}за 1 шт: <Money value={b.unitPrice} />
              </td>
              <td className="px-3 py-2.5 text-right text-sm font-bold text-ink whitespace-nowrap">
                <Money value={b.price} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function PricingBreakdownTable({ items = [], totals = null, isLoading = false }) {
  const normalized = items.map(normalizeItem);

  if (isLoading && normalized.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 font-mono text-xs text-ink-muted">
        Розрахунок деталізації чека...
      </div>
    );
  }

  if (normalized.length === 0) {
    return null;
  }

  const sumRaw = (key) => {
    let acc = 0;
    for (const it of items) {
      const r = it?.pricingBreakdown?.raw ?? it?.breakdown ?? it?.pricingBreakdown ?? {};
      acc += Number(r[key] ?? 0);
    }
    return Math.round((acc + Number.EPSILON) * 100) / 100;
  };

  const orderTotals =
    totals ??
    (normalized.length === 1
      ? normalized[0].breakdown
      : {
          material: sumRaw('material'),
          machine: sumRaw('machine'),
          setup: sumRaw('setup'),
          labor: sumRaw('labor'),
          cost: sumRaw('cost'),
          rush: sumRaw('rush'),
          discount: sumRaw('discount'),
          tax: sumRaw('tax') || sumRaw('taxAmount'),
          price: sumRaw('price'),
          estimatedProfit: sumRaw('estimatedProfit'),
        });
  const totalPriceBeforeTax =
    orderTotals?.priceBeforeTax ??
    Math.max(0, (orderTotals?.price ?? 0) - (orderTotals?.tax ?? orderTotals?.taxAmount ?? 0));
  const totalMarginPct =
    orderTotals && totalPriceBeforeTax > 0
      ? ((orderTotals.estimatedProfit / totalPriceBeforeTax) * 100).toFixed(1)
      : '0.0';

  return (
    <div className={`space-y-3 transition-opacity ${isLoading ? 'opacity-65' : 'opacity-100'}`}>
      {normalized.map((item, idx) => (
        <ItemReceipt key={idx} item={item} showHeader={normalized.length > 1} />
      ))}

      {orderTotals && normalized.length > 1 ? (
        <div className="rounded-2xl border border-line-strong bg-subtle/50 p-3.5 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-ink-secondary">
              Разом по замовленню ({normalized.length} поз.)
            </span>
            <span className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent" style={{ backgroundColor: 'var(--accent-soft)' }}>
              Маржа: <Money value={orderTotals.estimatedProfit} /> ({totalMarginPct}%)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 font-mono">
            <div>
              <span className="text-ink-muted">Матеріали: </span>
              <Money value={orderTotals.material} />
            </div>
            <div>
              <span className="text-ink-muted">Верстати: </span>
              <Money value={orderTotals.machine} />
            </div>
            <div>
              <span className="text-ink-muted">Робота+setup: </span>
              <Money value={(orderTotals.labor ?? 0) + (orderTotals.setup ?? 0)} />
            </div>
            <div>
              <span className="text-ink-muted">Собівартість: </span>
              <Money value={orderTotals.cost} className="font-semibold text-ink" />
            </div>
            {(orderTotals.rush ?? 0) > 0 ? (
              <div>
                <span className="text-ink-muted">Терміновість: </span>
                <Money value={orderTotals.rush} />
              </div>
            ) : null}
            {(orderTotals.discount ?? 0) > 0 ? (
              <div>
                <span className="text-ink-muted">Знижка: </span>
                −<Money value={orderTotals.discount} />
              </div>
            ) : null}
            <div>
              <span className="text-ink-muted">Податок: </span>
              <Money value={orderTotals.tax ?? orderTotals.taxAmount} />
            </div>
            <div className="text-right sm:text-left">
              <span className="font-sans font-semibold text-ink">До сплати: </span>
              <Money value={orderTotals.price} className="text-sm font-bold text-ink" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
