import { describe, expect, it } from 'vitest';
import { allocate } from './allocation';
import { AllocationError, DEFAULT_METAL_GRID } from './types';
import type { AllocationLine, Asset, AssetClass, FxRates, Strategy } from './types';

function asset(id: string, assetClass: AssetClass, valueEur: number, extra: Partial<Asset> = {}): Asset {
  return {
    id, name: id, assetClass, currency: 'EUR', mode: 'manual', quantity: 1, costBasis: 0,
    value: valueEur, valueEur, archived: false, ...extra,
  };
}

function strategy(over: Partial<Strategy>): Strategy {
  return {
    targets: {}, mainAssetByClass: {}, monthlyInvest: 0,
    metalGrid: DEFAULT_METAL_GRID, displayCurrency: 'EUR', ...over,
  };
}

const FX: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84 };

const byAsset = (lines: AllocationLine[]) => Object.fromEntries(lines.map((l) => [l.assetId, l.amount]));
const sum = (lines: AllocationLine[]) => lines.reduce((s, l) => s + l.amount, 0);

const A = {
  fx: FX, amount: 200,
  ratio: 57,
  assets: [
    asset('etf', 'Fonds & ETF', 400),
    asset('per', 'PER', 300, { fixedMonthly: 50 }),
    asset('or', 'Métaux précieux', 0),
    asset('ag', 'Métaux précieux', 0),
  ],
  strategy: strategy({
    targets: { 'Fonds & ETF': 0.5, PER: 0.3, 'Métaux précieux': 0.2 },
    mainAssetByClass: { 'Fonds & ETF': 'etf', PER: 'per' },
    goldAssetId: 'or', silverAssetId: 'ag',
  }),
};

const B = {
  fx: FX, amount: 600,
  ratio: 40,
  assets: [asset('etf', 'Fonds & ETF', 400), asset('or', 'Métaux précieux', 0), asset('ag', 'Métaux précieux', 0)],
  strategy: strategy({
    targets: { 'Fonds & ETF': 0.4, 'Métaux précieux': 0.4 },
    mainAssetByClass: { 'Fonds & ETF': 'etf' },
    goldAssetId: 'or', silverAssetId: 'ag',
  }),
};

describe('allocate', () => {
  it('cas A : écarts > R, répartition au prorata des écarts', () => {
    const lines = allocate(A);
    expect(byAsset(lines)).toEqual({ per: 50, etf: 33, or: 64, ag: 53 });
    expect(sum(lines)).toBe(200);
  });

  it('cas A : justifications et origines', () => {
    const lines = allocate(A);
    const line = (id: string) => lines.find((l) => l.assetId === id)!;
    expect(line('per')).toEqual({ assetId: 'per', amount: 50, origin: 'fixe', reason: 'Versement fixe programmé' });
    expect(line('etf').origin).toBe('cible');
    expect(line('etf').reason).toBe('Sous la cible de 50 €');
    expect(line('or').origin).toBe('signal');
    expect(line('or').reason).toBe('55 % de la part métaux (zone Neutre)');
    expect(line('ag').reason).toBe('45 % de la part métaux (zone Neutre)');
  });

  it('cas B : écarts < R, surplus réparti selon les cibles, zone Or bon marché', () => {
    const lines = allocate(B);
    expect(byAsset(lines)).toEqual({ etf: 100, or: 400, ag: 100 });
    expect(sum(lines)).toBe(600);
    expect(lines.find((l) => l.assetId === 'or')!.reason).toBe('80 % de la part métaux (zone Or bon marché)');
  });

  it('cas C : versement fixe seul', () => {
    const lines = allocate({
      fx: FX, amount: 100, ratio: null,
      assets: [asset('per', 'PER', 1000, { fixedMonthly: 100 })],
      strategy: strategy({}),
    });
    expect(lines).toEqual([{ assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' }]);
  });

  it('cas D : annuel, le versement fixe est multiplié par 12', () => {
    const lines = allocate({
      fx: FX, amount: 2400, months: 12, ratio: null,
      assets: [asset('per', 'PER', 300, { fixedMonthly: 100 }), asset('etf', 'Fonds & ETF', 400)],
      strategy: strategy({ targets: { 'Fonds & ETF': 1 }, mainAssetByClass: { 'Fonds & ETF': 'etf' } }),
    });
    expect(byAsset(lines)).toEqual({ per: 1200, etf: 1200 });
    expect(sum(lines)).toBe(2400);
  });

  it('le versement fixe est plafonné à M', () => {
    const lines = allocate({
      fx: FX, amount: 80, ratio: null,
      assets: [asset('per', 'PER', 0, { fixedMonthly: 100 })],
      strategy: strategy({}),
    });
    expect(byAsset(lines)).toEqual({ per: 80 });
  });

  it('ratio null : zone neutre', () => {
    const lines = allocate({ ...A, ratio: null });
    expect(lines.find((l) => l.assetId === 'or')!.reason).toContain('zone Neutre');
  });

  it('ignore les actifs archivés dans les valeurs et les versements fixes', () => {
    const lines = allocate({
      ...B,
      assets: [...B.assets, asset('old', 'Fonds & ETF', 100000, { archived: true, fixedMonthly: 500 })],
    });
    expect(byAsset(lines)).toEqual({ etf: 100, or: 400, ag: 100 });
  });

  it('classe ciblée sans actif principal : AllocationError lisible', () => {
    const noMain = {
      fx: FX, amount: 100, ratio: null,
      assets: [asset('etf', 'Fonds & ETF', 100), asset('btc', 'Crypto', 0)],
      strategy: strategy({
        targets: { 'Fonds & ETF': 0.5, Crypto: 0.5 },
        mainAssetByClass: { 'Fonds & ETF': 'etf' },
      }),
    };
    expect(() => allocate(noMain)).toThrow(new AllocationError('Aucun actif principal pour la classe Crypto'));
    expect(() => allocate(noMain)).toThrow(AllocationError);
  });

  it('actif principal archivé : AllocationError', () => {
    const archived = {
      fx: FX, amount: 100, ratio: null,
      assets: [asset('btc', 'Crypto', 0, { archived: true })],
      strategy: strategy({ targets: { Crypto: 1 }, mainAssetByClass: { Crypto: 'btc' } }),
    };
    expect(() => allocate(archived)).toThrow(new AllocationError('Aucun actif principal pour la classe Crypto'));
  });

  it('métaux sans actif or/argent : AllocationError', () => {
    expect(() => allocate({ ...B, strategy: { ...B.strategy, goldAssetId: undefined } })).toThrow(
      new AllocationError('Aucun actif principal pour la classe Métaux précieux'),
    );
  });

  it('fusionne la ligne fixe et la ligne cible d’un même actif', () => {
    const lines = allocate({
      fx: FX, amount: 200, ratio: null,
      assets: [asset('per', 'PER', 0, { fixedMonthly: 50 })],
      strategy: strategy({ targets: { PER: 1 }, mainAssetByClass: { PER: 'per' } }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(200);
    expect(lines[0].origin).toBe('fixe');
  });
});

describe('allocate — arrondi au centime (Σ === M)', () => {
  const totalCents = (lines: AllocationLine[]) => Math.round(sum(lines) * 100);
  const isCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

  it('M avec des centimes (769,75) : la somme des lignes vaut exactement M', () => {
    const lines = allocate({ ...A, amount: 769.75 });
    expect(totalCents(lines)).toBe(76975);
    for (const l of lines) expect(isCents(l.amount)).toBe(true);
  });

  it('versement fixe avec des centimes (100,5) et M = 900 : Σ = 900', () => {
    const lines = allocate({
      ...A, amount: 900,
      assets: A.assets.map((a) => (a.id === 'per' ? { ...a, fixedMonthly: 100.5 } : a)),
    });
    expect(totalCents(lines)).toBe(90000);
    expect(byAsset(lines).per).toBeGreaterThanOrEqual(100.5); // fixe 100,5 + part de la cible PER
    for (const l of lines) expect(isCents(l.amount)).toBe(true);
  });

  it('M non arrondi (issu d’une conversion MAD) : Σ = M au centime près', () => {
    const lines = allocate({ ...B, amount: 600.123456 });
    expect(totalCents(lines)).toBe(60012);
  });

  it('aucune cible définie et un reste à répartir : AllocationError lisible', () => {
    const noTarget = {
      fx: FX, amount: 300, ratio: null,
      assets: [asset('per', 'PER', 0, { fixedMonthly: 100 }), asset('etf', 'Fonds & ETF', 0)],
      strategy: strategy({ mainAssetByClass: { 'Fonds & ETF': 'etf' } }),
    };
    expect(() => allocate(noTarget)).toThrow(new AllocationError('Aucune cible définie dans la Stratégie'));
  });

  it('cibles toutes à 0 : AllocationError', () => {
    expect(() => allocate({
      fx: FX, amount: 300, ratio: null, assets: [asset('etf', 'Fonds & ETF', 0)],
      strategy: strategy({ targets: { 'Fonds & ETF': 0 }, mainAssetByClass: { 'Fonds & ETF': 'etf' } }),
    })).toThrow(new AllocationError('Aucune cible définie dans la Stratégie'));
  });
});

describe('allocate — versement fixe dans la devise de l’actif', () => {
  it('un versement fixe de 1 000 MAD consomme ≈ 92,17 € (et non 1 000 €)', () => {
    const lines = allocate({
      fx: FX, amount: 500, ratio: null,
      assets: [asset('mad', 'PER', 0, { currency: 'MAD', fixedMonthly: 1000 }), asset('etf', 'Fonds & ETF', 0)],
      strategy: strategy({ targets: { 'Fonds & ETF': 1 }, mainAssetByClass: { 'Fonds & ETF': 'etf' } }),
    });
    expect(byAsset(lines)).toEqual({ mad: 92.17, etf: 407.83 });
    expect(Math.round(sum(lines) * 100)).toBe(50000);
  });

  it('annuel : 12 × 100 USD convertis en euros', () => {
    const lines = allocate({
      fx: FX, amount: 5000, months: 12, ratio: null,
      assets: [asset('usd', 'PER', 0, { currency: 'USD', fixedMonthly: 100 })],
      strategy: strategy({ targets: { PER: 1 }, mainAssetByClass: { PER: 'usd' } }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(5000);
    const fixedOnly = allocate({
      fx: FX, amount: 1111.11, months: 12, ratio: null,
      assets: [asset('usd', 'PER', 0, { currency: 'USD', fixedMonthly: 100 })],
      strategy: strategy({}),
    });
    expect(byAsset(fixedOnly)).toEqual({ usd: 1111.11 });
  });
});

describe('allocate — seules les classes pilotables comptent', () => {
  it('une cible Épargne ou Immobilier stockée est ignorée (aucune erreur, aucune part)', () => {
    const lines = allocate({
      fx: FX, amount: 300, ratio: null,
      assets: [asset('etf', 'Fonds & ETF', 0), asset('ep', 'Épargne', 0), asset('immo', 'Immobilier', 0)],
      strategy: strategy({
        targets: { 'Fonds & ETF': 0.5, Épargne: 0.3, Immobilier: 0.2 },
        mainAssetByClass: { 'Fonds & ETF': 'etf' },
      }),
    });
    expect(byAsset(lines)).toEqual({ etf: 300 });
  });

  it('seules des cibles non pilotables : « Aucune cible définie »', () => {
    expect(() => allocate({
      fx: FX, amount: 300, ratio: null, assets: [asset('ep', 'Épargne', 0)],
      strategy: strategy({ targets: { Épargne: 1 }, mainAssetByClass: { Épargne: 'ep' } }),
    })).toThrow(new AllocationError('Aucune cible définie dans la Stratégie'));
  });
});
