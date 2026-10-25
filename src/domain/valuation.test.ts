import { describe, expect, it } from 'vitest';
import { gain, valueAsset } from './valuation';
import type { Asset, FxRates } from './types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.86 };

const etf: Asset = {
  id: 'etf', name: 'ETF Monde', assetClass: 'Fonds & ETF', currency: 'EUR', mode: 'auto',
  quoteId: 'AAPL', quantity: 1, costBasis: 0, archived: false,
};
const darSakan: Asset = {
  id: 'dar', name: 'Dar Sakan', assetClass: 'Immobilier', currency: 'MAD', mode: 'manual',
  quantity: 1, costBasis: 0, archived: false,
};
const gold: Asset = {
  id: 'gold', name: 'Or', assetClass: 'Métaux précieux', currency: 'EUR', mode: 'auto',
  quoteId: 'XAU', quantity: 24.9, costBasis: 2402, archived: false,
};

describe('valueAsset', () => {
  it('convertit une cotation USD vers un actif EUR (auto)', () => {
    const r = valueAsset({ ...etf, quantity: 10 }, { id: 'AAPL', price: 216, currency: 'USD' }, fx);
    expect(r.valueEur).toBeCloseTo(2000, 0);
    expect(r.unitPrice).toBeCloseTo(200, 6);
    expect(r.value).toBeCloseTo(2000, 0);
  });

  it('convertit une cotation GBP (déjà divisée par 100 en amont) vers EUR', () => {
    const r = valueAsset({ ...etf, quantity: 2 }, { id: 'CSPX.L', price: 500, currency: 'GBP' }, { ...fx, GBP: 0.84 });
    expect(r.valueEur).toBeCloseTo(1190.48, 1);
  });

  it('mode manuel : renvoie manualValue dans la devise de l’actif', () => {
    const r = valueAsset({ ...darSakan, manualValue: 1_200_000 }, undefined, fx);
    expect(r).toMatchObject({ value: 1_200_000 });
    expect(r.valueEur).toBeCloseTo(110599.08, 1);
    expect(r.unitPrice).toBeUndefined();
  });

  it('mode manuel : ignore une cotation éventuelle', () => {
    const r = valueAsset({ ...darSakan, manualValue: 500 }, { id: 'X', price: 9999, currency: 'USD' }, fx);
    expect(r.value).toBe(500);
  });

  it('mode manuel sans valeur : 0', () => {
    expect(valueAsset(darSakan, undefined, fx)).toMatchObject({ value: 0, valueEur: 0 });
  });

  it('métaux : 24,9 g d’or à 4 229,88 $/oz, USD 1,08 ≈ 3 136 €', () => {
    const r = valueAsset(gold, { id: 'XAU', price: 4229.88, currency: 'USD' }, fx);
    expect(r.unitPrice).toBeCloseTo(125_920, -1);
    expect(r.valueEur).toBeCloseTo(3136, -1);
    expect(r.value).toBeCloseTo(r.valueEur, 6);
  });

  it('auto sans cotation : retombe sur la dernière valeur connue', () => {
    const r = valueAsset({ ...etf, value: 1500 }, undefined, fx);
    expect(r).toMatchObject({ value: 1500, valueEur: 1500 });
    expect(r.unitPrice).toBeUndefined();
  });

  it('auto sans cotation mais avec un dernier cours : quantité × cours (devise de l’actif)', () => {
    const r = valueAsset({ ...etf, currency: 'USD', quantity: 14, unitPrice: 50, value: 500 }, undefined, fx);
    expect(r).toEqual({ unitPrice: 50, value: 700, valueEur: 700 / 1.08 });
  });

  it('métal sans cotation mais avec un dernier cours €/kg : grammes × cours ÷ 1000', () => {
    const r = valueAsset({ ...gold, currency: 'MAD', quantity: 10, unitPrice: 120_000, value: 0 }, undefined, fx);
    expect(r.valueEur).toBeCloseTo(1_200, 9);
    expect(r.value).toBeCloseTo(1_200 * 10.85, 6);
  });

  it('auto sans cotation ni valeur connue : 0', () => {
    expect(valueAsset(etf, undefined, fx)).toMatchObject({ value: 0, valueEur: 0 });
  });

  it('auto sans cotation, actif en MAD : valeur EUR convertie', () => {
    const r = valueAsset({ ...darSakan, mode: 'auto', value: 1085 }, undefined, fx);
    expect(r.valueEur).toBeCloseTo(100, 6);
  });
});

describe('gain', () => {
  it('calcule le gain absolu et la fraction', () => {
    expect(gain(3136, 2402)).toEqual({ abs: 734, pct: expect.closeTo(0.3056, 3) });
  });
  it('perte : valeurs négatives', () => {
    const g = gain(681, 1000);
    expect(g.abs).toBe(-319);
    expect(g.pct).toBeCloseTo(-0.319, 6);
  });
  it('pct nul si le coût de revient est 0', () => {
    expect(gain(5, 0).pct).toBeNull();
    expect(gain(5, 0).abs).toBe(5);
  });
});
