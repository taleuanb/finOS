import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { DEFAULT_METAL_GRID } from '@/domain/types';

const state = vi.hoisted(() => ({ repo: null as unknown, demo: false, getSeries: vi.fn() }));

vi.mock('next/cache', () => ({
  // Sans runtime Next : on exécute la fonction telle quelle, en gardant les options pour les vérifier.
  unstable_cache: vi.fn((fn: (...a: unknown[]) => unknown) => fn),
}));
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
  state.getSeries.mockReset();
  state.getSeries.mockImplementation(async (id: string) =>
    id === 'GC=F' ? SERIES : SERIES.map((p) => ({ ...p, close: p.close / 80 })));
});

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

  it('déclare les caches : dashboard (tag notion, 600 s) et series (tag series, 24 h)', async () => {
    await freshLoad();
    const { unstable_cache } = await import('next/cache');
    const calls = vi.mocked(unstable_cache).mock.calls.map(([, keys, opts]) => ({ keys, opts }));
    expect(calls).toContainEqual({ keys: ['dashboard'], opts: { tags: ['notion'], revalidate: 600 } });
    expect(calls).toContainEqual({ keys: ['series'], opts: { tags: ['series'], revalidate: 86_400 } });
  });

  it('si la série échoue, le tableau de bord reste servi avec ratioHistory vide', async () => {
    state.getSeries.mockRejectedValue(new Error('Yahoo HTTP 429'));
    const { getDashboard } = await freshLoad();
    const d = await getDashboard();
    expect(d.metals.ratioHistory).toEqual([]);
    expect(d.assets).toHaveLength(19);
  });

  it('restaure l’infini de la grille des métaux après la sérialisation du cache', async () => {
    const { reviveDashboard } = await freshLoad();
    const { fixtureDashboard } = await import('./fixtures');
    const roundTrip = JSON.parse(JSON.stringify(fixtureDashboard));
    expect(roundTrip.strategy.metalGrid.at(-1).max).toBeNull();
    expect(reviveDashboard(roundTrip).strategy.metalGrid).toEqual(DEFAULT_METAL_GRID);
  });

  it('en cas d’échec, renvoie la dernière valeur réussie avec stale: true', async () => {
    const { getDashboard } = await freshLoad();
    const ok = await getDashboard();
    state.repo = Object.assign(new FakeRepo(fixtureSeed), { listAssets: () => Promise.reject(new Error('Notion injoignable')) });
    const d = await getDashboard();
    expect(d.stale).toBe(true);
    expect(d.totals).toEqual(ok.totals);
    expect(d.asOf).toBe(ok.asOf);
  });

  it('relance l’erreur s’il n’existe aucune valeur précédente', async () => {
    state.repo = Object.assign(new FakeRepo(fixtureSeed), { listAssets: () => Promise.reject(new Error('Notion injoignable')) });
    const { getDashboard } = await freshLoad();
    await expect(getDashboard()).rejects.toThrow('Notion injoignable');
  });
});
