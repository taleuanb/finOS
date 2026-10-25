import { describe, expect, it } from 'vitest';
import { FakeRepo, fixtureSeed } from './fakeRepo';
import type { Snapshot } from '@/domain/types';

const snap: Snapshot = {
  date: '2026-11-02', totalAssetsEur: 10, totalDebtsEur: 1, netEur: 9,
  byClass: {} as Snapshot['byClass'], goldSilverRatio: null, eurMad: 10.85, eurUsd: 1.08, partial: false,
};

describe('FakeRepo', () => {
  it('createMovement ajoute un mouvement et renvoie son id', async () => {
    const r = new FakeRepo(fixtureSeed);
    const id = await r.createMovement({ label: 'x', date: '2026-11-03', assetId: 'or', kind: 'buy', quantity: 1, amount: 330 });
    expect((await r.listMovements()).some((m) => m.id === id)).toBe(true);
  });
  it('upsertSnapshot remplace la ligne de même date', async () => {
    const r = new FakeRepo(fixtureSeed);
    await r.upsertSnapshot({ ...snap, date: '2026-11-03' });
    await r.upsertSnapshot({ ...snap, date: '2026-11-03', netEur: 1 });
    const rows = (await r.listSnapshots()).filter((s) => s.date === '2026-11-03');
    expect(rows).toHaveLength(1);
    expect(rows[0].netEur).toBe(1);
  });
  it('listSnapshots filtre par sinceDate et trie par date', async () => {
    const r = new FakeRepo(fixtureSeed);
    const rows = await r.listSnapshots('2026-10-01');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((s) => s.date >= '2026-10-01')).toBe(true);
    expect(rows.map((s) => s.date)).toEqual([...rows.map((s) => s.date)].sort());
  });
  it('ne mute pas fixtureSeed (état cloné)', async () => {
    const before = fixtureSeed.movements.length;
    const r = new FakeRepo(fixtureSeed);
    await r.createMovement({ label: 'y', date: '2026-11-03', assetId: 'or', kind: 'buy', quantity: 1, amount: 1 });
    await r.updateAssetValuation('or', { value: 1, valueEur: 1, syncStatus: 'ok', lastUpdate: '2026-11-03' });
    expect(fixtureSeed.movements).toHaveLength(before);
    expect(fixtureSeed.assets.find((a) => a.id === 'or')!.valueEur).not.toBe(1);
    expect(await new FakeRepo().listMovements()).toHaveLength(0);
  });
  it('updateAssetValuation, setMovementSpot et lignes de budget/plan', async () => {
    const r = new FakeRepo(fixtureSeed);
    await r.updateAssetValuation('or', { unitPrice: 125926, value: 3136, valueEur: 3136, syncStatus: 'ok', lastUpdate: '2026-11-03' });
    expect((await r.listAssets()).find((a) => a.id === 'or')).toMatchObject({ valueEur: 3136, syncStatus: 'ok', unitPrice: 125926 });
    const mid = (await r.listMovements())[0].id;
    await r.setMovementSpot(mid, 82100);
    expect((await r.listMovements()).find((m) => m.id === mid)!.spotEurPerKg).toBe(82100);
    const bid = await r.upsertBudgetLine({ name: 'Cinéma', section: 'depense', category: 'Loisirs', monthlyAmount: 20, currency: 'EUR', order: 99 });
    await r.upsertBudgetLine({ id: bid, name: 'Cinéma', section: 'depense', category: 'Loisirs', monthlyAmount: 25, currency: 'EUR', order: 99 });
    expect((await r.listBudget()).filter((l) => l.id === bid).map((l) => l.monthlyAmount)).toEqual([25]);
    await r.deleteBudgetLine(bid);
    expect((await r.listBudget()).some((l) => l.id === bid)).toBe(false);
    await r.createPlanLines([{ month: '2026-12', assetId: 'per', amount: 100, origin: 'fixe' }]);
    expect((await r.listPlan()).some((p) => p.month === '2026-12')).toBe(true);
  });
  it('les getters renvoient des copies', async () => {
    const r = new FakeRepo(fixtureSeed);
    (await r.listAssets())[0].name = 'MUTÉ';
    expect((await r.listAssets())[0].name).not.toBe('MUTÉ');
  });
  describe('écriture : actifs, crédits, Stratégie', () => {
    const input = { name: 'Livret', assetClass: 'Épargne' as const, currency: 'MAD' as const, mode: 'manual' as const, manualValue: 1000, manualValueDate: '2026-10-25' };

    it('createAsset génère un id asset-<n> et initialise les champs calculés', async () => {
      const r = new FakeRepo(fixtureSeed);
      const id = await r.createAsset(input);
      expect(id).toMatch(/^asset-\d+$/);
      expect((await r.listAssets()).find((a) => a.id === id)).toMatchObject({ ...input, quantity: 0, costBasis: 0, archived: false });
    });
    it('updateAsset applique le patch ; null efface ; archivage', async () => {
      const r = new FakeRepo(fixtureSeed);
      const id = await r.createAsset({ ...input, institution: 'LCL', fixedMonthly: 50 });
      await r.updateAsset(id, { manualValue: 2000, institution: null, archived: true });
      const a = (await r.listAssets()).find((x) => x.id === id)!;
      expect(a.manualValue).toBe(2000);
      expect(a.archived).toBe(true);
      expect('institution' in a).toBe(false);
      expect(a.fixedMonthly).toBe(50); // absent du patch = inchangé
      expect(a.name).toBe('Livret');
    });
    it('updateAsset : unitPrice null vide le cours unitaire', async () => {
      const r = new FakeRepo(fixtureSeed);
      await r.updateAsset('etf-revolut', { quoteId: 'VWCE.DE', unitPrice: null });
      const a = (await r.listAssets()).find((x) => x.id === 'etf-revolut')!;
      expect(a.quoteId).toBe('VWCE.DE');
      expect('unitPrice' in a).toBe(false);
    });
    it("updateAsset : undefined = inchangé, null sur champ obligatoire ignoré, id inconnu rejeté", async () => {
      const r = new FakeRepo(fixtureSeed);
      const id = await r.createAsset(input);
      await r.updateAsset(id, { manualValue: undefined, name: null, currency: null });
      expect((await r.listAssets()).find((x) => x.id === id)).toMatchObject({ name: 'Livret', currency: 'MAD', manualValue: 1000 });
      await expect(r.updateAsset('nope', { name: 'x' })).rejects.toThrow();
    });
    it('createDebt / updateDebt / deleteDebt', async () => {
      const r = new FakeRepo(fixtureSeed);
      const id = await r.createDebt({ name: 'Prêt', currency: 'EUR', outstanding: 1000, rate: 3, financedAssetId: 'or' });
      expect(id).toMatch(/^debt-\d+$/);
      await r.updateDebt(id, { outstanding: 900, rate: null, financedAssetId: null });
      const d = (await r.listDebts()).find((x) => x.id === id)!;
      expect(d).toMatchObject({ name: 'Prêt', outstanding: 900 });
      expect('rate' in d).toBe(false);
      expect('financedAssetId' in d).toBe(false);
      await r.deleteDebt(id);
      expect((await r.listDebts()).some((x) => x.id === id)).toBe(false);
      await expect(r.updateDebt('nope', { outstanding: 1 })).rejects.toThrow();
    });
    it('setStrategyEntry : upsert par clé, null efface, absent = inchangé', async () => {
      const r = new FakeRepo(fixtureSeed);
      const before = await r.getStrategy();
      await r.setStrategyEntry({ key: 'cible:Crypto', value: 15 });
      expect((await r.getStrategy()).targets.Crypto).toBe(0.15);
      expect((await r.getStrategy()).targets['Fonds & ETF']).toBe(before.targets['Fonds & ETF']);
      await r.setStrategyEntry({ key: 'investissement_mensuel', value: 1234 });
      expect((await r.getStrategy()).monthlyInvest).toBe(1234);
      await r.setStrategyEntry({ key: 'devise_affichage', text: 'MAD' });
      expect((await r.getStrategy()).displayCurrency).toBe('MAD');
      await r.setStrategyEntry({ key: 'actif:or', assetId: 'or' });
      expect((await r.getStrategy()).goldAssetId).toBe('or');
      await r.setStrategyEntry({ key: 'actif:or', assetId: null });
      expect((await r.getStrategy()).goldAssetId).toBeUndefined();
      await r.setStrategyEntry({ key: 'cible:Crypto', assetId: 'crypto' });
      expect((await r.getStrategy()).targets.Crypto).toBe(0.15); // valeur inchangée
      expect((await r.getStrategy()).mainAssetByClass.Crypto).toBe('crypto');
    });
    it('deleteStrategyEntry supprime la clé ; sans effet si absente', async () => {
      const r = new FakeRepo(fixtureSeed);
      await r.setStrategyEntry({ key: 'cible:Crypto', value: 15 });
      await r.deleteStrategyEntry('cible:Crypto');
      expect((await r.getStrategy()).targets.Crypto).toBeUndefined();
      await expect(r.deleteStrategyEntry('inconnue')).resolves.toBeUndefined();
    });
    it('ne mute pas fixtureSeed', async () => {
      const snapshot = structuredClone(fixtureSeed);
      const r = new FakeRepo(fixtureSeed);
      const aid = await r.createAsset(input);
      await r.updateAsset(aid, { manualValue: 1 });
      await r.updateAsset('or', { name: 'X' });
      const did = await r.createDebt({ name: 'P', currency: 'EUR', outstanding: 1 });
      await r.updateDebt('credit-dar-sakan', { outstanding: 1 });
      await r.deleteDebt(did);
      await r.setStrategyEntry({ key: 'cible:Crypto', value: 99 });
      await r.deleteStrategyEntry('actif:or');
      expect(fixtureSeed).toEqual(snapshot);
    });
    it("les entrées sont copiées (muter l'objet passé ensuite ne change pas le repo)", async () => {
      const r = new FakeRepo();
      const inp = { ...input };
      const id = await r.createAsset(inp);
      inp.name = 'MUTÉ';
      expect((await r.listAssets()).find((a) => a.id === id)!.name).toBe('Livret');
    });
  });
});
