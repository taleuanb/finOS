import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@notionhq/client';
import assetEtf from './__fixtures__/asset-etf.json';
import debtFixture from './__fixtures__/debt.json';
import budgetFixture from './__fixtures__/budget-line.json';
import planFixture from './__fixtures__/plan-line.json';
import movementFixture from './__fixtures__/movement.json';
import assetManual from './__fixtures__/asset-manual-no-currency.json';
import snapshot from './__fixtures__/snapshot.json';
import strategyRows from './__fixtures__/strategy-rows.json';
import { pageToAsset, pageToMovement } from './mappers';
import { createNotionRepo, type Limit, type NotionClientLike } from './notionRepo';
import { DB, P } from './schema';
import type { Snapshot } from '@/domain/types';

const ids = Object.fromEntries(Object.keys(DB).map((k) => [k, `ds-${k}`])) as Record<keyof typeof DB, string>;

type Q = { data_source_id: string; start_cursor?: string; filter?: unknown; sorts?: unknown };
type Create = { parent: unknown; properties: Record<string, unknown> };
type Update = { page_id: string; properties?: Record<string, unknown>; in_trash?: boolean };

function fakeClient(pages: Record<string, unknown[][]> = {}) {
  const queries: Q[] = [];
  const creates: Create[] = [];
  const updates: Update[] = [];
  const client: NotionClientLike = {
    dataSources: {
      query: vi.fn(async (args: Q) => {
        queries.push(args);
        const batches = pages[args.data_source_id] ?? [[]];
        const idx = args.start_cursor ? Number(args.start_cursor) : 0;
        const more = idx < batches.length - 1;
        return { results: batches[idx] ?? [], has_more: more, next_cursor: more ? String(idx + 1) : null };
      }),
    },
    pages: {
      create: vi.fn(async (args) => { creates.push(args as Create); return { id: `new-${creates.length}` }; }),
      update: vi.fn(async (args) => { updates.push(args as Update); return {}; }),
    },
  };
  return { client, queries, creates, updates };
}

const snap: Snapshot = {
  date: '2026-10-24', totalAssetsEur: 1, totalDebtsEur: 0, netEur: 1,
  byClass: { 'Immobilier': 0, 'Autres': 0, 'Fonds & ETF': 1, 'PER': 0, 'Épargne': 0, 'Crypto': 0, 'Comptes courants': 0, 'Startups': 0, 'Métaux précieux': 0, 'Noms de domaine': 0 },
  goldSilverRatio: null, eurMad: 10.85, eurUsd: 1.08, partial: false,
};

describe('createNotionRepo', () => {
  it('listAssets suit la pagination (has_more / next_cursor)', async () => {
    const { client, queries } = fakeClient({ 'ds-assets': [[assetEtf], [assetManual]] });
    const assets = await createNotionRepo(client, ids).listAssets();
    expect(assets.map((a) => a.name)).toEqual(['iShares Core S&P 500', 'Terrain Agadir']);
    expect(queries).toHaveLength(2);
    expect(queries[0].start_cursor).toBeUndefined();
    expect(queries[1].start_cursor).toBe('1');
  });

  it('enveloppe chaque appel Notion dans limit', async () => {
    const { client } = fakeClient({ 'ds-assets': [[assetEtf], [assetManual]] });
    const spy = vi.fn((fn: () => Promise<unknown>) => fn());
    const limit = spy as unknown as Limit;
    const repo = createNotionRepo(client, ids, limit);
    await repo.listAssets();
    expect(spy).toHaveBeenCalledTimes(2);
    await repo.setMovementSpot('m1', 5);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('ignore les résultats partiels sans propriétés', async () => {
    const { client } = fakeClient({ 'ds-assets': [[{ object: 'page', id: 'p' }, assetEtf]] });
    expect(await createNotionRepo(client, ids).listAssets()).toHaveLength(1);
  });

  it('getStrategy lit la base Stratégie', async () => {
    const { client } = fakeClient({ 'ds-strategy': [strategyRows] });
    const s = await createNotionRepo(client, ids).getStrategy();
    expect(s.targets.Crypto).toBe(0.1);
  });

  it('upsertSnapshot met à jour la page dont le titre est cette date', async () => {
    const { client, queries, creates, updates } = fakeClient({ 'ds-history': [[snapshot]] });
    await createNotionRepo(client, ids).upsertSnapshot(snap);
    expect(queries[0].filter).toEqual({ property: 'Nom', title: { equals: '2026-10-24' } });
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].page_id).toBe('h2222222-0000-4000-8000-000000000001');
    expect(updates[0].properties?.['Patrimoine net €']).toEqual({ number: 1 });
  });

  it("upsertSnapshot crée la page quand la date n'existe pas", async () => {
    const { client, creates, updates } = fakeClient({ 'ds-history': [[]] });
    await createNotionRepo(client, ids).upsertSnapshot(snap);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(1);
    expect(creates[0].parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-history' });
    expect(creates[0].properties['Nom']).toEqual({ title: [{ text: { content: '2026-10-24' } }] });
  });

  it('listSnapshots filtre depuis sinceDate et trie par date', async () => {
    const older = structuredClone(snapshot);
    (older.properties['Nom'].title[0] as { plain_text: string }).plain_text = '2026-09-01';
    const { client, queries } = fakeClient({ 'ds-history': [[snapshot, older]] });
    const rows = await createNotionRepo(client, ids).listSnapshots('2026-09-01');
    expect(rows.map((s) => s.date)).toEqual(['2026-09-01', '2026-10-24']);
    expect(queries[0].filter).toEqual({ property: 'Date', date: { on_or_after: '2026-09-01' } });
  });

  it('updateAssetValuation et setMovementSpot écrivent sur la bonne page', async () => {
    const { client, updates } = fakeClient();
    const repo = createNotionRepo(client, ids);
    await repo.updateAssetValuation('a1', { unitPrice: 2, value: 10, valueEur: 9, syncStatus: 'OK', lastUpdate: '2026-10-25' });
    await repo.setMovementSpot('m1', 88450);
    expect(updates[0]).toMatchObject({ page_id: 'a1', properties: { 'Cours unitaire': { number: 2 }, 'Valeur €': { number: 9 } } });
    expect(updates[1]).toMatchObject({ page_id: 'm1', properties: { 'Cours spot jour J': { number: 88450 } } });
  });

  it("createMovement crée dans Mouvements et renvoie l'id", async () => {
    const { client, creates } = fakeClient();
    const id = await createNotionRepo(client, ids).createMovement({ label: 'x', date: '2026-11-03', assetId: 'or', kind: 'buy', quantity: 1, amount: 330 });
    expect(id).toBe('new-1');
    expect(creates[0].parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-movements' });
    expect(creates[0].properties['Actif']).toEqual({ relation: [{ id: 'or' }] });
  });

  it('upsertBudgetLine : update avec id, create sans ; deleteBudgetLine met à la corbeille', async () => {
    const { client, creates, updates } = fakeClient();
    const repo = createNotionRepo(client, ids);
    const line = { name: 'Loyer', section: 'depense' as const, category: 'Logement', monthlyAmount: 850, currency: 'EUR' as const, order: 1 };
    expect(await repo.upsertBudgetLine({ ...line, id: 'b1' })).toBe('b1');
    expect(await repo.upsertBudgetLine(line)).toBe('new-1');
    await repo.deleteBudgetLine('b1');
    expect(updates[0].page_id).toBe('b1');
    expect(creates).toHaveLength(1);
    expect(updates[1]).toMatchObject({ page_id: 'b1', in_trash: true });
  });

  it('createPlanLines crée une page par ligne', async () => {
    const { client, creates } = fakeClient();
    await createNotionRepo(client, ids).createPlanLines([
      { month: '2026-11', assetId: 'a1', amount: 100, origin: 'fixe' },
      { month: '2026-11', assetId: 'a2', amount: 50, origin: 'cible' },
    ]);
    expect(creates).toHaveLength(2);
    expect(creates[1].properties['Origine']).toEqual({ select: { name: 'Cible' } });
  });
});

describe('écriture : actifs, crédits, Stratégie', () => {
  it('createAsset crée dans Actifs avec les propriétés d\'entrée seulement et renvoie l\'id', async () => {
    const { client, creates } = fakeClient();
    const id = await createNotionRepo(client, ids).createAsset({
      name: 'Livret', assetClass: 'Épargne', currency: 'MAD', mode: 'manual', manualValue: 1000, manualValueDate: '2026-10-25', institution: 'LCL', subtype: 'Livret',
    });
    expect(id).toBe('new-1');
    expect(creates[0].parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-assets' });
    expect(creates[0].properties['Valeur manuelle']).toEqual({ number: 1000 });
    expect(creates[0].properties['Établissement']).toEqual({ select: { name: 'LCL' } });
    expect(creates[0].properties).not.toHaveProperty('Quantité');
    expect(creates[0].properties).not.toHaveProperty('Valeur €');
  });
  it("updateAsset n'écrit que le patch (null efface) sur la bonne page", async () => {
    const { client, updates } = fakeClient();
    await createNotionRepo(client, ids).updateAsset('a1', { manualValue: 5, institution: null, archived: true });
    expect(updates).toEqual([{ page_id: 'a1', properties: {
      'Valeur manuelle': { number: 5 }, 'Établissement': { select: null }, 'Archivé': { checkbox: true },
    } }]);
  });
  it('createDebt / updateDebt écrivent dans Dettes ; deleteDebt met en corbeille', async () => {
    const { client, creates, updates } = fakeClient();
    const repo = createNotionRepo(client, ids);
    const id = await repo.createDebt({ name: 'Crédit', currency: 'EUR', outstanding: 100, financedAssetId: 'a1' });
    await repo.updateDebt('d1', { outstanding: 90, financedAssetId: null });
    await repo.deleteDebt('d1');
    expect(id).toBe('new-1');
    expect(creates[0].parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-debts' });
    expect(creates[0].properties['Actif financé']).toEqual({ relation: [{ id: 'a1' }] });
    expect(updates[0]).toEqual({ page_id: 'd1', properties: { 'Capital restant dû': { number: 90 }, 'Actif financé': { relation: [] } } });
    expect(updates[1]).toEqual({ page_id: 'd1', in_trash: true });
  });
  it('setStrategyEntry met à jour la clé existante au lieu de créer', async () => {
    const { client, queries, creates, updates } = fakeClient({ 'ds-strategy': [strategyRows] });
    await createNotionRepo(client, ids).setStrategyEntry({ key: 'cible:Crypto', value: 15 });
    expect(queries[0].filter).toEqual({ property: 'Clé', title: { equals: 'cible:Crypto' } });
    expect(creates).toHaveLength(0);
    expect(updates).toEqual([{ page_id: 's0000000-0000-4000-8000-000000000001', properties: { 'Valeur': { number: 15 } } }]);
  });
  it("setStrategyEntry crée la ligne quand la clé n'existe pas", async () => {
    const { client, creates, updates } = fakeClient({ 'ds-strategy': [[]] });
    await createNotionRepo(client, ids).setStrategyEntry({ key: 'devise_affichage', text: 'MAD' });
    expect(updates).toHaveLength(0);
    expect(creates[0].parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-strategy' });
    expect(creates[0].properties).toEqual({
      'Clé': { title: [{ text: { content: 'devise_affichage' } }] }, 'Texte': { rich_text: [{ text: { content: 'MAD' } }] },
    });
  });
  it('deleteStrategyEntry met la page en corbeille, sans effet si la clé est absente', async () => {
    const hit = fakeClient({ 'ds-strategy': [strategyRows] });
    await createNotionRepo(hit.client, ids).deleteStrategyEntry('actif:or');
    expect(hit.updates).toEqual([{ page_id: 's0000000-0000-4000-8000-000000000003', in_trash: true }]);
    const miss = fakeClient({ 'ds-strategy': [[]] });
    await createNotionRepo(miss.client, ids).deleteStrategyEntry('inconnue');
    expect(miss.updates).toHaveLength(0);
    expect(miss.creates).toHaveLength(0);
  });
  it('les requêtes de clé filtrent côté Notion (pas de lecture de toute la base)', async () => {
    const { client, queries } = fakeClient({ 'ds-strategy': [[]] });
    await createNotionRepo(client, ids).deleteStrategyEntry('x');
    expect(queries).toHaveLength(1);
    expect(queries[0].filter).toEqual({ property: 'Clé', title: { equals: 'x' } });
  });
  it("n'appelle pas pages.update quand il n'y a rien à écrire", async () => {
    const { client, updates } = fakeClient({ 'ds-strategy': [strategyRows] });
    const repo = createNotionRepo(client, ids);
    await repo.updateAsset('a1', {});
    await repo.updateAsset('a1', { manualValue: undefined });
    await repo.updateAsset('a1', { name: null });
    await repo.updateDebt('d1', {});
    await repo.setStrategyEntry({ key: 'cible:Crypto' });
    expect(updates).toHaveLength(0);
  });
  it('rogne la clé Stratégie une seule fois (requête, comparaison et titre créé)', async () => {
    const hit = fakeClient({ 'ds-strategy': [strategyRows] });
    await createNotionRepo(hit.client, ids).setStrategyEntry({ key: '  actif:or ', assetId: null });
    expect(hit.queries[0].filter).toEqual({ property: 'Clé', title: { equals: 'actif:or' } });
    expect(hit.updates).toEqual([{ page_id: 's0000000-0000-4000-8000-000000000003', properties: { 'Actif': { relation: [] } } }]);
    const miss = fakeClient({ 'ds-strategy': [[]] });
    await createNotionRepo(miss.client, ids).setStrategyEntry({ key: ' nouvelle ', value: 1 });
    expect(miss.queries[0].filter).toEqual({ property: 'Clé', title: { equals: 'nouvelle' } });
    expect(miss.creates[0].properties['Clé']).toEqual({ title: [{ text: { content: 'nouvelle' } }] });
    const del = fakeClient({ 'ds-strategy': [strategyRows] });
    await createNotionRepo(del.client, ids).deleteStrategyEntry(' actif:or ');
    expect(del.queries[0].filter).toEqual({ property: 'Clé', title: { equals: 'actif:or' } });
    expect(del.updates).toEqual([{ page_id: 's0000000-0000-4000-8000-000000000003', in_trash: true }]);
  });
  it('toutes les écritures passent par limit', async () => {
    const { client } = fakeClient({ 'ds-strategy': [[]] });
    const spy = vi.fn((fn: () => Promise<unknown>) => fn());
    const repo = createNotionRepo(client, ids, spy as unknown as Limit);
    await repo.createAsset({ name: 'a', assetClass: 'Autres', currency: 'EUR', mode: 'manual' });
    await repo.updateAsset('a', { name: 'b' });
    await repo.createDebt({ name: 'd', currency: 'EUR', outstanding: 1 });
    await repo.updateDebt('d', { outstanding: 2 });
    await repo.deleteDebt('d');
    await repo.setStrategyEntry({ key: 'k', value: 1 }); // requête + création
    expect(spy).toHaveBeenCalledTimes(7);
  });
});

/** Faux client qui connaît le schéma des bases et applique `filter_properties` (identifiants) comme Notion. */
function schemaClient(pages: Record<string, unknown[]>, schema: Record<string, Record<string, { id: string; type: string }>>, opts: { retrieveFails?: boolean } = {}) {
  const queries: (Q & { filter_properties?: string[] })[] = [];
  const retrieve = vi.fn(async (args: { data_source_id: string }) => {
    if (opts.retrieveFails) throw new Error('Notion indisponible');
    return { properties: schema[args.data_source_id] };
  });
  const client: NotionClientLike = {
    dataSources: {
      query: vi.fn(async (args: Q & { filter_properties?: string[] }) => {
        queries.push(args);
        const defs = schema[args.data_source_id] ?? {};
        const known = new Set(Object.values(defs).map((d) => d.id));
        // Comme Notion : un identifiant de propriété inconnu est une erreur de validation (400).
        if (args.filter_properties?.some((id) => !known.has(id))) throw Object.assign(new Error('validation_error'), { status: 400 });
        const keep = args.filter_properties ? new Set(args.filter_properties) : null;
        const results = (pages[args.data_source_id] ?? []).map((raw) => {
          const page = raw as { id: string; properties: Record<string, unknown> };
          if (!keep) return page;
          const properties = Object.fromEntries(Object.entries(page.properties).filter(([name]) => defs[name] && keep.has(defs[name].id)));
          return { ...page, properties };
        });
        return { results, has_more: false, next_cursor: null };
      }),
      retrieve,
    },
    pages: { create: vi.fn(async () => ({ id: 'x' })), update: vi.fn(async () => ({})) },
  };
  return { client, queries, retrieve };
}

const schemaOf = (page: { properties: Record<string, { type: string }> }) =>
  Object.fromEntries(Object.entries(page.properties).map(([name, p]) => [name, { id: `id:${name}`, type: p.type }]));

const COMPUTED_ASSET = ['Quantité', 'Prix de revient', 'Plus-value', '%', 'Mouvements'];

describe('colonnes utiles (filter_properties)', () => {
  afterEach(() => vi.restoreAllMocks());

  it("les requêtes d'actifs envoient les identifiants des colonnes lues, sans les colonnes calculées", async () => {
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    await createNotionRepo(client, ids).listAssets();
    const sent = new Set(queries[0].filter_properties);
    expect(sent.has('id:Nom')).toBe(true); // le titre est toujours demandé
    for (const name of Object.values(P.assets).filter((n) => !COMPUTED_ASSET.includes(n))) expect(sent.has(`id:${name}`), name).toBe(true);
    for (const name of COMPUTED_ASSET) expect(sent.has(`id:${name}`), name).toBe(false);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("les requêtes de mouvements excluent Quantité signée, Montant signé et Prime %", async () => {
    const withSigned = structuredClone(movementFixture) as typeof movementFixture & { properties: Record<string, unknown> };
    withSigned.properties['Quantité signée'] = { type: 'formula', formula: { type: 'number', number: 99 } };
    withSigned.properties['Montant signé'] = { type: 'formula', formula: { type: 'number', number: 99 } };
    const { client, queries } = schemaClient({ 'ds-movements': [withSigned] }, { 'ds-movements': schemaOf(withSigned as never) });
    const [m] = await createNotionRepo(client, ids).listMovements();
    const sent = new Set(queries[0].filter_properties);
    for (const name of ['Quantité signée', 'Montant signé', 'Prime %']) expect(sent.has(`id:${name}`), name).toBe(false);
    for (const name of ['Libellé', 'Date', 'Actif', 'Type', 'Nature', 'Quantité', 'Montant', 'Cours spot jour J', 'Mois du plan']) expect(sent.has(`id:${name}`), name).toBe(true);
    expect(m).toEqual(pageToMovement(movementFixture)); // les colonnes exclues ne servent à aucun champ
  });

  it("un actif lu sans les colonnes calculées garde tous ses autres champs ; quantité et prix de revient valent 0", async () => {
    const { client } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const [a] = await createNotionRepo(client, ids).listAssets();
    const full = pageToAsset(assetEtf);
    expect(full.quantity).not.toBe(0);
    expect(a).toEqual({ ...full, quantity: 0, costBasis: 0 });
  });

  it('lire avec les colonnes filtrées donne exactement la même chose que sans filtre (dettes, budget, Stratégie, plan, historique)', async () => {
    const strategyPages = strategyRows as unknown as { id: string; properties: Record<string, { type: string }> }[];
    const fixtures: Record<string, unknown[]> = {
      'ds-debts': [debtFixture], 'ds-budget': [budgetFixture], 'ds-strategy': strategyPages, 'ds-plan': [planFixture], 'ds-history': [snapshot],
    };
    const schema = Object.fromEntries(Object.entries(fixtures).map(([ds, pages]) => [ds, schemaOf(pages[0] as never)]));
    const read = (client: NotionClientLike) => {
      const repo = createNotionRepo(client, ids);
      return Promise.all([repo.listDebts(), repo.listBudget(), repo.getStrategy(), repo.listPlan(), repo.listSnapshots('2000-01-01')]);
    };
    const filtered = schemaClient(fixtures, schema);
    const unfiltered = fakeClient(Object.fromEntries(Object.entries(fixtures).map(([ds, pages]) => [ds, [pages]])));
    const out = await read(filtered.client);
    expect(out).toEqual(await read(unfiltered.client));
    expect(out[0]).toHaveLength(1);
    expect(out[4][0].byClass['Fonds & ETF']).not.toBe(0); // la fixture porte bien des valeurs à retrouver
    expect(filtered.queries).toHaveLength(5);
    for (const q of filtered.queries) expect(q.filter_properties?.length).toBeGreaterThan(1);
  });

  it("l'historique demande une colonne par propriété de P.history (titre, date, totaux, classes, taux, ratio, partiel)", async () => {
    const { client, queries } = schemaClient({ 'ds-history': [snapshot] }, { 'ds-history': schemaOf(snapshot as never) });
    await createNotionRepo(client, ids).listSnapshots();
    const sent = new Set(queries[0].filter_properties);
    const { byClass, ...simple } = P.history;
    const expected: string[] = [...Object.values(simple), ...Object.values(byClass)];
    expect(expected).toHaveLength(9 + 10); // 9 colonnes simples + 10 classes
    for (const name of expected) expect(sent.has(`id:${name}`), name).toBe(true);
  });

  it("un chargeur de schéma fourni est utilisé à la place de retrieve ; son échec donne une lecture non filtrée", async () => {
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const loader = vi.fn(async (_dsId: string) => schemaOf(assetEtf));
    const repo = createNotionRepo(client, ids, undefined, { schema: loader });
    await repo.listAssets();
    expect(loader).toHaveBeenCalledWith('ds-assets');
    expect(retrieve).not.toHaveBeenCalled();
    expect(queries[0].filter_properties).toContain('id:Nom');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = createNotionRepo(client, ids, undefined, { schema: async () => { throw new Error('cache KO'); } });
    const [a] = await failing.listAssets();
    expect(queries[1].filter_properties).toBeUndefined();
    expect(a.name).toBe(pageToAsset(assetEtf).name);
  });

  it("le schéma mémorisé par instance expire au bout d'une heure", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { client, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
      const repo = createNotionRepo(client, ids);
      await repo.listAssets();
      vi.advanceTimersByTime(59 * 60_000);
      await repo.listAssets();
      expect(retrieve).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * 60_000);
      await repo.listAssets();
      expect(retrieve).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("le schéma n'est lu qu'une fois par base (mémoïsé)", async () => {
    const { client, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const repo = createNotionRepo(client, ids);
    await repo.listAssets();
    await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("le retrieve passe par limit", async () => {
    const { client } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const spy = vi.fn((fn: () => Promise<unknown>) => fn());
    await createNotionRepo(client, ids, spy as unknown as Limit).listAssets();
    expect(spy).toHaveBeenCalledTimes(2); // retrieve + une page de résultats
  });

  it("si le schéma est illisible, lit sans filtre au lieu d'échouer (et réessaie plus tard)", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) }, { retrieveFails: true });
    const repo = createNotionRepo(client, ids);
    const [a] = await repo.listAssets();
    expect(queries[0].filter_properties).toBeUndefined();
    expect(a.quantity).toBe(pageToAsset(assetEtf).quantity); // non filtré : tout est lu
    await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it("sans retrieve dans le client : lecture non filtrée", async () => {
    const { client, queries } = fakeClient({ 'ds-assets': [[assetEtf]] });
    await createNotionRepo(client, ids).listAssets();
    expect(queries[0]).not.toHaveProperty('filter_properties');
  });
});

describe('schéma : mémo par instance, colonne absente, identifiant périmé', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('un chargeur fourni n\'est appelé qu\'une fois par base entre deux lectures, puis de nouveau après 1 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { client } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const loader = vi.fn(async (_dsId: string) => schemaOf(assetEtf));
    const repo = createNotionRepo(client, ids, undefined, { schema: loader });
    await repo.listAssets();
    await repo.listAssets();
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61 * 60_000);
    await repo.listAssets();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("un échec du chargeur n'est jamais mémorisé", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    const loader = vi.fn<(dsId: string) => Promise<ReturnType<typeof schemaOf>>>()
      .mockRejectedValueOnce(new Error('KO')).mockResolvedValue(schemaOf(assetEtf));
    const repo = createNotionRepo(client, ids, undefined, { schema: loader });
    await repo.listAssets();
    await repo.listAssets();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  const FIVE_MIN = 5 * 60_000;
  const { 'Versement fixe mensuel': _fixed, ...assetWithoutFixed } = assetEtf.properties;
  const etfNoFixed = { ...assetEtf, properties: assetWithoutFixed };
  const fullSchema = () => schemaOf(assetEtf);
  const schemaNoFixed = () => schemaOf(etfNoFixed as never);

  it("colonne optionnelle absente de la base : un rechargement forcé, puis lectures filtrées sur les colonnes existantes (jamais de retrieve à chaque lecture)", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [etfNoFixed] }, { 'ds-assets': schemaNoFixed() });
    const repo = createNotionRepo(client, ids);
    const [first] = await repo.listAssets();
    await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(2); // lecture initiale + un rechargement forcé
    for (const q of queries) {
      expect(q.filter_properties).toBeDefined();
      expect(q.filter_properties).toContain('id:Nom');
      expect(q.filter_properties).not.toContain('id:Versement fixe mensuel');
    }
    expect(consoleError).toHaveBeenCalledTimes(1); // journalisé une fois par base et par fenêtre
    // une colonne absente donne la même valeur par défaut qu'une lecture non filtrée de la même base
    const unfiltered = fakeClient({ 'ds-assets': [[etfNoFixed]] });
    expect(first).toEqual({ ...(await createNotionRepo(unfiltered.client, ids).listAssets())[0], quantity: 0, costBasis: 0 }); // hors colonnes calculées (non lues)
    expect(first.fixedMonthly).toBeUndefined();
  });

  it("des lectures en parallèle partagent un seul rechargement forcé", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, retrieve } = schemaClient({ 'ds-assets': [etfNoFixed] }, { 'ds-assets': schemaNoFixed() });
    const repo = createNotionRepo(client, ids);
    await Promise.all([repo.listAssets(), repo.listAssets(), repo.listAssets(), repo.listAssets()]);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it("après 5 min, une colonne toujours absente déclenche un nouveau rechargement ; si elle est apparue, elle est demandée", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = { 'ds-assets': schemaNoFixed() };
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, schema);
    const repo = createNotionRepo(client, ids);
    await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(FIVE_MIN - 1000);
    await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(2); // dans la fenêtre : pas de rechargement
    vi.advanceTimersByTime(2000);
    await repo.listAssets(); // fenêtre écoulée, colonne toujours absente
    expect(retrieve).toHaveBeenCalledTimes(3);
    expect(queries.at(-1)?.filter_properties).not.toContain('id:Versement fixe mensuel');
    schema['ds-assets'] = fullSchema(); // la colonne est créée
    vi.advanceTimersByTime(FIVE_MIN + 1000);
    const [a] = await repo.listAssets();
    expect(retrieve).toHaveBeenCalledTimes(4);
    expect(queries.at(-1)?.filter_properties).toContain('id:Versement fixe mensuel');
    expect(a.fixedMonthly).toBe(pageToAsset(assetEtf).fixedMonthly);
    await repo.listAssets(); // schéma complet : plus de rechargement
    expect(retrieve).toHaveBeenCalledTimes(4);
  });

  it("une colonne recréée avec un nouvel identifiant est reprise au rechargement (après la fenêtre)", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const full = fullSchema();
    const { 'Statut sync': _old, ...without } = full;
    const schema = { 'ds-assets': without };
    const { client, queries } = schemaClient({ 'ds-assets': [assetEtf] }, schema);
    const repo = createNotionRepo(client, ids);
    await repo.listAssets();
    schema['ds-assets'] = { ...without, 'Statut sync': { id: 'id:Statut sync:v2', type: 'rich_text' } };
    vi.advanceTimersByTime(FIVE_MIN + 1000);
    await repo.listAssets();
    expect(queries.at(-1)?.filter_properties).toContain('id:Statut sync:v2');
  });

  it("une requête filtrée rejetée (identifiant périmé, 400) est rejouée une fois sans filtre ; la base est lue sans filtre pendant 5 min puis de nouveau filtrée", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const full = fullSchema();
    const schema = { 'ds-assets': full };
    const { client, queries, retrieve } = schemaClient({ 'ds-assets': [assetEtf] }, schema);
    const repo = createNotionRepo(client, ids);
    await repo.listAssets(); // mémo : 'Statut sync' = id:Statut sync
    schema['ds-assets'] = { ...full, 'Statut sync': { id: 'id:Statut sync:v2', type: 'rich_text' } }; // recréée entre-temps
    const [a] = await repo.listAssets();
    expect(a.name).toBe(pageToAsset(assetEtf).name); // la lecture n'échoue pas
    expect(queries.map((q) => q.filter_properties !== undefined)).toEqual([true, true, false]);
    await repo.listAssets(); // dans la fenêtre : lecture non filtrée, sans retrieve ni double requête
    expect(queries.map((q) => q.filter_properties !== undefined)).toEqual([true, true, false, false]);
    expect(retrieve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FIVE_MIN + 1000);
    await repo.listAssets(); // fenêtre écoulée : nouveau schéma, requête filtrée valide
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(queries.at(-1)?.filter_properties).toContain('id:Statut sync:v2');
  });

  it("une erreur autre qu'un 400 n'est pas rejouée sans filtre", async () => {
    const { client, queries } = schemaClient({ 'ds-assets': [assetEtf] }, { 'ds-assets': schemaOf(assetEtf) });
    (client.dataSources.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('Notion down'), { status: 502 }));
    await expect(createNotionRepo(client, ids).listAssets()).rejects.toThrow('Notion down');
    expect(queries).toHaveLength(0);
  });
});

describe('historique borné', () => {
  afterEach(() => vi.useRealTimers());

  it('listSnapshots() sans argument ne lit que les 800 derniers jours (date de Paris)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    const { client, queries } = fakeClient({ 'ds-history': [[snapshot]] });
    await createNotionRepo(client, ids).listSnapshots();
    expect(queries[0].filter).toEqual({ property: 'Date', date: { on_or_after: '2024-08-17' } });
    expect(queries[0].sorts).toEqual([{ property: 'Date', direction: 'ascending' }]);
  });

  it('un sinceDate explicite est respecté tel quel', async () => {
    const { client, queries } = fakeClient({ 'ds-history': [[snapshot]] });
    await createNotionRepo(client, ids).listSnapshots('2020-01-01');
    expect(queries[0].filter).toEqual({ property: 'Date', date: { on_or_after: '2020-01-01' } });
  });
});

describe('compatibilité avec le vrai client', () => {
  it('Client de @notionhq/client est assignable à NotionClientLike (vérifié par tsc)', () => {
    const real = new Client({ auth: 'secret-test' });
    const asLike: NotionClientLike = real;
    expect(typeof asLike.dataSources.query).toBe('function');
    expect(typeof createNotionRepo(real, ids).listAssets).toBe('function');
  });
});
