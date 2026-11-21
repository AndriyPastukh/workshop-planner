import { formatMoney } from '../lib/format.js';

export function Money({ value, className = '' }) {
  return (
    <span className={`font-mono tabular-nums whitespace-nowrap ${className}`}>
      {formatMoney(value)}
    </span>
  );
}
