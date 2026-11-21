import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../lib/format.js';

function useCountUp(target, duration = 220) {
  const isNumeric = typeof target === 'number' && Number.isFinite(target);
  const [display, setDisplay] = useState(() => (isNumeric ? target : 0));
  const prevRef = useRef(isNumeric ? 0 : 0);

  useEffect(() => {
    if (!isNumeric) {
      return undefined;
    }

    const prefersReduced =
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      typeof window.requestAnimationFrame !== 'function';

    if (prefersReduced) {
      prevRef.current = target;
      setDisplay(target);
      return undefined;
    }

    const startVal = prevRef.current;
    if (startVal === target) {
      setDisplay(target);
      return undefined;
    }

    const startTime = performance.now();
    let rafId = null;

    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (target - startVal) * eased;
      setDisplay(Number.isInteger(target) ? Math.round(current) : current);

      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
        setDisplay(target);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isNumeric, target, duration]);

  return isNumeric ? display : target;
}

export function StatCard({ label, value, moneyValue, hint, accent = false, className = '' }) {
  const animatedCount = useCountUp(typeof value === 'number' ? value : null);
  const animatedMoney = useCountUp(typeof moneyValue === 'number' ? moneyValue : null);

  let renderedValue = value;
  if (typeof moneyValue === 'number') {
    renderedValue = (
      <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(animatedMoney)}</span>
    );
  } else if (typeof value === 'number') {
    renderedValue = animatedCount;
  }

  return (
    <div
      className={`rounded-2xl border bg-surface px-4 py-3.5 transition-[border-color,transform] duration-150 hover:border-line-strong ${
        accent ? 'border-accent/50' : 'border-line'
      } ${className}`}
    >
      <div className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-muted">{label}</div>
      <div
        className={`mt-1.5 font-mono text-[28px] font-semibold leading-tight tracking-tight tabular-nums ${
          accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {renderedValue}
      </div>
      {hint ? <div className="mt-0.5 text-sm text-ink-muted">{hint}</div> : null}
    </div>
  );
}
