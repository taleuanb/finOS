import { describe, expect, it, vi } from 'vitest';
import { Client } from '@notionhq/client';
import assetEtf from './__fixtures__/asset-etf.json';
import assetManual from './__fixtures__/asset-manual-no-currency.json';
import snapshot from './__fixtures__/snapshot.json';
import strategyRows from './__fixtures__/strategy-rows.json';
import { createNotionRepo, type Limit, type NotionClientLike } from './notionRepo';
import { DB } from './schema';
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

describe('compatibilité avec le vrai client', () => {
  it('Client de @notionhq/client est assignable à NotionClientLike (vérifié par tsc)', () => {
    const real = new Client({ auth: 'secret-test' });
    const asLike: NotionClientLike = real;
    expect(typeof asLike.dataSources.query).toBe('function');
    expect(typeof createNotionRepo(real, ids).listAssets).toBe('function');
  });
});
