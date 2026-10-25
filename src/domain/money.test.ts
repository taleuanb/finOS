import { describe, expect, it } from 'vitest';
import { convert, formatMoney, formatPct, fromEur, toEur } from './money';
import type { FxRates } from './types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84 };

describe('conversion', () => {
  it('toEur convertit MAD, USD, GBP et EUR vers l’euro', () => {
    expect(toEur(1_200_000, 'MAD', fx)).toBeCloseTo(110599.08, 1);
    expect(toEur(108, 'USD', fx)).toBeCloseTo(100, 6);
    expect(toEur(84, 'GBP', fx)).toBeCloseTo(100, 6);
    expect(toEur(42, 'EUR', fx)).toBe(42);
  });
  it('fromEur est l’inverse de toEur', () => {
    expect(fromEur(100, 'MAD', fx)).toBeCloseTo(1085, 6);
    expect(fromEur(toEur(1234, 'MAD', fx), 'MAD', fx)).toBeCloseTo(1234, 6);
  });
  it('convert passe par l’euro', () => {
    expect(convert(1085, 'MAD', 'USD', fx)).toBeCloseTo(108, 6);
    expect(convert(50, 'EUR', 'EUR', fx)).toBe(50);
  });
});

describe('formatMoney', () => {
  it('formate en fr-FR avec espaces ordinaires', () => {
    expect(formatMoney(110599.08, 'EUR')).toBe('110 599 €');
    expect(formatMoney(160000, 'MAD')).toBe('160 000 MAD');
    expect(formatMoney(1234, 'USD')).toBe('1 234 $');
  });
  it('utilise le moins typographique et les décimales demandées', () => {
    expect(formatMoney(-1500, 'EUR')).toBe('−1 500 €');
    expect(formatMoney(1234.5, 'EUR', { decimals: 2 })).toBe('1 234,50 €');
  });
});

describe('formatPct', () => {
  it('formate une fraction avec 2 décimales', () => {
    expect(formatPct(0.0327)).toBe('3,27 %');
    expect(formatPct(-0.319, { signed: true })).toBe('−31,90 %');
    expect(formatPct(0.125, { signed: true })).toBe('+12,50 %');
  });
});
