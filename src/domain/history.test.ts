import { describe, expect, it } from 'vitest';
import { buildSnapshot, variation } from './history';
import { ASSET_CLASSES } from './types';
import type { Asset, Debt, FxRates, Snapshot } from './types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.85 };

function asset(p: Partial<Asset>): Asset {
  return {
    id: 'a', name: 'A', assetClass: 'Autres', currency: 'EUR', mode: 'manual',
    quantity: 1, costBasis: 0, archived: false, ...p,
  };
}
function debt(p: Partial<Debt>): Debt {
  return { id: 'd', name: 'D', currency: 'EUR', outstanding: 0, ...p };
}
function snap(date: string, netEur: number): Snapshot {
  return {
    date, totalAssetsEur: netEur, totalDebtsEur: 0, netEur,
    byClass: Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Snapshot['byClass'],
    goldSilverRatio: null, eurMad: 10, eurUsd: 1, partial: false,
  };
}

describe('buildSnapshot', () => {
  it('contient les 10 classes, à 0 si vides', () => {
    const s = buildSnapshot('2026-10-25', [], [], fx, null, false);
    expect(Object.keys(s.byClass).sort()).toEqual([...ASSET_CLASSES].sort());
    expect(Object.values(s.byClass).every((v) => v === 0)).toBe(true);
    expect(s.netEur).toBe(0);
  });

  it('calcule actifs, dettes, net et classes', () => {
    const assets = [
      asset({ id: '1', assetClass: 'Crypto', valueEur: 1000 }),
      asset({ id: '2', assetClass: 'Crypto', valueEur: 500 }),
      asset({ id: '3', assetClass: 'Immobilier', valueEur: 10000 }),
      asset({ id: '4', assetClass: 'PER' }), // valueEur absent → 0
    ];
    const debts = [debt({ id: 'x', valueEur: 4000 })];
    const s = buildSnapshot('2026-10-25', assets, debts, fx, 62.5, true);
    expect(s.totalAssetsEur).toBe(11500);
    expect(s.totalDebtsEur).toBe(4000);
    expect(s.netEur).toBe(7500);
    expect(s.byClass.Crypto).toBe(1500);
    expect(s.byClass.Immobilier).toBe(10000);
    expect(s.byClass.PER).toBe(0);
    expect(s.goldSilverRatio).toBe(62.5);
    expect(s.partial).toBe(true);
    expect(s.eurMad).toBe(10.85);
    expect(s.eurUsd).toBe(1.08);
    expect(s.date).toBe('2026-10-25');
  });

  it('exclut les actifs archivés', () => {
    const s = buildSnapshot('2026-10-25', [
      asset({ valueEur: 100 }), asset({ id: 'b', valueEur: 900, archived: true }),
    ], [], fx, null, false);
    expect(s.totalAssetsEur).toBe(100);
  });

  it('convertit une dette sans valueEur depuis sa devise', () => {
    const s = buildSnapshot('2026-10-25', [], [debt({ currency: 'MAD', outstanding: 1085 })], fx, null, false);
    expect(s.totalDebtsEur).toBeCloseTo(100, 10);
    expect(s.netEur).toBeCloseTo(-100, 10);
  });
});

describe('variation', () => {
  it('renvoie null avec moins de 2 instantanés', () => {
    expect(variation([], '1M', '2026-10-25')).toBeNull();
    expect(variation([snap('2026-10-25', 100)], 'Tout', '2026-10-25')).toBeNull();
  });

  it("1M compare au dernier instantané ≤ aujourd'hui − 1 mois", () => {
    const snaps = [snap('2026-09-01', 50), snap('2026-09-25', 100), snap('2026-09-26', 120), snap('2026-10-25', 150)];
    expect(variation(snaps, '1M', '2026-10-25')).toEqual({ abs: 50, pct: 0.5 });
  });

  it("1M retombe sur le premier instantané si aucun n'est assez ancien", () => {
    const snaps = [snap('2026-10-10', 100), snap('2026-10-25', 110)];
    const v = variation(snaps, '1M', '2026-10-25')!;
    expect(v.abs).toBeCloseTo(10, 10);
    expect(v.pct).toBeCloseTo(0.1, 10);
  });

  it('1M clampe en fin de mois (31 mars → 28 février)', () => {
    const snaps = [snap('2026-02-28', 100), snap('2026-03-01', 200), snap('2026-03-31', 300)];
    expect(variation(snaps, '1M', '2026-03-31')).toEqual({ abs: 200, pct: 2 });
  });

  it("YTD compare au dernier ≤ 31/12 de l'année précédente", () => {
    const snaps = [snap('2025-11-01', 80), snap('2025-12-31', 100), snap('2026-01-02', 90), snap('2026-10-25', 150)];
    expect(variation(snaps, 'YTD', '2026-10-25')).toEqual({ abs: 50, pct: 0.5 });
  });

  it('YTD retombe sur le premier si rien avant le 1er janvier', () => {
    const snaps = [snap('2026-03-01', 100), snap('2026-10-25', 130)];
    const v = variation(snaps, 'YTD', '2026-10-25')!;
    expect(v.abs).toBeCloseTo(30, 10);
    expect(v.pct).toBeCloseTo(0.3, 10);
  });

  it("1A compare au dernier ≤ aujourd'hui − 1 an", () => {
    const snaps = [snap('2025-01-01', 10), snap('2025-10-25', 100), snap('2025-12-01', 120), snap('2026-10-25', 200)];
    expect(variation(snaps, '1A', '2026-10-25')).toEqual({ abs: 100, pct: 1 });
  });

  it('1A clampe le 29 février (2028-02-29 → 2027-02-28)', () => {
    const snaps = [snap('2027-02-28', 100), snap('2027-03-05', 150), snap('2028-02-29', 200)];
    expect(variation(snaps, '1A', '2028-02-29')).toEqual({ abs: 100, pct: 1 });
  });

  it("Tout compare au premier instantané, quel que soit l'ordre d'entrée", () => {
    const snaps = [snap('2026-10-25', 300), snap('2024-01-01', 100), snap('2025-06-01', 200)];
    expect(variation(snaps, 'Tout', '2026-10-25')).toEqual({ abs: 200, pct: 2 });
  });

  it('pct vaut 0 si la référence est nulle', () => {
    const snaps = [snap('2026-01-01', 0), snap('2026-10-25', 50)];
    expect(variation(snaps, 'Tout', '2026-10-25')).toEqual({ abs: 50, pct: 0 });
  });

  it('gère une baisse', () => {
    const snaps = [snap('2026-01-01', 200), snap('2026-10-25', 150)];
    expect(variation(snaps, 'Tout', '2026-10-25')).toEqual({ abs: -50, pct: -0.25 });
  });
});
