import { describe, expect, it } from 'vitest';
import type { AllocationLine, Asset } from '@/domain/types';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { declarePurchaseWith, validatePlanWith } from './planOps';

const NOW = new Date('2026-11-05T10:00:00Z');

const lines: AllocationLine[] = [
  { assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' },
  { assetId: 'hsbc', amount: 800, origin: 'cible', reason: 'Classe Fonds & ETF en retard sur sa cible' },
];

const emptyPlanRepo = () => new FakeRepo({ ...fixtureSeed, plan: [] });
const withAsset = (id: string, patch: Partial<Asset>) =>
  new FakeRepo({ ...fixtureSeed, plan: [], assets: fixtureSeed.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

describe('validatePlanWith', () => {
  it('écrit les lignes du plan (sans la justification)', async () => {
    const repo = emptyPlanRepo();
    expect(await validatePlanWith(repo, '2026-11', lines, NOW)).toEqual({ ok: true });
    expect(await repo.listPlan()).toEqual([
      expect.objectContaining({ month: '2026-11', assetId: 'per', amount: 100, origin: 'fixe' }),
      expect.objectContaining({ month: '2026-11', assetId: 'hsbc', amount: 800, origin: 'cible' }),
    ]);
  });

  it('arrondit les montants au centime', async () => {
    const repo = emptyPlanRepo();
    await validatePlanWith(repo, '2026-11', [{ ...lines[0], amount: 100.004 }, { ...lines[1], amount: 799.996 }], NOW);
    expect((await repo.listPlan()).map((l) => l.amount)).toEqual([100, 800]);
  });

  it('refuse de valider deux fois le même mois', async () => {
    const repo = emptyPlanRepo();
    await validatePlanWith(repo, '2026-11', lines, NOW);
    const res = await validatePlanWith(repo, '2026-11', lines, NOW);
    expect(res).toEqual({ ok: false, error: 'Plan déjà validé pour 2026-11' });
    expect(await repo.listPlan()).toHaveLength(2);
  });

  it('refuse un mois autre que le mois courant à Paris', async () => {
    const repo = emptyPlanRepo();
    expect((await validatePlanWith(repo, '2026-12', lines, NOW)).ok).toBe(false);
    expect((await validatePlanWith(repo, '2026-10', lines, NOW)).ok).toBe(false);
    expect((await validatePlanWith(repo, 'novembre', lines, NOW)).ok).toBe(false);
    // 23 h 30 UTC le 31 octobre = déjà le 1er novembre à Paris
    expect((await validatePlanWith(repo, '2026-11', lines, new Date('2026-10-31T23:30:00Z'))).ok).toBe(true);
    expect(await repo.listPlan()).toHaveLength(2);
  });

  it('refuse une liste vide', async () => {
    const repo = emptyPlanRepo();
    expect((await validatePlanWith(repo, '2026-11', [], NOW)).ok).toBe(false);
    expect(await repo.listPlan()).toHaveLength(0);
  });

  it.each([
    ['négatif', -1],
    ['nul', 0],
    ['non fini', Number.NaN],
    ['infini', Number.POSITIVE_INFINITY],
    ['trop grand', 1_000_001],
  ])('refuse un montant %s', async (_label, amount) => {
    const repo = emptyPlanRepo();
    const res = await validatePlanWith(repo, '2026-11', [{ ...lines[0], amount }], NOW);
    expect(res.ok).toBe(false);
    expect(await repo.listPlan()).toHaveLength(0);
  });

  it('refuse un actif inconnu, archivé ou en double', async () => {
    const repo = emptyPlanRepo();
    expect((await validatePlanWith(repo, '2026-11', [{ ...lines[0], assetId: 'inconnu' }], NOW)).ok).toBe(false);
    expect((await validatePlanWith(repo, '2026-11', [lines[0], { ...lines[1], assetId: 'per' }], NOW)).ok).toBe(false);
    const archived = withAsset('hsbc', { archived: true });
    expect((await validatePlanWith(archived, '2026-11', lines, NOW)).ok).toBe(false);
    expect(await repo.listPlan()).toHaveLength(0);
    expect(await archived.listPlan()).toHaveLength(0);
  });

  it('refuse une origine inconnue', async () => {
    const repo = emptyPlanRepo();
    const bad = { ...lines[0], origin: 'autre' } as unknown as AllocationLine;
    expect((await validatePlanWith(repo, '2026-11', [bad], NOW)).ok).toBe(false);
  });

  it('I11 : actif auto (hors métaux) : la quantité de parts / tokens devient la quantité du mouvement', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    expect(await declarePurchaseWith(repo, 'hsbc', '2026-11', 300, '2026-11-05', 8.13)).toEqual({ ok: true });
    expect((await repo.listMovements())[before]).toMatchObject({ assetId: 'hsbc', quantity: 8.13, amount: 300 });
    expect(await declarePurchaseWith(repo, 'crypto', '2026-11', 100, '2026-11-05')).toEqual({ ok: true });
    expect((await repo.listMovements())[before + 1]).toMatchObject({ assetId: 'crypto', quantity: 0 }); // à compléter dans Notion
  });

  it('I11 : refuse une quantité négative ou non finie', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    for (const q of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await declarePurchaseWith(repo, 'hsbc', '2026-11', 300, '2026-11-05', q)).toEqual({ ok: false, error: 'Quantité invalide' });
    }
    expect(await repo.listMovements()).toHaveLength(before);
    expect((await declarePurchaseWith(repo, 'hsbc', '2026-11', 300, '2026-11-05', 0)).ok).toBe(true);
  });

  it("renvoie un message générique (sans le texte brut de l'erreur du dépôt)", async () => {
    const repo = emptyPlanRepo();
    repo.createPlanLines = async () => { throw new Error('Notion indisponible: token secret_abc'); };
    const res = await validatePlanWith(repo, '2026-11', lines, NOW);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Notion|secret/);
  });
});

describe('declarePurchaseWith', () => {
  it('crée un mouvement d’achat lié au mois du plan', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    expect(await declarePurchaseWith(repo, 'syla', '2026-11', 600, '2026-11-05')).toEqual({ ok: true });
    expect((await repo.listMovements()).slice(before)).toEqual([
      expect.objectContaining({
        assetId: 'syla', kind: 'buy', planMonth: '2026-11', label: 'Plan 2026-11', quantity: 0, amount: 600, date: '2026-11-05',
      }),
    ]);
  });

  it("enregistre le montant tel quel, dans la devise de l'actif", async () => {
    const repo = withAsset('syla', { currency: 'MAD' });
    const before = (await repo.listMovements()).length;
    await declarePurchaseWith(repo, 'syla', '2026-11', 6510, '2026-11-05');
    expect((await repo.listMovements())[before]).toMatchObject({ assetId: 'syla', amount: 6510 });
  });

  it('refuse un montant nul, négatif ou non fini', async () => {
    const repo = new FakeRepo(fixtureSeed);
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await declarePurchaseWith(repo, 'syla', '2026-11', amount, '2026-11-05')).ok).toBe(false);
    }
  });

  it('refuse un actif inconnu', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect((await declarePurchaseWith(repo, 'inconnu', '2026-11', 10, '2026-11-05')).ok).toBe(false);
  });

  it.each(['05/11/2026', '2026-13-45', '2026-02-30', '2026-11-00', ''])('refuse la date %j', async (date) => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    expect((await declarePurchaseWith(repo, 'syla', '2026-11', 10, date)).ok).toBe(false);
    expect(await repo.listMovements()).toHaveLength(before);
  });

  it('refuse un mois mal formé', async () => {
    const repo = new FakeRepo(fixtureSeed);
    expect((await declarePurchaseWith(repo, 'syla', 'novembre', 10, '2026-11-05')).ok).toBe(false);
  });

  it('exige le poids fin pour un métal et en fait la quantité', async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    expect(await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05')).toEqual({
      ok: false, error: 'Poids fin requis pour un métal précieux',
    });
    expect((await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05', 0)).ok).toBe(false);
    expect((await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05', Number.NaN)).ok).toBe(false);
    expect(await repo.listMovements()).toHaveLength(before);

    expect(await declarePurchaseWith(repo, 'or', '2026-11', 330, '2026-11-05', 2.5)).toEqual({ ok: true });
    expect((await repo.listMovements()).slice(before)).toEqual([
      expect.objectContaining({ assetId: 'or', quantity: 2.5, amount: 330, planMonth: '2026-11' }),
    ]);
  });

  it("ignore le poids fin pour un actif qui n'est pas un métal", async () => {
    const repo = new FakeRepo(fixtureSeed);
    const before = (await repo.listMovements()).length;
    await declarePurchaseWith(repo, 'syla', '2026-11', 100, '2026-11-05', 3);
    expect((await repo.listMovements())[before].quantity).toBe(0);
  });

  it("renvoie un message générique (sans le texte brut de l'erreur du dépôt)", async () => {
    const repo = new FakeRepo(fixtureSeed);
    repo.createMovement = async () => { throw new Error('Notion indisponible: token secret_abc'); };
    const res = await declarePurchaseWith(repo, 'syla', '2026-11', 10, '2026-11-05');
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Notion|secret/);
  });
});
