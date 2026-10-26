import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { buildDashboard } from '@/lib/buildDashboard';
import { runSync } from './run';
import type { FxProvider, FxRates, HistoricalPriceProvider, PriceProvider, Quote } from '@/domain/types';

const NOW = new Date('2026-10-27T05:00:00Z'); // 2026-10-27 à Paris
const TODAY = '2026-10-27';
const FX: FxRates = { date: TODAY, EUR: 1, MAD: 10, USD: 1.1, GBP: 0.85 };
const OZ_G = 31.1034768;

const q = (id: string, price: number, currency: Quote['currency'] = 'EUR'): Quote => ({ id, price, currency });

function fakeYahoo(over: { quotes?: Record<string, Quote | Error>; closes?: Record<string, number | Error> } = {}) {
  const quotes: Record<string, Quote | Error> = {
    LU0806931092: q('LU0806931092', 40),
    'IWDA.AS': q('IWDA.AS', 170),
    XAU: q('XAU', 2700, 'USD'),
    XAG: q('XAG', 32, 'USD'),
    ...over.quotes,
  };
  const closes: Record<string, number | Error> = { 'GC=F': 2000, 'SI=F': 25, 'EURUSD=X': 1.25, ...over.closes };
  const quoteCalls: string[][] = [];
  const closeCalls: [string, string][] = [];
  const provider: PriceProvider & HistoricalPriceProvider = {
    async getQuotes(ids) {
      quoteCalls.push(ids);
      return new Map(ids.map((id) => [id, quotes[id] ?? new Error(`inconnu : ${id}`)]));
    },
    async getCloseOn(id, date) {
      closeCalls.push([id, date]);
      const c = closes[id];
      if (c === undefined) throw new Error(`pas de cours ${id}`);
      if (c instanceof Error) throw c;
      return c;
    },
    async getSeries() { return []; },
  };
  return { provider, quoteCalls, closeCalls };
}

function fakeCrypto(quotes: Record<string, Quote | Error> = { bitcoin: q('bitcoin', 100_000) }) {
  const calls: string[][] = [];
  const provider: PriceProvider = {
    async getQuotes(ids) {
      calls.push(ids);
      return new Map(ids.map((id) => [id, quotes[id] ?? new Error(`inconnu : ${id}`)]));
    },
  };
  return { provider, calls };
}

const okFx: FxProvider = { async getRates() { return FX; } };

function setup(over: { repo?: FakeRepo; yahoo?: ReturnType<typeof fakeYahoo>; crypto?: ReturnType<typeof fakeCrypto>; fx?: FxProvider } = {}) {
  const repo = over.repo ?? new FakeRepo(fixtureSeed);
  const yahoo = over.yahoo ?? fakeYahoo();
  const crypto = over.crypto ?? fakeCrypto();
  const deps = { repo, yahoo: yahoo.provider, crypto: crypto.provider, fx: over.fx ?? okFx, now: NOW };
  return { repo, yahoo, crypto, deps };
}

const byId = async (repo: FakeRepo) => new Map((await repo.listAssets()).map((a) => [a.id, a]));

afterEach(() => vi.useRealTimers());

describe('runSync', () => {
  it('valorise tous les actifs auto, statut OK, et écrit l\'instantané du jour', async () => {
    const { repo, deps } = setup();
    const report = await runSync(deps);
    expect(report).toMatchObject({ date: TODAY, errors: [], partial: false });

    const a = await byId(repo);
    expect(a.get('hsbc')).toMatchObject({ unitPrice: 40, value: 24_000, valueEur: 24_000, syncStatus: 'OK', lastUpdate: NOW.toISOString() });
    expect(a.get('etf-revolut')).toMatchObject({ value: 17_000, valueEur: 17_000, syncStatus: 'OK' });
    expect(a.get('crypto')).toMatchObject({ unitPrice: 100_000, value: 10_000, valueEur: 10_000, syncStatus: 'OK' });
    const goldKg = (2700 / OZ_G) * 1000 / 1.1;
    expect(a.get('or')!.unitPrice).toBeCloseTo(goldKg, 6);
    // Quantité = somme des mouvements (I12) : 6,4516 g + 6,4516 g + collier 0 g.
    expect(a.get('or')!.valueEur).toBeCloseTo((12.9032 * goldKg) / 1000, 6);
    expect(a.get('or')!.syncStatus).toBe('OK');
    // Actif manuel en MAD : valeur € recalculée avec le taux du jour (1 € = 10 MAD).
    expect(a.get('dar-sakan')).toMatchObject({ value: 1_200_000, valueEur: 120_000 });

    const snap = (await repo.listSnapshots()).find((s) => s.date === TODAY)!;
    expect(snap).toBeDefined();
    expect(snap.partial).toBe(false);
    expect(snap.eurMad).toBe(10);
    expect(snap.eurUsd).toBe(1.1);
    expect(snap.goldSilverRatio).toBeCloseTo(2700 / 32, 6);
    expect(snap.totalDebtsEur).toBeCloseTo(60_000, 6); // 600 000 MAD au taux du jour
    const sumEur = [...a.values()].reduce((s, x) => s + (x.valueEur ?? 0), 0);
    expect(snap.totalAssetsEur).toBeCloseTo(sumEur, 6);
    expect(snap.netEur).toBeCloseTo(sumEur - 60_000, 6);
    expect(report.updated).toBe([...a.values()].filter((x) => !x.archived).length);
  });

  it('route la crypto vers CoinGecko et tout le reste vers Yahoo', async () => {
    const { yahoo, crypto, deps } = setup();
    await runSync(deps);
    expect(crypto.calls).toEqual([['bitcoin']]);
    const yahooIds = yahoo.quoteCalls.flat();
    expect(yahooIds).toEqual(expect.arrayContaining(['LU0806931092', 'IWDA.AS', 'XAU', 'XAG']));
    expect(yahooIds).not.toContain('bitcoin');
  });

  it('échec partiel : une source en erreur et une écriture qui lève, les autres actifs sont mis à jour', async () => {
    class FlakyRepo extends FakeRepo {
      override async updateAssetValuation(id: string, patch: Parameters<FakeRepo['updateAssetValuation']>[1]) {
        if (id === 'hsbc' && patch.syncStatus === 'OK') throw new Error('Notion 500');
        return super.updateAssetValuation(id, patch);
      }
    }
    const repo = new FlakyRepo(fixtureSeed);
    const { deps } = setup({ repo, yahoo: fakeYahoo({ quotes: { 'IWDA.AS': new Error('ticker introuvable : IWDA.AS') } }) });
    const report = await runSync(deps);

    expect(report.errors).toHaveLength(2);
    expect(report.errors.map((e) => e.assetId).sort()).toEqual(['etf-revolut', 'hsbc']);
    expect(report.errors.find((e) => e.assetId === 'etf-revolut')!.message).toContain('IWDA.AS');
    expect(report.errors.find((e) => e.assetId === 'hsbc')!.message).toContain('Notion 500');
    expect(report.partial).toBe(true);

    const a = await byId(repo);
    expect(a.get('etf-revolut')).toMatchObject({ value: 16_310, valueEur: 16_310 });
    expect(a.get('etf-revolut')!.syncStatus).toMatch(/^⚠ /);
    expect(a.get('hsbc')).toMatchObject({ value: 22_140, valueEur: 22_140 });
    expect(a.get('hsbc')!.syncStatus).toMatch(/^⚠ /);
    expect(a.get('crypto')).toMatchObject({ valueEur: 10_000, syncStatus: 'OK' });
    expect(a.get('or')!.syncStatus).toBe('OK');

    const snap = (await repo.listSnapshots()).find((s) => s.date === TODAY)!;
    expect(snap.partial).toBe(true);
    expect(snap.byClass['Fonds & ETF']).toBe(22_140 + 16_310); // anciennes valeurs conservées
  });

  it('taux de change indisponibles : reprend ceux du dernier instantané et passe en partiel', async () => {
    const fx: FxProvider = { async getRates() { throw new Error('taux de change indisponible'); } };
    const { repo, deps } = setup({ fx });
    const last = (await repo.listSnapshots()).at(-1)!;
    const report = await runSync(deps);

    expect(report.partial).toBe(true);
    expect(report.errors.some((e) => e.message.includes('taux de change'))).toBe(true);
    const snap = (await repo.listSnapshots()).find((s) => s.date === TODAY)!;
    expect(snap.eurMad).toBe(last.eurMad);
    expect(snap.eurUsd).toBe(last.eurUsd);
    expect(snap.partial).toBe(true);
    // Les actifs sont tout de même valorisés avec les taux repris.
    const a = await byId(repo);
    expect(a.get('hsbc')!.valueEur).toBe(24_000);
    expect(a.get('dar-sakan')!.valueEur).toBeCloseTo(1_200_000 / last.eurMad, 6);
  });

  it('taux indisponibles et aucun instantané : rien n\'est écrit, erreur rapportée', async () => {
    const repo = new FakeRepo({ ...fixtureSeed, snapshots: [] });
    const fx: FxProvider = { async getRates() { throw new Error('taux de change indisponible'); } };
    const report = await runSync(setup({ repo, fx }).deps);
    expect(report).toMatchObject({ updated: 0, partial: true });
    expect(report.errors).toHaveLength(1);
    expect(await repo.listSnapshots()).toEqual([]);
  });

  it('renseigne les spots manquants des mouvements de métaux (et ignore ceux sans quantité)', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const id = await repo.createMovement({ label: 'Lingot or', date: '2026-10-05', assetId: 'or', kind: 'buy', quantity: 10, amount: 1000 });
    const { yahoo, deps } = setup({ repo });
    const report = await runSync(deps);
    expect(report.errors).toEqual([]);

    const movs = new Map((await repo.listMovements()).map((m) => [m.id, m]));
    expect(movs.get(id)!.spotEurPerKg).toBeCloseTo((2000 / OZ_G) * 1000 / 1.25, 6);
    expect(movs.get('mv-ag-1')!.spotEurPerKg).toBeCloseTo((25 / OZ_G) * 1000 / 1.25, 6);
    expect(movs.get('mv-or-1')!.spotEurPerKg).toBe(82_100); // déjà renseigné : intact
    expect(movs.get('mv-or-3')!.spotEurPerKg).toBeUndefined(); // quantité nulle
    expect(yahoo.closeCalls).toContainEqual(['GC=F', '2026-10-05']);
    expect(yahoo.closeCalls).toContainEqual(['EURUSD=X', '2026-10-05']);
    expect(yahoo.closeCalls).toContainEqual(['SI=F', '2025-03-19']);
    expect(yahoo.closeCalls.some(([s, d]) => s === 'GC=F' && d === '2025-11-01')).toBe(false);
  });

  it('une erreur de spot est rapportée sans interrompre la synchro', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const yahoo = fakeYahoo({ closes: { 'SI=F': new Error('aucun cours') } });
    const report = await runSync(setup({ repo, yahoo }).deps);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.every((e) => e.assetId === 'ag')).toBe(true);
    expect(report.updated).toBeGreaterThan(0);
    expect((await repo.listSnapshots()).some((s) => s.date === TODAY)).toBe(true);
    expect((await repo.listMovements()).find((m) => m.id === 'mv-ag-1')!.spotEurPerKg).toBeUndefined();
  });

  it('l\'actif Épargne reçoit le solde estimé (valeur manuelle + épargne mensuelle − achats du plan)', async () => {
    const { repo, deps } = setup();
    await runSync(deps);
    const e = (await byId(repo)).get('epargne')!;
    // 160 000 MAD / 10 = 16 000 € le 2026-10-01, aucun 1er du mois ensuite, − 500 € d'achats du plan (3 oct.).
    expect(e.valueEur).toBeCloseTo(15_500, 6);
    expect(e.value).toBeCloseTo(155_000, 6);
    expect(e.syncStatus).toBe('OK');
  });

  it('épargne : sans date de valeur manuelle, on garde la valeur manuelle seule', async () => {
    const seed = structuredClone(fixtureSeed);
    delete seed.assets.find((a) => a.id === 'epargne')!.manualValueDate;
    const repo = new FakeRepo(seed);
    await runSync(setup({ repo }).deps);
    expect((await byId(repo)).get('epargne')!.valueEur).toBeCloseTo(16_000, 6);
  });

  it('deux exécutions le même jour : un seul instantané', async () => {
    const { repo, deps } = setup();
    await runSync(deps);
    await runSync(deps);
    expect((await repo.listSnapshots()).filter((s) => s.date === TODAY)).toHaveLength(1);
  });

  it('une source qui ne répond pas est coupée après 8 s (erreur pour ses actifs, pas de blocage)', async () => {
    vi.useFakeTimers();
    const hung: PriceProvider & HistoricalPriceProvider = {
      getQuotes: () => new Promise(() => {}),
      getCloseOn: () => new Promise(() => {}),
      getSeries: async () => [],
    };
    const { repo, deps } = setup();
    const p = runSync({ ...deps, yahoo: hung });
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(8_000); // cours, puis rattrapages de spot
    const report = await p;

    expect(report.partial).toBe(true);
    const ids = report.errors.map((e) => e.assetId);
    expect(ids).toEqual(expect.arrayContaining(['hsbc', 'etf-revolut', 'or', 'ag']));
    expect(report.errors.find((e) => e.assetId === 'hsbc')!.message).toMatch(/délai/);
    const a = await byId(repo);
    expect(a.get('crypto')!.syncStatus).toBe('OK');
    expect(a.get('hsbc')!.syncStatus).toMatch(/^⚠ /);
    expect((await repo.listSnapshots()).find((s) => s.date === TODAY)!.goldSilverRatio).toBeNull();
  });

  it('I12 : quantité et prix de revient calculés depuis les mouvements, pas depuis le rollup tronqué', async () => {
    const seed = structuredClone(fixtureSeed);
    seed.assets.find((a) => a.id === 'hsbc')!.quantity = 25; // rollup Notion tronqué à 25 relations
    const extra = Array.from({ length: 30 }, (_, i) => ({
      id: `mv-etf-${i}`, label: 'Achat', date: '2026-09-01', assetId: 'etf-revolut', kind: 'buy' as const, quantity: 1, amount: 150,
    }));
    seed.movements.push(...extra);
    seed.assets.find((a) => a.id === 'etf-revolut')!.quantity = 25;
    const repo = new FakeRepo(seed);
    await runSync(setup({ repo }).deps);
    const a = await byId(repo);
    expect(a.get('hsbc')!.value).toBe(24_000); // 600 parts (mouvements) × 40
    expect(a.get('etf-revolut')!.value).toBe(30 * 170);
  });

  it('cours indisponible après un nouvel achat : quantité des mouvements × dernier cours, comme le tableau de bord', async () => {
    const seed = structuredClone(fixtureSeed);
    seed.movements.push({ id: 'mv-hsbc-new', label: 'Achat', date: '2026-10-26', assetId: 'hsbc', kind: 'buy', quantity: 10, amount: 400 });
    const repo = new FakeRepo(seed);
    await runSync(setup({ repo, yahoo: fakeYahoo({ quotes: { LU0806931092: new Error('cours absent') } }) }).deps);

    const a = await byId(repo);
    expect(a.get('hsbc')!.syncStatus).toMatch(/^⚠ /);
    expect(a.get('hsbc')!.unitPrice).toBe(36.9); // dernier cours connu conservé
    expect(a.get('hsbc')!.value).toBeCloseTo(610 * 36.9, 6);
    const snap = (await repo.listSnapshots()).find((x) => x.date === TODAY)!;
    expect(snap.byClass['Fonds & ETF']).toBeCloseTo(610 * 36.9 + 17_000, 6);

    const [assets, movements, debts, budget, strategy, plan, snapshots] = await Promise.all([
      repo.listAssets(), repo.listMovements(), repo.listDebts(), repo.listBudget(), repo.getStrategy(), repo.listPlan(), repo.listSnapshots(),
    ]);
    const d = buildDashboard({ assets, movements, debts, budget, strategy, plan, snapshots, series: null, now: NOW });
    expect(d.totals.grossEur).toBeCloseTo(snap.totalAssetsEur, 6);
    expect(d.totals.debtsEur).toBeCloseTo(snap.totalDebtsEur, 6);
  });

  it('I3 : le solde Épargne de la synchro et celui du tableau de bord sont identiques', async () => {
    const { repo, deps } = setup();
    await runSync(deps);
    const [assets, movements, debts, budget, strategy, plan, snapshots] = await Promise.all([
      repo.listAssets(), repo.listMovements(), repo.listDebts(), repo.listBudget(), repo.getStrategy(), repo.listPlan(), repo.listSnapshots(),
    ]);
    const d = buildDashboard({ assets, movements, debts, budget, strategy, plan, snapshots, series: null, now: NOW });
    expect(d.plan.savings.balanceEur).toBeCloseTo(assets.find((a) => a.id === 'epargne')!.valueEur!, 9);
  });

  it('I8 : taux de change et cours sont demandés en parallèle', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowFx: FxProvider = { async getRates() { await gate; return FX; } };
    const { yahoo, crypto, deps } = setup({ fx: slowFx });
    const p = runSync(deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(yahoo.quoteCalls.length).toBe(1); // demandé avant que les taux ne répondent
    expect(crypto.calls.length).toBe(1);
    release();
    expect((await p).errors).toEqual([]);
  });

  it('I8 : les écritures des actifs se font à 3 en parallèle au plus', async () => {
    let inFlight = 0;
    let max = 0;
    class SlowRepo extends FakeRepo {
      override async updateAssetValuation(id: string, patch: Parameters<FakeRepo['updateAssetValuation']>[1]) {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return super.updateAssetValuation(id, patch);
      }
    }
    const repo = new SlowRepo(fixtureSeed);
    const report = await runSync(setup({ repo }).deps);
    expect(report.errors).toEqual([]);
    expect(max).toBe(3);
    expect(report.updated).toBe(fixtureSeed.assets.length);
  });

  it('M5 : le spot de l’argent est pris sur SI=F pour l’actif argent de la Stratégie, quel que soit son identifiant', async () => {
    const seed = structuredClone(fixtureSeed);
    seed.assets.find((a) => a.id === 'ag')!.quoteId = 'SI=F';
    const repo = new FakeRepo(seed);
    const { yahoo, deps } = setup({ repo, yahoo: fakeYahoo({ quotes: { 'SI=F': q('SI=F', 32, 'USD') } }) });
    await runSync(deps);
    expect(yahoo.closeCalls).toContainEqual(['SI=F', '2025-03-19']);
    const movs = new Map((await repo.listMovements()).map((m) => [m.id, m]));
    expect(movs.get('mv-ag-1')!.spotEurPerKg).toBeCloseTo((25 / OZ_G) * 1000 / 1.25, 6);

    const noId = structuredClone(fixtureSeed);
    delete noId.assets.find((a) => a.id === 'ag')!.quoteId;
    const repo2 = new FakeRepo(noId);
    await runSync(setup({ repo: repo2 }).deps);
    const movs2 = new Map((await repo2.listMovements()).map((m) => [m.id, m]));
    expect(movs2.get('mv-ag-4')!.spotEurPerKg).toBeCloseTo((25 / OZ_G) * 1000 / 1.25, 6);
  });
});

