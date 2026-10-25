import { describe, expect, it } from 'vitest';
import { allocate } from './allocation';
import { AllocationError, DEFAULT_METAL_GRID } from './types';
import type { AllocationLine, Asset, AssetClass, Strategy } from './types';

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

const byAsset = (lines: AllocationLine[]) => Object.fromEntries(lines.map((l) => [l.assetId, l.amount]));
const sum = (lines: AllocationLine[]) => lines.reduce((s, l) => s + l.amount, 0);

const A = {
  amount: 200,
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
  amount: 600,
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
      amount: 100, ratio: null,
      assets: [asset('per', 'PER', 1000, { fixedMonthly: 100 })],
      strategy: strategy({}),
    });
    expect(lines).toEqual([{ assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' }]);
  });

  it('cas D : annuel, le versement fixe est multiplié par 12', () => {
    const lines = allocate({
      amount: 2400, months: 12, ratio: null,
      assets: [asset('per', 'PER', 300, { fixedMonthly: 100 }), asset('etf', 'Fonds & ETF', 400)],
      strategy: strategy({ targets: { 'Fonds & ETF': 1 }, mainAssetByClass: { 'Fonds & ETF': 'etf' } }),
    });
    expect(byAsset(lines)).toEqual({ per: 1200, etf: 1200 });
    expect(sum(lines)).toBe(2400);
  });

  it('le versement fixe est plafonné à M', () => {
    const lines = allocate({
      amount: 80, ratio: null,
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
      amount: 100, ratio: null,
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
      amount: 100, ratio: null,
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
      amount: 200, ratio: null,
      assets: [asset('per', 'PER', 0, { fixedMonthly: 50 })],
      strategy: strategy({ targets: { PER: 1 }, mainAssetByClass: { PER: 'per' } }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(200);
    expect(lines[0].origin).toBe('fixe');
  });
});
