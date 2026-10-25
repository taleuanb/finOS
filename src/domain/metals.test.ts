import { describe, expect, it } from 'vitest';
import {
  OZ_G, averageCostPerKg, goldSilverRatio, neutralZone, premium, ratioAlert, usdPerOzToEurPerKg, zoneFor,
} from './metals';
import { DEFAULT_METAL_GRID } from './types';
import type { FxRates, Snapshot } from './types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.85 };

function snap(date: string, ratio: number | null): Snapshot {
  return {
    date, totalAssetsEur: 0, totalDebtsEur: 0, netEur: 0,
    byClass: {} as Snapshot['byClass'], goldSilverRatio: ratio, eurMad: 10.85, eurUsd: 1.08, partial: false,
  };
}

/** n dates consécutives à partir du 1er octobre 2026 (traverse les fins de mois si besoin). */
function run(n: number, ratio: number | null, start = Date.UTC(2026, 9, 1)): Snapshot[] {
  return Array.from({ length: n }, (_, i) => snap(new Date(start + i * 86400000).toISOString().slice(0, 10), ratio));
}

describe('re-exports', () => {
  it('expose les unités et zones de la fondation', () => {
    expect(OZ_G).toBe(31.1034768);
    expect(usdPerOzToEurPerKg(31.1034768, { ...fx, USD: 1 })).toBeCloseTo(1000, 6);
    expect(zoneFor(64.5, DEFAULT_METAL_GRID).label).toBe('Neutre');
    expect(neutralZone(DEFAULT_METAL_GRID).label).toBe('Neutre');
  });
});

describe('premium', () => {
  it('prime payée par rapport au spot', () => {
    expect(premium(547, 6.4516, 82100)).toBeCloseTo(0.0327, 4);
    expect(premium(1300, 12, 105178)).toBeCloseTo(0.03, 3);
  });
});

describe('goldSilverRatio', () => {
  it('ratio or / argent', () => {
    expect(goldSilverRatio(125926, 1952)).toBeCloseTo(64.51, 2);
  });
});

describe('averageCostPerKg', () => {
  it('coût moyen pondéré des achats', () => {
    expect(averageCostPerKg([
      { quantity: 6.4516, amount: 547, kind: 'buy' },
      { quantity: 6.4516, amount: 555, kind: 'buy' },
    ])).toBeCloseTo(85405, 0);
  });
  it('ignore les ventes (le coût moyen reste inchangé)', () => {
    expect(averageCostPerKg([
      { quantity: 10, amount: 1000, kind: 'buy' },
      { quantity: 5, amount: 900, kind: 'sell' },
    ])).toBeCloseTo(100000, 6);
  });
  it('ignore les achats sans poids fin (quantité ≤ 0, ex. collier non pesé)', () => {
    expect(averageCostPerKg([
      { quantity: 6.4516, amount: 547, kind: 'buy' },
      { quantity: 6.4516, amount: 555, kind: 'buy' },
      { quantity: 0, amount: 1300, kind: 'buy' },
      { quantity: -1, amount: 10, kind: 'buy' },
    ])).toBeCloseTo(85405, 0);
  });
  it('renvoie 0 sans achat', () => {
    expect(averageCostPerKg([])).toBe(0);
    expect(averageCostPerKg([{ quantity: 5, amount: 900, kind: 'sell' }])).toBe(0);
  });
});

describe('ratioAlert', () => {
  it('14 instantanés consécutifs hors zone neutre → true', () => {
    expect(ratioAlert(run(14, 70), DEFAULT_METAL_GRID)).toBe(true);
    expect(ratioAlert(run(14, 40), DEFAULT_METAL_GRID)).toBe(true);
  });
  it('13 instantanés → false', () => {
    expect(ratioAlert(run(13, 70), DEFAULT_METAL_GRID)).toBe(false);
  });
  it('un ratio null dans la fenêtre → false', () => {
    const s = run(14, 70);
    s[5] = { ...s[5], goldSilverRatio: null };
    expect(ratioAlert(s, DEFAULT_METAL_GRID)).toBe(false);
  });
  it('un jour en zone neutre dans la fenêtre → false', () => {
    const s = run(14, 70);
    s[13] = { ...s[13], goldSilverRatio: 60 };
    expect(ratioAlert(s, DEFAULT_METAL_GRID)).toBe(false);
  });
  it('un trou de dates → false', () => {
    const s = run(15, 70);
    s.splice(10, 1);
    expect(ratioAlert(s, DEFAULT_METAL_GRID)).toBe(false);
  });
  it('trie par date et ne regarde que les 14 derniers', () => {
    const s = [...run(5, 60), ...run(14, 70, Date.UTC(2026, 9, 6))].reverse();
    expect(ratioAlert(s, DEFAULT_METAL_GRID)).toBe(true);
  });
  it('days personnalisable', () => {
    expect(ratioAlert(run(3, 70), DEFAULT_METAL_GRID, 3)).toBe(true);
    expect(ratioAlert(run(2, 70), DEFAULT_METAL_GRID, 3)).toBe(false);
  });
});
