import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import {
  addMovementWith, archiveAssetWith, createAssetWith, createDebtWith, deleteDebtWith, updateAssetWith, updateDebtWith,
} from './patrimoineOps';

let repo: FakeRepo;
const NOW = new Date('2026-11-05T10:00:00Z'); // Paris : 2026-11-05

beforeEach(() => {
  repo = new FakeRepo(fixtureSeed);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const manualAsset = {
  name: 'Appartement Lyon', assetClass: 'Immobilier', currency: 'EUR', mode: 'manual', manualValue: 250_000, manualValueDate: '2026-11-01',
} as const;

describe('createAssetWith', () => {
  it('crée un actif manuel et renvoie son id', async () => {
    const res = await createAssetWith(repo, manualAsset, NOW);
    expect(res.ok).toBe(true);
    const id = (res as { id: string }).id;
    const created = (await repo.listAssets()).find((a) => a.id === id);
    expect(created).toMatchObject({ name: 'Appartement Lyon', currency: 'EUR', mode: 'manual', manualValue: 250_000, manualValueDate: '2026-11-01' });
  });

  it('stocke une valeur en MAD telle quelle (jamais convertie en euros)', async () => {
    const res = await createAssetWith(repo, { ...manualAsset, currency: 'MAD', manualValue: 1_200_000 }, NOW);
    expect(res.ok).toBe(true);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created.currency).toBe('MAD');
    expect(created.manualValue).toBe(1_200_000);
  });

  it("date du jour (Paris) par défaut quand une valeur manuelle est fournie sans date", async () => {
    const { manualValueDate: _omit, ...noDate } = manualAsset;
    void _omit;
    const res = await createAssetWith(repo, noDate, NOW);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created.manualValueDate).toBe('2026-11-05');
  });

  it('crée un actif Auto avec son identifiant de cotation', async () => {
    const res = await createAssetWith(repo, { name: 'Apple', assetClass: 'Fonds & ETF', currency: 'USD', mode: 'auto', quoteId: ' AAPL ' }, NOW);
    expect(res.ok).toBe(true);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created).toMatchObject({ mode: 'auto', quoteId: 'AAPL', currency: 'USD' });
  });

  it('arrondit les montants au centime et accepte versement fixe, sous-type, établissement', async () => {
    const res = await createAssetWith(repo, { ...manualAsset, manualValue: 100.126, fixedMonthly: 50.126, subtype: 'Livret', institution: 'LCL' }, NOW);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created).toMatchObject({ manualValue: 100.13, fixedMonthly: 50.13, subtype: 'Livret', institution: 'LCL' });
  });

  const rejected: [string, unknown][] = [
    ['nom vide', { ...manualAsset, name: '   ' }],
    ['nom de plus de 200 caractères', { ...manualAsset, name: 'x'.repeat(201) }],
    ['classe inconnue', { ...manualAsset, assetClass: 'Voitures' }],
    ['devise inconnue', { ...manualAsset, currency: 'GBP' }],
    ['mode inconnu', { ...manualAsset, mode: 'robot' }],
    ['Auto sans identifiant de cotation', { name: 'X', assetClass: 'Crypto', currency: 'EUR', mode: 'auto' }],
    ['Auto avec identifiant vide', { name: 'X', assetClass: 'Crypto', currency: 'EUR', mode: 'auto', quoteId: '  ' }],
    ['métal Auto avec un identifiant autre que XAU / XAG', { name: 'Or', assetClass: 'Métaux précieux', currency: 'EUR', mode: 'auto', quoteId: 'bitcoin' }],
    ['Manuel sans valeur', { name: 'X', assetClass: 'Épargne', currency: 'EUR', mode: 'manual' }],
    ['valeur manuelle négative', { ...manualAsset, manualValue: -1 }],
    ['valeur manuelle non finie', { ...manualAsset, manualValue: Number.NaN }],
    ['valeur manuelle > 1 000 000 000', { ...manualAsset, manualValue: 1_000_000_001 }],
    ['date manuelle inexistante', { ...manualAsset, manualValueDate: '2026-02-30' }],
    ['versement fixe négatif', { ...manualAsset, fixedMonthly: -5 }],
    ['versement fixe > 1 000 000 000', { ...manualAsset, fixedMonthly: 2_000_000_000 }],
    ['établissement trop long', { ...manualAsset, institution: 'x'.repeat(61) }],
    ['établissement vide', { ...manualAsset, institution: '   ' }],
    ['entrée qui n’est pas un objet', 'oups'],
  ];
  it.each(rejected)('refuse : %s, sans rien écrire', async (_label, input) => {
    const before = (await repo.listAssets()).length;
    const res = await createAssetWith(repo, input, NOW);
    expect(res.ok).toBe(false);
    expect((await repo.listAssets()).length).toBe(before);
  });

  it('accepte un métal Auto avec XAU ou XAG (casse normalisée)', async () => {
    const res = await createAssetWith(repo, { name: 'Or 2', assetClass: 'Métaux précieux', currency: 'EUR', mode: 'auto', quoteId: 'xau' }, NOW);
    expect(res.ok).toBe(true);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created.quoteId).toBe('XAU');
  });

  it('ignore les champs inconnus (jamais de rollups ni de valeur € écrits)', async () => {
    const res = await createAssetWith(repo, { ...manualAsset, valueEur: 9_999_999, value: 5, costBasis: 12, evil: true }, NOW);
    expect(res.ok).toBe(true);
    const created = (await repo.listAssets()).find((a) => a.id === (res as { id: string }).id)!;
    expect(created.valueEur).toBeUndefined();
    expect(created.value).toBeUndefined();
    expect(created.costBasis).toBe(0);
    expect(created).not.toHaveProperty('evil');
  });

  it("renvoie une erreur générique et journalise le détail quand l'écriture échoue", async () => {
    vi.spyOn(repo, 'createAsset').mockRejectedValue(new Error('Notion 500 secret-detail'));
    const res = await createAssetWith(repo, manualAsset, NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/réessaie/) });
    expect(JSON.stringify(res)).not.toContain('secret-detail');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('updateAssetWith', () => {
  it('modifie les champs fournis et laisse le reste', async () => {
    const res = await updateAssetWith(repo, 'lcl', { name: 'LCL principal', fixedMonthly: 20 }, NOW);
    expect(res).toEqual({ ok: true });
    const a = (await repo.listAssets()).find((x) => x.id === 'lcl')!;
    expect(a).toMatchObject({ name: 'LCL principal', fixedMonthly: 20, institution: 'LCL', currency: 'EUR', manualValue: 4_200 });
  });

  it("refuse un id inconnu sans rien écrire (id d'une autre page Notion)", async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await updateAssetWith(repo, 'page-etrangere', { name: 'Pirate' }, NOW)).toEqual({ ok: false, error: 'Actif introuvable' });
    expect(await updateAssetWith(repo, '', { name: 'Pirate' }, NOW)).toEqual({ ok: false, error: 'Actif introuvable' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('un null efface un champ optionnel', async () => {
    await updateAssetWith(repo, 'per', { fixedMonthly: null }, NOW);
    expect((await repo.listAssets()).find((x) => x.id === 'per')!.fixedMonthly).toBeUndefined();
  });

  it('refuse d’effacer un champ obligatoire', async () => {
    const res = await updateAssetWith(repo, 'lcl', { name: null }, NOW);
    expect(res.ok).toBe(false);
    expect((await repo.listAssets()).find((x) => x.id === 'lcl')!.name).toBe('Compte de dépôts (LCL)');
  });

  it('valide l’ensemble : passer en Auto sans identifiant est refusé', async () => {
    const res = await updateAssetWith(repo, 'lcl', { mode: 'auto' }, NOW);
    expect(res.ok).toBe(false);
    expect((await repo.listAssets()).find((x) => x.id === 'lcl')!.mode).toBe('manual');
  });

  it('passer en Auto avec identifiant est accepté', async () => {
    expect(await updateAssetWith(repo, 'lcl', { mode: 'auto', quoteId: 'IWDA.AS' }, NOW)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((x) => x.id === 'lcl')).toMatchObject({ mode: 'auto', quoteId: 'IWDA.AS' });
  });

  it("garde la devise de l'actif : une valeur MAD modifiée reste en MAD", async () => {
    await updateAssetWith(repo, 'dar-sakan', { manualValue: 1_300_000, manualValueDate: '2026-11-04' }, NOW);
    expect((await repo.listAssets()).find((x) => x.id === 'dar-sakan')).toMatchObject({ currency: 'MAD', manualValue: 1_300_000, manualValueDate: '2026-11-04' });
  });

  it('refuse les valeurs invalides sans rien écrire', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    for (const patch of [{ manualValue: -3 }, { currency: 'GBP' }, { assetClass: 'Voitures' }, { name: 'x'.repeat(201) }, { manualValueDate: '2026-13-01' }]) {
      expect((await updateAssetWith(repo, 'lcl', patch, NOW)).ok).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('ne transmet jamais de champ hors saisie (valeur €, quantité…)', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    await updateAssetWith(repo, 'lcl', { name: 'Nouveau', valueEur: 1, quantity: 9, id: 'autre' }, NOW);
    expect(spy).toHaveBeenCalledWith('lcl', { name: 'Nouveau' });
  });

  it('refuse un archivage par la modification (seul « Archiver » archive, avec la garde Stratégie)', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    for (const archived of [true, false]) {
      expect(await updateAssetWith(repo, 'hsbc', { archived }, NOW)).toEqual({
        ok: false, error: 'Pour archiver un actif, utilise le bouton « Archiver ».',
      });
    }
    expect(await updateAssetWith(repo, 'lcl', { name: 'Nouveau', archived: true }, NOW)).toMatchObject({ ok: false });
    expect(spy).not.toHaveBeenCalled();
    expect((await repo.listAssets()).find((a) => a.id === 'hsbc')!.archived).toBe(false);
  });

  it.each([
    ['or', 'Fonds & ETF'], ['ag', 'Autres'], ['epargne', 'Comptes courants'], ['hsbc', 'Crypto'], ['syla', 'Autres'],
  ])('refuse de changer la classe de %s, utilisé par la Stratégie', async (id, assetClass) => {
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await updateAssetWith(repo, id, { assetClass }, NOW)).toEqual({
      ok: false, error: 'Cet actif est utilisé par ta Stratégie : change-le d’abord dans Stratégie avant de changer sa classe.',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('un actif utilisé par la Stratégie reste modifiable sans changer de classe (classe identique comprise)', async () => {
    expect(await updateAssetWith(repo, 'hsbc', { name: 'HSBC Global', assetClass: 'Fonds & ETF' }, NOW)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((a) => a.id === 'hsbc')).toMatchObject({ name: 'HSBC Global', assetClass: 'Fonds & ETF' });
  });

  it('un actif hors Stratégie peut changer de classe', async () => {
    expect(await updateAssetWith(repo, 'kunto', { assetClass: 'Autres' }, NOW)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((a) => a.id === 'kunto')!.assetClass).toBe('Autres');
  });

  it("erreur générique et journalisation si Notion échoue", async () => {
    vi.spyOn(repo, 'updateAsset').mockRejectedValue(new Error('boom-detail'));
    const res = await updateAssetWith(repo, 'lcl', { name: 'Nouveau' }, NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/réessaie/) });
    expect(JSON.stringify(res)).not.toContain('boom-detail');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('archiveAssetWith', () => {
  it('archive puis désarchive un actif', async () => {
    expect(await archiveAssetWith(repo, 'lcl', true)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((a) => a.id === 'lcl')!.archived).toBe(true);
    expect(await archiveAssetWith(repo, 'lcl', false)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((a) => a.id === 'lcl')!.archived).toBe(false);
  });

  it('refuse un id inconnu ou un booléen invalide sans rien écrire', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await archiveAssetWith(repo, 'inconnu', true)).toEqual({ ok: false, error: 'Actif introuvable' });
    expect((await archiveAssetWith(repo, 'lcl', 'oui')).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('addMovementWith', () => {
  const buy = { assetId: 'etf-revolut', kind: 'buy', date: '2026-11-03', quantity: 2.5, amount: 250 } as const;

  it('crée un achat avec libellé par défaut « Achat <date> »', async () => {
    const before = (await repo.listMovements()).length;
    const res = await addMovementWith(repo, buy, NOW);
    expect(res.ok).toBe(true);
    const created = (await repo.listMovements()).slice(before);
    expect(created).toEqual([expect.objectContaining({ assetId: 'etf-revolut', kind: 'buy', label: 'Achat 2026-11-03', date: '2026-11-03', quantity: 2.5, amount: 250 })]);
  });

  it('libellé « Vente <date> » pour une vente, ou le libellé fourni', async () => {
    await addMovementWith(repo, { ...buy, kind: 'sell' }, NOW);
    await addMovementWith(repo, { ...buy, label: '  Mon achat  ', nature: 'Part' }, NOW);
    const all = await repo.listMovements();
    expect(all.at(-2)).toMatchObject({ kind: 'sell', label: 'Vente 2026-11-03' });
    expect(all.at(-1)).toMatchObject({ kind: 'buy', label: 'Mon achat', nature: 'Part' });
  });

  it("garde le montant dans la devise de l'actif (MAD non converti)", async () => {
    await addMovementWith(repo, { assetId: 'dar-sakan', kind: 'buy', date: '2026-11-03', quantity: 0, amount: 10_000.456 }, NOW);
    expect((await repo.listMovements()).at(-1)).toMatchObject({ assetId: 'dar-sakan', amount: 10_000.46 });
  });

  it('date du jour (Paris) par défaut', async () => {
    const { date: _d, ...noDate } = buy;
    void _d;
    await addMovementWith(repo, noDate, NOW);
    expect((await repo.listMovements()).at(-1)!.date).toBe('2026-11-05');
  });

  it('un métal sans poids fin (0 ou absent) est refusé', async () => {
    const before = (await repo.listMovements()).length;
    const gold = { assetId: 'or', kind: 'buy', date: '2026-11-03', amount: 500 };
    expect((await addMovementWith(repo, { ...gold, quantity: 0 }, NOW)).ok).toBe(false);
    expect((await addMovementWith(repo, gold, NOW)).ok).toBe(false);
    expect((await repo.listMovements()).length).toBe(before);
    expect((await addMovementWith(repo, { ...gold, quantity: 3.11 }, NOW)).ok).toBe(true);
  });

  it('refuse un actif inconnu ou archivé', async () => {
    await archiveAssetWith(repo, 'lcl', true);
    const before = (await repo.listMovements()).length;
    expect(await addMovementWith(repo, { ...buy, assetId: 'inconnu' }, NOW)).toEqual({ ok: false, error: 'Actif introuvable' });
    expect((await addMovementWith(repo, { ...buy, assetId: 'lcl' }, NOW)).ok).toBe(false);
    expect((await repo.listMovements()).length).toBe(before);
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['type invalide', { kind: 'gift' }],
    ['date inexistante', { date: '2026-02-30' }],
    ['date mal formée', { date: '03/11/2026' }],
    ['montant nul', { amount: 0 }],
    ['montant négatif', { amount: -5 }],
    ['montant non fini', { amount: Number.POSITIVE_INFINITY }],
    ['montant > 1 000 000 000', { amount: 1_000_000_001 }],
    ['quantité négative', { quantity: -1 }],
    ['quantité non finie', { quantity: Number.NaN }],
    ['libellé de plus de 200 caractères', { label: 'x'.repeat(201) }],
  ];
  it.each(rejected)('refuse : %s', async (_label, override) => {
    const before = (await repo.listMovements()).length;
    const res = await addMovementWith(repo, { ...buy, ...override }, NOW);
    expect(res.ok).toBe(false);
    expect((await repo.listMovements()).length).toBe(before);
  });

  it("erreur générique et journalisation si Notion échoue", async () => {
    vi.spyOn(repo, 'createMovement').mockRejectedValue(new Error('detail-interne'));
    const res = await addMovementWith(repo, buy, NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/réessaie/) });
    expect(JSON.stringify(res)).not.toContain('detail-interne');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('crédits', () => {
  const credit = { name: 'Prêt auto', type: 'Crédit consommation', currency: 'EUR', outstanding: 12_000, rate: 3.9, monthly: 250, endDate: '2029-06-30', financedAssetId: 'lcl' } as const;

  it('crée un crédit complet', async () => {
    const res = await createDebtWith(repo, credit);
    expect(res.ok).toBe(true);
    const d = (await repo.listDebts()).find((x) => x.id === (res as { id: string }).id)!;
    expect(d).toMatchObject({ name: 'Prêt auto', type: 'Crédit consommation', outstanding: 12_000, rate: 3.9, monthly: 250, endDate: '2029-06-30', financedAssetId: 'lcl' });
  });

  it('un crédit en MAD garde son capital en MAD', async () => {
    const res = await createDebtWith(repo, { name: 'Prêt Maroc', currency: 'MAD', outstanding: 300_000 });
    expect((await repo.listDebts()).find((x) => x.id === (res as { id: string }).id)).toMatchObject({ currency: 'MAD', outstanding: 300_000 });
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['nom vide', { name: ' ' }],
    ['nom trop long', { name: 'x'.repeat(201) }],
    ['type hors liste', { type: 'Prêt de poche' }],
    ['devise inconnue', { currency: 'GBP' }],
    ['capital négatif', { outstanding: -1 }],
    ['capital non fini', { outstanding: Number.NaN }],
    ['capital > 1 000 000 000', { outstanding: 1_000_000_001 }],
    ['taux négatif', { rate: -1 }],
    ['taux > 100', { rate: 101 }],
    ['mensualité négative', { monthly: -1 }],
    ['date de fin inexistante', { endDate: '2029-02-30' }],
    ['actif financé inconnu', { financedAssetId: 'page-etrangere' }],
  ];
  it.each(rejected)('refuse : %s, sans rien écrire', async (_label, override) => {
    const before = (await repo.listDebts()).length;
    const res = await createDebtWith(repo, { ...credit, ...override });
    expect(res.ok).toBe(false);
    expect((await repo.listDebts()).length).toBe(before);
  });

  it('modifie un crédit existant et efface un champ avec null', async () => {
    expect(await updateDebtWith(repo, 'credit-dar-sakan', { outstanding: 590_000, monthly: 3_000, financedAssetId: null })).toEqual({ ok: true });
    const d = (await repo.listDebts()).find((x) => x.id === 'credit-dar-sakan')!;
    expect(d).toMatchObject({ outstanding: 590_000, monthly: 3_000, currency: 'MAD' });
    expect(d.financedAssetId).toBeUndefined();
  });

  it('refuse de modifier ou supprimer un id inconnu sans rien écrire', async () => {
    const upd = vi.spyOn(repo, 'updateDebt');
    const del = vi.spyOn(repo, 'deleteDebt');
    expect(await updateDebtWith(repo, 'lcl', { outstanding: 1 })).toEqual({ ok: false, error: 'Crédit introuvable' });
    expect(await deleteDebtWith(repo, 'lcl')).toEqual({ ok: false, error: 'Crédit introuvable' });
    expect(await deleteDebtWith(repo, 42)).toEqual({ ok: false, error: 'Crédit introuvable' });
    expect(upd).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('refuse un patch invalide sans rien écrire', async () => {
    const upd = vi.spyOn(repo, 'updateDebt');
    for (const patch of [{ outstanding: -5 }, { type: 'Autre chose' }, { financedAssetId: 'inconnu' }, { name: null }]) {
      expect((await updateDebtWith(repo, 'credit-dar-sakan', patch)).ok).toBe(false);
    }
    expect(upd).not.toHaveBeenCalled();
  });

  it('supprime un crédit existant', async () => {
    expect(await deleteDebtWith(repo, 'credit-dar-sakan')).toEqual({ ok: true });
    expect(await repo.listDebts()).toHaveLength(0);
  });

  it('erreur générique et journalisation si Notion échoue', async () => {
    vi.spyOn(repo, 'deleteDebt').mockRejectedValue(new Error('zut-detail'));
    const res = await deleteDebtWith(repo, 'credit-dar-sakan');
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/réessaie/) });
    expect(JSON.stringify(res)).not.toContain('zut-detail');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('correctifs — quantité d’un mouvement (pas d’arrondi au centime)', () => {
  const base = { assetId: 'crypto', kind: 'buy', date: '2026-11-03', amount: 50 } as const;

  it('conserve une quantité de crypto de 0,00012', async () => {
    expect((await addMovementWith(repo, { ...base, quantity: 0.00012 }, NOW)).ok).toBe(true);
    expect((await repo.listMovements()).at(-1)!.quantity).toBe(0.00012);
  });

  it('conserve un poids fin de métal à trois décimales', async () => {
    expect((await addMovementWith(repo, { assetId: 'or', kind: 'buy', date: '2026-11-03', amount: 400, quantity: 3.125 }, NOW)).ok).toBe(true);
    expect((await repo.listMovements()).at(-1)!.quantity).toBe(3.125);
  });

  it('arrondit à 8 décimales au plus', async () => {
    await addMovementWith(repo, { ...base, quantity: 0.123456789123 }, NOW);
    expect((await repo.listMovements()).at(-1)!.quantity).toBe(0.12345679);
  });

  it('un métal à 0,004 g reste strictement positif (non tronqué à 0)', async () => {
    expect((await addMovementWith(repo, { assetId: 'or', kind: 'buy', date: '2026-11-03', amount: 1, quantity: 0.004 }, NOW)).ok).toBe(true);
    expect((await repo.listMovements()).at(-1)!.quantity).toBe(0.004);
  });

  it.each([['NaN', Number.NaN], ['négative', -0.5], ['> 1 000 000 000', 1_000_000_001], ['infinie', Number.POSITIVE_INFINITY]])(
    'refuse une quantité %s sans rien écrire', async (_l, quantity) => {
      const before = (await repo.listMovements()).length;
      expect((await addMovementWith(repo, { ...base, quantity }, NOW)).ok).toBe(false);
      expect((await repo.listMovements()).length).toBe(before);
    },
  );
});

describe('correctifs — archivage d’un actif utilisé par la Stratégie', () => {
  const MSG = 'Cet actif est utilisé par ta Stratégie : change-le d’abord dans Stratégie.';

  it.each([['or'], ['ag'], ['epargne'], ['per'], ['syla']])(
    'refuse d’archiver %s (référencé par la Stratégie) sans rien écrire', async (id) => {
      const spy = vi.spyOn(repo, 'updateAsset');
      expect(await archiveAssetWith(repo, id, true)).toEqual({ ok: false, error: MSG });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('archive un actif non référencé', async () => {
    expect(await archiveAssetWith(repo, 'lcl', true)).toEqual({ ok: true });
  });

  it('ne bloque jamais le désarchivage', async () => {
    await repo.updateAsset('or', { archived: true });
    expect(await archiveAssetWith(repo, 'or', false)).toEqual({ ok: true });
    expect((await repo.listAssets()).find((a) => a.id === 'or')!.archived).toBe(false);
  });
});

describe('correctifs — modification d’un actif', () => {
  it('refuse de changer la devise (les montants seraient réinterprétés), sans rien écrire', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    const res = await updateAssetWith(repo, 'dar-sakan', { currency: 'EUR' }, NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/devise/i) });
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepte une devise identique sans l’écrire', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await updateAssetWith(repo, 'dar-sakan', { currency: 'MAD', name: 'Dar Sakan 2' }, NOW)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith('dar-sakan', { name: 'Dar Sakan 2' });
  });

  it('une valeur manuelle modifiée sans date reçoit la date du jour (Paris)', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await updateAssetWith(repo, 'lcl', { manualValue: 5000 }, NOW)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith('lcl', { manualValue: 5000, manualValueDate: '2026-11-05' });
  });

  it('une valeur modifiée avec sa date garde la date fournie', async () => {
    const spy = vi.spyOn(repo, 'updateAsset');
    await updateAssetWith(repo, 'lcl', { manualValue: 5000, manualValueDate: '2026-11-01' }, NOW);
    expect(spy).toHaveBeenCalledWith('lcl', { manualValue: 5000, manualValueDate: '2026-11-01' });
  });

  it('renommer un ancien actif manuel sans valeur n’est pas bloqué (et n’écrit que le nom)', async () => {
    const id = await repo.createAsset({ name: 'Vieux', assetClass: 'Autres', currency: 'EUR', mode: 'manual' });
    const spy = vi.spyOn(repo, 'updateAsset');
    expect(await updateAssetWith(repo, id, { name: 'Nouveau nom' }, NOW)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(id, { name: 'Nouveau nom' });
  });

  it('garde les règles croisées quand le mode, la cotation ou la classe sont modifiés', async () => {
    const id = await repo.createAsset({ name: 'Vieux', assetClass: 'Autres', currency: 'EUR', mode: 'manual' });
    expect((await updateAssetWith(repo, id, { mode: 'auto' }, NOW)).ok).toBe(false);
    expect((await updateAssetWith(repo, 'or', { quoteId: 'bitcoin' }, NOW)).ok).toBe(false);
    expect((await updateAssetWith(repo, 'etf-revolut', { assetClass: 'Métaux précieux' }, NOW)).ok).toBe(false);
  });
});

describe('correctifs — devise d’un crédit', () => {
  it('refuse de changer la devise d’un crédit sans rien écrire', async () => {
    const spy = vi.spyOn(repo, 'updateDebt');
    expect(await updateDebtWith(repo, 'credit-dar-sakan', { currency: 'EUR' })).toEqual({ ok: false, error: expect.stringMatching(/devise/i) });
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepte une devise identique sans l’écrire', async () => {
    const spy = vi.spyOn(repo, 'updateDebt');
    expect(await updateDebtWith(repo, 'credit-dar-sakan', { currency: 'MAD', monthly: 10 })).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith('credit-dar-sakan', { monthly: 10 });
  });
});
