import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationLine } from '@/domain/types';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

const { declarePurchaseWith, validatePlanWith } = await import('./actions');

const lines: AllocationLine[] = [
  { assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' },
  { assetId: 'hsbc', amount: 800, origin: 'cible', reason: 'Classe Fonds & ETF en retard sur sa cible' },
];

const emptyPlanRepo = () => new FakeRepo({ ...fixtureSeed, plan: [] });

beforeEach(() => revalidateTag.mockClear());

describe('validatePlanWith', () => {
  it('écrit les lignes du plan (sans la justification) et invalide le cache', async () => {
    const repo = emptyPlanRepo();
    const res = await validatePlanWith(repo, '2026-11', lines);
    expect(res).toEqual({ ok: true });
    expect(await repo.listPlan()).toEqual([
      expect.objectContaining({ month: '2026-11', assetId: 'per', amount: 100, origin: 'fixe' }),
      expect.objectContaining({ month: '2026-11', assetId: 'hsbc', amount: 800, origin: 'cible' }),
    ]);
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('refuse de valider deux fois le même mois', async () => {
    const repo = emptyPlanRepo();
    await validatePlanWith(repo, '2026-11', lines);
    revalidateTag.mockClear();
    const res = await validatePlanWith(repo, '2026-11', lines);
    expect(res).toEqual({ ok: false, error: 'Plan déjà validé pour 2026-11' });
    expect(await repo.listPlan()).toHaveLength(2);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('refuse un mois mal formé ou une liste vide', async () => {
    const repo = emptyPlanRepo();
    expect((await validatePlanWith(repo, 'novembre', lines)).ok).toBe(false);
    expect((await validatePlanWith(repo, '2026-11', [])).ok).toBe(false);
    expect(await repo.listPlan()).toHaveLength(0);
  });

  it('refuse un montant négatif ou non fini', async () => {
    const repo = emptyPlanRepo();
    expect((await validatePlanWith(repo, '2026-11', [{ ...lines[0], amount: -1 }])).ok).toBe(false);
    expect((await validatePlanWith(repo, '2026-11', [{ ...lines[0], amount: Number.NaN }])).ok).toBe(false);
  });

  it("renvoie l'erreur du dépôt au lieu de lever", async () => {
    const repo = emptyPlanRepo();
    repo.createPlanLines = async () => { throw new Error('Notion indisponible'); };
    expect(await validatePlanWith(repo, '2026-11', lines)).toEqual({ ok: false, error: 'Notion indisponible' });
  });
});

describe('declarePurchaseWith', () => {
  it('crée un mouvement d’achat lié au mois du plan', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    const res = await declarePurchaseWith(repo, 'syla', '2026-11', 600, '2026-11-05');
    expect(res).toEqual({ ok: true });
    const created = (await repo.listMovements()).slice(before);
    expect(created).toEqual([
      expect.objectContaining({
        assetId: 'syla', kind: 'buy', planMonth: '2026-11', label: 'Plan 2026-11', quantity: 0, amount: 600, date: '2026-11-05',
      }),
    ]);
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('refuse un montant nul ou négatif', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect((await declarePurchaseWith(repo, 'syla', '2026-11', 0, '2026-11-05')).ok).toBe(false);
    expect((await declarePurchaseWith(repo, 'syla', '2026-11', -5, '2026-11-05')).ok).toBe(false);
  });

  it('refuse un actif inconnu ou une date invalide', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect((await declarePurchaseWith(repo, 'inconnu', '2026-11', 10, '2026-11-05')).ok).toBe(false);
    expect((await declarePurchaseWith(repo, 'syla', '2026-11', 10, '05/11/2026')).ok).toBe(false);
  });

  it('exige le poids fin pour un métal et en fait la quantité', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    const missing = await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05');
    expect(missing).toEqual({ ok: false, error: 'Poids fin requis pour un métal précieux' });
    expect((await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05', 0)).ok).toBe(false);
    expect(await repo.listMovements()).toHaveLength(before);

    const res = await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05', 2.5);
    expect(res).toEqual({ ok: true });
    const created = (await repo.listMovements()).slice(before);
    expect(created).toEqual([expect.objectContaining({ assetId: 'or', quantity: 2.5, amount: 330, planMonth: '2026-11' })]);
  });

  it("ignore le poids fin pour un actif qui n'est pas un métal", async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    await declarePurchaseWith(repo, 'syla', '2026-11', 100, '2026-11-05', 3);
    expect((await repo.listMovements())[before].quantity).toBe(0);
  });
});
