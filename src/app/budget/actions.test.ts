import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { deleteBudgetLineWith, reorderBudgetWith, saveBudgetLineWith } from './budgetOps';

const newLine = { name: 'Cinéma', section: 'depense' as const, category: 'Loisirs', monthlyAmount: 25, currency: 'EUR' as const, order: 11 };

beforeEach(() => revalidateTag.mockClear());

describe('saveBudgetLineWith', () => {
  it('crée la ligne puis la modifie', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const created = await saveBudgetLineWith(repo, newLine);
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : '';
    expect((await repo.listBudget()).find((l) => l.id === id)).toMatchObject({ name: 'Cinéma', monthlyAmount: 25 });

    const updated = await saveBudgetLineWith(repo, { ...newLine, id, monthlyAmount: 40 });
    expect(updated).toEqual({ ok: true, id });
    const lines = await repo.listBudget();
    expect(lines.filter((l) => l.name === 'Cinéma')).toHaveLength(1);
    expect(lines.find((l) => l.id === id)?.monthlyAmount).toBe(40);
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('refuse un montant négatif, non numérique ou un nom vide, sans écrire', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listBudget()).length;
    for (const bad of [
      { ...newLine, monthlyAmount: -1 },
      { ...newLine, monthlyAmount: Number.NaN },
      { ...newLine, monthlyAmount: 'abc' as unknown as number },
      { ...newLine, name: '   ' },
      { ...newLine, category: '' },
      { ...newLine, currency: 'JPY' as unknown as 'EUR' },
    ]) {
      expect((await saveBudgetLineWith(repo, bad)).ok).toBe(false);
    }
    expect(await saveBudgetLineWith(repo, { ...newLine, monthlyAmount: -1 })).toEqual({ ok: false, error: 'Montant invalide' });
    expect(await repo.listBudget()).toHaveLength(before);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("renvoie une erreur lisible si le dépôt échoue, sans propager l'exception", async () => {
    const repo = new FakeRepo(fixtureSeed);
    repo.upsertBudgetLine = async () => { throw new Error('Notion 502'); };
    const r = await saveBudgetLineWith(repo, newLine);
    expect(r.ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('deleteBudgetLineWith', () => {
  it('supprime la ligne et invalide le cache', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect(await deleteBudgetLineWith(repo, 'b-courses')).toEqual({ ok: true });
    expect((await repo.listBudget()).some((l) => l.id === 'b-courses')).toBe(false);
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('renvoie une erreur si le dépôt échoue', async () => {
    const repo = new FakeRepo(fixtureSeed);
    repo.deleteBudgetLine = async () => { throw new Error('boom'); };
    expect((await deleteBudgetLineWith(repo, 'b-courses')).ok).toBe(false);
  });
});

describe('reorderBudgetWith', () => {
  it("écrit l'ordre = index pour chaque ligne listée", async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect(await reorderBudgetWith(repo, ['b-charges', 'b-loyer', 'b-courses'])).toEqual({ ok: true });
    const byId = Object.fromEntries((await repo.listBudget()).map((l) => [l.id, l.order]));
    expect(byId['b-charges']).toBe(0);
    expect(byId['b-loyer']).toBe(1);
    expect(byId['b-courses']).toBe(2);
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('ignore les identifiants inconnus', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect((await reorderBudgetWith(repo, ['inconnu', 'b-loyer'])).ok).toBe(true);
    expect((await repo.listBudget()).find((l) => l.id === 'b-loyer')?.order).toBe(1);
  });
});
