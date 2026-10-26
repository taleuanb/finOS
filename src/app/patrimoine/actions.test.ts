import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

let repo: FakeRepo;
vi.mock('@/notion', () => ({ getRepo: () => repo }));

const { addMovement, archiveAsset, createAsset, createDebt, deleteDebt, updateAsset, updateDebt } = await import('./actions');

const tags = () => revalidateTag.mock.calls.map((c) => c[0]).sort();

beforeEach(() => {
  revalidateTag.mockClear();
  repo = new FakeRepo(fixtureSeed);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('actions Patrimoine : succès', () => {
  it("createAsset écrit et n'invalide que le cache des actifs", async () => {
    const res = await createAsset({ name: 'Livret B', assetClass: 'Épargne', currency: 'EUR', mode: 'manual', manualValue: 500, manualValueDate: '2026-11-01' });
    expect(res.ok).toBe(true);
    expect((await repo.listAssets()).some((a) => a.name === 'Livret B')).toBe(true);
    expect(tags()).toEqual(['notion:assets']);
  });

  it('updateAsset et archiveAsset invalident les actifs', async () => {
    expect(await updateAsset('lcl', { name: 'LCL 2' })).toEqual({ ok: true });
    expect(tags()).toEqual(['notion:assets']);
    revalidateTag.mockClear();
    expect(await archiveAsset('lcl', true)).toEqual({ ok: true });
    expect(tags()).toEqual(['notion:assets']);
  });

  it('addMovement invalide les mouvements et les actifs (rollups)', async () => {
    const res = await addMovement({ assetId: 'etf-revolut', kind: 'buy', date: '2026-11-03', quantity: 1, amount: 100 });
    expect(res.ok).toBe(true);
    expect(tags()).toEqual(['notion:assets', 'notion:movements']);
  });

  it('createDebt, updateDebt et deleteDebt invalident les crédits', async () => {
    const created = await createDebt({ name: 'Prêt', currency: 'EUR', outstanding: 1000 });
    expect(created.ok).toBe(true);
    expect(tags()).toEqual(['notion:debts']);
    revalidateTag.mockClear();
    expect(await updateDebt('credit-dar-sakan', { outstanding: 500_000 })).toEqual({ ok: true });
    expect(tags()).toEqual(['notion:debts']);
    revalidateTag.mockClear();
    expect(await deleteDebt('credit-dar-sakan')).toEqual({ ok: true });
    expect(tags()).toEqual(['notion:debts']);
  });
});

describe('actions Patrimoine : échecs', () => {
  it("n'invalide aucun cache et n'écrit rien sur un refus de validation", async () => {
    const assets = (await repo.listAssets()).length;
    const movements = (await repo.listMovements()).length;
    const debts = (await repo.listDebts()).length;
    expect((await createAsset({ name: '', assetClass: 'Épargne', currency: 'EUR', mode: 'manual' })).ok).toBe(false);
    expect((await updateAsset('inconnu', { name: 'x' })).ok).toBe(false);
    expect((await archiveAsset('inconnu', true)).ok).toBe(false);
    expect((await addMovement({ assetId: 'or', kind: 'buy', date: '2026-11-03', quantity: 0, amount: 100 })).ok).toBe(false);
    expect((await createDebt({ name: 'x', currency: 'EUR', outstanding: -1 })).ok).toBe(false);
    expect((await updateDebt('inconnu', { outstanding: 1 })).ok).toBe(false);
    expect((await deleteDebt('inconnu')).ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect((await repo.listAssets()).length).toBe(assets);
    expect((await repo.listMovements()).length).toBe(movements);
    expect((await repo.listDebts()).length).toBe(debts);
  });

  it("renvoie une erreur générique sans invalider le cache quand l'écriture Notion échoue", async () => {
    vi.spyOn(repo, 'createAsset').mockRejectedValue(new Error('Notion 500 detail-secret'));
    const res = await createAsset({ name: 'Livret B', assetClass: 'Épargne', currency: 'EUR', mode: 'manual', manualValue: 5, manualValueDate: '2026-11-01' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('detail-secret');
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
