import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration, formatMoney } from '../lib/format.js';

describe('client formatting helpers', () => {
  it('formats monetary amounts with NBSP thousands separator, comma decimal, and UAH sign', () => {
    expect(formatMoney(1250)).toBe('1\u00A0250,00 ₴');
    expect(formatMoney(45.5)).toBe('45,50 ₴');
    expect(formatMoney(0)).toBe('0,00 ₴');
    expect(formatMoney(-1200.4)).toBe('-1\u00A0200,40 ₴');
  });

  it('formats timestamps deterministically as DD.MM HH:mm', () => {
    expect(formatDateTime('2026-11-21T14:30:00.000Z', { utc: true })).toBe('21.11 14:30');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('invalid')).toBe('—');
  });

  it('formats durations in minutes and hours cleanly in Ukrainian', () => {
    expect(formatDuration(45)).toBe('45 хв');
    expect(formatDuration(120)).toBe('2 год');
    expect(formatDuration(135)).toBe('2 год 15 хв');
  });
});
