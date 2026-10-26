import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

let repo: FakeRepo;
vi.mock('@/notion', () => ({ getRepo: () => repo }));

const { saveMetalGrid, saveMonthlyInvest, saveSpecialAssets, saveTarget } = await import('./actions');

beforeEach(() => {
  revalidateTag.mockClear();
  repo = new FakeRepo(structuredClone(fixtureSeed));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('actions Stratégie', () => {
  it('saveMonthlyInvest écrit et invalide seulement la base Stratégie', async () => {
    expect(await saveMonthlyInvest(1100)).toEqual({ ok: true });
    expect((await repo.getStrategy()).monthlyInvest).toBe(1100);
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });

  it('saveTarget écrit et invalide', async () => {
    expect(await saveTarget('Crypto', 12, 'crypto')).toEqual({ ok: true });
    expect((await repo.getStrategy()).targets.Crypto).toBe(0.12);
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });

  it('saveSpecialAssets écrit et invalide', async () => {
    expect(await saveSpecialAssets({ goldAssetId: 'or' })).toEqual({ ok: true });
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });

  it('saveMetalGrid écrit et invalide', async () => {
    const zones = [
      { label: 'Bas', min: 0, max: 60, goldPercent: 60 },
      { label: 'Haut', min: 60, max: null, goldPercent: 40 },
    ];
    expect(await saveMetalGrid(zones)).toEqual({ ok: true });
    expect((await repo.getStrategy()).metalGrid).toHaveLength(2);
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });

  it('un refus ne touche ni la Stratégie ni le cache', async () => {
    const before = await repo.getStrategy();
    expect(await saveTarget('Fonds & ETF', 99, 'hsbc')).toEqual({ ok: false, error: 'La somme des cibles dépasse 100 %' });
    expect(await saveMonthlyInvest(-5)).toEqual({ ok: false, error: 'Montant invalide' });
    expect(await saveSpecialAssets({ goldAssetId: 'hsbc' })).toEqual({ ok: false, error: 'Actif or invalide' });
    expect(await saveMetalGrid([])).toEqual({ ok: false, error: 'La grille doit avoir entre 2 et 8 zones' });
    expect(await repo.getStrategy()).toEqual(before);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('une erreur Notion ne renvoie qu’un message générique et n’invalide rien', async () => {
    vi.spyOn(repo, 'setStrategyEntry').mockRejectedValue(new Error('notion down'));
    expect(await saveMonthlyInvest(100)).toEqual({ ok: false, error: "L'enregistrement a échoué. Réessaie dans un instant." });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('saveMetalGrid : un échec après une première écriture invalide quand même la Stratégie (écritures partielles)', async () => {
    let calls = 0;
    const set = repo.setStrategyEntry.bind(repo);
    vi.spyOn(repo, 'setStrategyEntry').mockImplementation(async (e) => {
      if (++calls === 2) throw new Error('notion down');
      return set(e);
    });
    const zones = [
      { label: 'Bas', min: 0, max: 60, goldPercent: 60 },
      { label: 'Haut', min: 60, max: null, goldPercent: 40 },
    ];
    expect(await saveMetalGrid(zones)).toEqual({ ok: false, error: "L'enregistrement a échoué. Réessaie dans un instant." });
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });

  it('saveSpecialAssets : un échec après une première écriture invalide quand même la Stratégie', async () => {
    let calls = 0;
    const set = repo.setStrategyEntry.bind(repo);
    vi.spyOn(repo, 'setStrategyEntry').mockImplementation(async (e) => {
      if (++calls === 2) throw new Error('notion down');
      return set(e);
    });
    expect(await saveSpecialAssets({ goldAssetId: 'ag', silverAssetId: 'or' })).toEqual({
      ok: false, error: "L'enregistrement a échoué. Réessaie dans un instant.",
    });
    expect(revalidateTag.mock.calls).toEqual([['notion:strategy']]);
  });
});
