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
});
