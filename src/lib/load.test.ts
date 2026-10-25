import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAGS } from './cacheTags';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { DEFAULT_METAL_GRID } from '@/domain/types';

const state = vi.hoisted(() => ({ repo: null as unknown, demo: false, getSeries: vi.fn(), builds: 0 }));

vi.mock('next/cache', () => ({
  // Sans runtime Next : on exécute la fonction, avec l'aller-retour JSON du vrai cache ; les options sont gardées pour les vérifier.
  unstable_cache: vi.fn((fn: (...a: unknown[]) => Promise<unknown>) => async (...a: unknown[]) => JSON.parse(JSON.stringify(await fn(...a)))),
}));
vi.mock('./buildDashboard', async (orig) => {
  const m = await orig<typeof import('./buildDashboard')>();
  return { ...m, buildDashboard: (...a: Parameters<typeof m.buildDashboard>) => { state.builds++; return m.buildDashboard(...a); } };
});
vi.mock('@/notion', () => ({ getRepo: () => state.repo, isDemo: () => state.demo }));
vi.mock('@/prices/yahoo', () => ({
  METAL_SYMBOLS: { XAU: 'GC=F', XAG: 'SI=F' },
  createYahooProvider: () => ({ getSeries: state.getSeries }),
}));

const SERIES = [{ date: '2026-10-05', close: 4000 }, { date: '2026-10-12', close: 4100 }];

async function freshLoad() {
  vi.resetModules();
  return import('./load');
}

beforeEach(() => {
  state.repo = new FakeRepo(fixtureSeed);
  state.demo = false;
  state.builds = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  state.getSeries.mockReset();
  state.getSeries.mockImplementation(async (id: string) =>
    id === 'GC=F' ? SERIES : SERIES.map((p) => ({ ...p, close: p.close / 80 })));
});

afterEach(() => vi.restoreAllMocks());

describe('getDashboard', () => {
  it('assemble le tableau de bord depuis le Repo et la série de ratio', async () => {
    const { getDashboard } = await freshLoad();
    const d = await getDashboard();
    expect(d.assets).toHaveLength(19);
    expect(d.metals.ratio).toBeCloseTo(64.51, 2);
    expect(d.metals.ratioHistory).toEqual([
      { date: '2026-10-05', ratio: 80 }, { date: '2026-10-12', ratio: 80 },
    ]);
    expect(state.getSeries).toHaveBeenCalledWith('GC=F', '5y', '1wk');
    expect(state.getSeries).toHaveBeenCalledWith('SI=F', '5y', '1wk');
  });

  it('I9 : expose le mode démo du Repo', async () => {
    state.demo = true;
    const { getDashboard } = await freshLoad();
    expect((await getDashboard()).demo).toBe(true);
  });

  it('déclare un cache par liste (tag de la base, 15 min) et la série (tag series, 24 h) ; plus de cache global', async () => {
    await freshLoad();
    const { unstable_cache } = await import('next/cache');
    const calls = vi.mocked(unstable_cache).mock.calls.map(([, keys, opts]) => ({ keys, opts }));
    for (const key of ['assets', 'movements', 'debts', 'budget', 'strategy', 'plan', 'history'] as const) {
      expect(calls, key).toContainEqual({ keys: [TAGS[key]], opts: { tags: [TAGS[key]], revalidate: 900 } });
    }
    expect(calls).toContainEqual({ keys: ['series'], opts: { tags: ['series'], revalidate: 86_400 } });
    expect(calls).toHaveLength(8);
    expect(JSON.stringify(calls)).not.toContain('"notion"');
  });

  it('lit chaque liste dans son propre cache : une seule lecture du Repo par liste', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const spies = (['listAssets', 'listMovements', 'listDebts', 'listBudget', 'getStrategy', 'listPlan', 'listSnapshots'] as const)
      .map((m) => vi.spyOn(repo, m));
    state.repo = repo;
    const { getDashboard } = await freshLoad();
    await getDashboard();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('buildDashboard est exécuté à chaque getDashboard() (pur, hors cache)', async () => {
    const { getDashboard } = await freshLoad();
    await getDashboard();
    await getDashboard();
    expect(state.builds).toBe(2);
  });

  it('journalise le temps de chaque base sans montant : [perf] assets 12ms', async () => {
    const { getDashboard } = await freshLoad();
    await getDashboard();
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    for (const key of ['assets', 'movements', 'debts', 'budget', 'strategy', 'plan', 'history']) {
      expect(lines.some((l) => new RegExp(`^\\[perf\\] ${key} \\d+ms$`).test(l)), key).toBe(true);
    }
  });

  it('si la série échoue, le tableau de bord reste servi avec ratioHistory vide', async () => {
    state.getSeries.mockRejectedValue(new Error('Yahoo HTTP 429'));
    const { getDashboard } = await freshLoad();
    const d = await getDashboard();
    expect(d.metals.ratioHistory).toEqual([]);
    expect(d.assets).toHaveLength(19);
  });

  it('restaure l’infini de la grille des métaux après la sérialisation du cache de la Stratégie', async () => {
    const { getDashboard } = await freshLoad();
    const d = await getDashboard();
    expect(d.strategy.metalGrid).toEqual(DEFAULT_METAL_GRID);
    expect(d.strategy.metalGrid.at(-1)?.max).toBe(Infinity);
    expect(d.metals.zone === null || d.metals.zone.max !== null).toBe(true);
  });

  it.each(['listAssets', 'listMovements', 'listDebts', 'listBudget', 'getStrategy', 'listPlan', 'listSnapshots'] as const)(
    'si la lecture %s échoue : dernière valeur réussie avec stale: true, et console.error',
    async (method) => {
      const { getDashboard } = await freshLoad();
      const ok = await getDashboard();
      expect(ok.stale).toBeFalsy();
      state.repo = Object.assign(new FakeRepo(fixtureSeed), { [method]: () => Promise.reject(new Error('Notion injoignable')) });
      const d = await getDashboard();
      expect(d.stale).toBe(true);
      expect(d.totals).toEqual(ok.totals);
      expect(d.asOf).toBe(ok.asOf);
      expect(console.error).toHaveBeenCalled();
    },
  );

  it('relance l’erreur s’il n’existe aucune valeur précédente', async () => {
    state.repo = Object.assign(new FakeRepo(fixtureSeed), { listAssets: () => Promise.reject(new Error('Notion injoignable')) });
    const { getDashboard } = await freshLoad();
    await expect(getDashboard()).rejects.toThrow('Notion injoignable');
  });
});
