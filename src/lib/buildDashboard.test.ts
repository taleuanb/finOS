import { describe, expect, it } from 'vitest';
import { allocate } from '@/domain/allocation';
import { toEur } from '@/domain/money';
import { fixtureSeed } from '@/notion/seed';
import type { Asset } from '@/domain/types';
import { buildDashboard, type DashboardInput } from './buildDashboard';

const NOW = new Date('2026-11-10T10:00:00Z');

const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({
  assets: fixtureSeed.assets,
  movements: fixtureSeed.movements,
  debts: fixtureSeed.debts,
  budget: fixtureSeed.budget,
  strategy: fixtureSeed.strategy,
  plan: fixtureSeed.plan,
  snapshots: fixtureSeed.snapshots,
  series: null,
  now: NOW,
  ...over,
});

const planWithoutNovember = fixtureSeed.plan.filter((l) => l.month !== '2026-11');

describe('buildDashboard : totaux et répartition', () => {
  it('totals.netEur = actifs non archivés − dettes, en €', () => {
    const archived: Asset = { ...fixtureSeed.assets[0], id: 'vieux', archived: true, valueEur: 99_999 };
    const d = buildDashboard(input({ assets: [...fixtureSeed.assets, archived] }));
    const gross = fixtureSeed.assets.reduce((s, a) => s + (a.valueEur ?? 0), 0);
    const debts = fixtureSeed.debts.reduce((s, x) => s + (x.valueEur ?? 0), 0);
    expect(d.totals.grossEur).toBeCloseTo(gross, 6);
    expect(d.totals.debtsEur).toBeCloseTo(debts, 6);
    expect(d.totals.netEur).toBeCloseTo(gross - debts, 6);
    expect(d.assets.map((a) => a.id)).not.toContain('vieux');
    expect(d.debts[0].valueEur).toBeCloseTo(600_000 / 10.85, 6);
  });

  it('byClass est trié, sans les classes à 0, et les pct somment à 1', () => {
    const zero: Asset = { ...fixtureSeed.assets[0], id: 'nul', assetClass: 'Noms de domaine', value: 0, valueEur: 0 };
    const assets = [...fixtureSeed.assets.filter((a) => a.assetClass !== 'Noms de domaine'), zero];
    const d = buildDashboard(input({ assets }));
    expect(d.byClass.every((c, i, a) => i === 0 || a[i - 1].valueEur >= c.valueEur)).toBe(true);
    expect(d.byClass.some((c) => c.valueEur === 0)).toBe(false);
    expect(d.byClass.map((c) => c.assetClass)).not.toContain('Noms de domaine');
    expect(d.byClass.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(1, 9);
    expect(d.byClass[0].assetClass).toBe('Immobilier');
  });

  it('valorise chaque actif : gain dans la devise de l’actif, null sans prix de revient', () => {
    const d = buildDashboard(input());
    const hsbc = d.assets.find((a) => a.id === 'hsbc')!;
    expect(hsbc.gainAbs).toBeCloseTo(22_140 - hsbc.costBasis, 6);
    expect(hsbc.gainPct).toBeCloseTo((22_140 - hsbc.costBasis) / hsbc.costBasis, 9);
    const lcl = d.assets.find((a) => a.id === 'lcl')!;
    expect(lcl.gainAbs).toBeNull();
    expect(lcl.gainPct).toBeNull();
    const dar = d.assets.find((a) => a.id === 'dar-sakan')!;
    expect(dar.value).toBe(1_200_000);
    expect(dar.valueEur).toBeCloseTo(1_200_000 / 10.85, 6);
  });

  it('valueEur retombe sur la conversion de value quand la synchro ne l’a pas écrit', () => {
    const a: Asset = { ...fixtureSeed.assets[0], valueEur: undefined, value: 1085, currency: 'MAD' };
    const d = buildDashboard(input({ assets: [a] }));
    expect(d.assets[0].valueEur).toBeCloseTo(100, 6);
  });

  it('topPerformers : 5 meilleurs gainPct, décroissants', () => {
    const d = buildDashboard(input());
    expect(d.topPerformers).toHaveLength(5);
    expect(d.topPerformers[0].id).toBe('domaines');
    const pcts = d.topPerformers.map((a) => a.gainPct!);
    expect([...pcts].sort((x, y) => y - x)).toEqual(pcts);
  });
});

describe('buildDashboard : taux, fraîcheur, variations', () => {
  it('prend les taux du dernier instantané', () => {
    const snaps = fixtureSeed.snapshots.map((s) => ({ ...s, eurMad: 10.5, eurUsd: 1.1 }));
    const d = buildDashboard(input({ snapshots: snaps }));
    expect(d.fx).toMatchObject({ EUR: 1, MAD: 10.5, USD: 1.1, GBP: 0.84, date: '2026-10-25' });
  });

  it('sans instantané : taux par défaut, stale vrai, pas de variation', () => {
    const d = buildDashboard(input({ snapshots: [] }));
    expect(d.fx).toEqual({ date: '2026-11-10', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84 });
    expect(d.stale).toBe(true);
    expect(d.history).toEqual([]);
    expect(d.variations).toEqual({ '1M': null, YTD: null, '1A': null, Tout: null });
  });

  it('stale vaut true si le dernier lastUpdate date de plus de 36 h, false sinon', () => {
    expect(buildDashboard(input()).stale).toBe(true); // 2026-10-25 vs 2026-11-10
    const fresh = buildDashboard(input({ now: new Date('2026-10-26T10:00:00Z') }));
    expect(fresh.stale).toBe(false); // 2026-10-25 : < 36 h
    const edge = buildDashboard(input({ now: new Date('2026-10-26T13:00:00Z') }));
    expect(edge.stale).toBe(true); // lastUpdate 2026-10-25 (minuit UTC) + 37 h
  });

  it('lastSyncOk et asOf', () => {
    const assets = fixtureSeed.assets.map((a, i) => (i === 0 ? { ...a, lastUpdate: '2026-11-10T05:00:00.000Z' } : a));
    const d = buildDashboard(input({ assets }));
    expect(d.lastSyncOk).toBe('2026-11-10T05:00:00.000Z');
    expect(d.stale).toBe(false);
    expect(d.asOf).toBe('2026-11-10');
    expect(buildDashboard(input({ assets: [] })).lastSyncOk).toBeNull();
  });

  it('stale par actif : auto périmé / sans mise à jour ; manuel seulement si ⚠', () => {
    const base = fixtureSeed.assets.find((a) => a.id === 'hsbc')!;
    const manual = fixtureSeed.assets.find((a) => a.id === 'lcl')!;
    const assets: Asset[] = [
      { ...base, id: 'a-old', lastUpdate: '2026-11-08T00:00:00Z' },
      { ...base, id: 'a-ok', lastUpdate: '2026-11-10T05:00:00Z' },
      { ...base, id: 'a-none', lastUpdate: undefined },
      { ...manual, id: 'm-old', lastUpdate: '2026-01-01T00:00:00Z', syncStatus: 'manuel' },
      { ...manual, id: 'm-warn', syncStatus: '⚠ Valeur manuelle illisible' },
    ];
    const d = buildDashboard(input({ assets }));
    const stale = Object.fromEntries(d.assets.map((a) => [a.id, a.stale]));
    expect(stale).toEqual({ 'a-old': true, 'a-ok': false, 'a-none': true, 'm-old': false, 'm-warn': true });
  });

  it('variations : calculées depuis l’historique, null si la référence est le dernier instantané', () => {
    const d = buildDashboard(input());
    const last = fixtureSeed.snapshots[fixtureSeed.snapshots.length - 1];
    expect(d.variations.Tout!.abs).toBeCloseTo(last.netEur - fixtureSeed.snapshots[0].netEur, 6);
    expect(d.variations['1M']).not.toBeNull();
    expect(d.history).toHaveLength(fixtureSeed.snapshots.length);
    expect(d.history[d.history.length - 1]).toEqual({ date: '2026-10-25', netEur: last.netEur });

    const later = buildDashboard(input({ now: new Date('2027-06-01T10:00:00Z') }));
    expect(later.variations['1M']).toBeNull(); // tous les instantanés sont antérieurs à la référence
    expect(later.variations.Tout).not.toBeNull();
  });
});

describe('buildDashboard : métaux', () => {
  it('ratio, zone, positions et primes', () => {
    const d = buildDashboard(input());
    expect(d.metals.ratio).toBeCloseTo(64.51, 2);
    expect(d.metals.zone!.label).toBe('Neutre');
    expect(d.metals.alert).toBe(false);
    expect(d.metals.purchases[0].premium).toBeCloseTo(0.0327, 4);
    expect(d.metals.purchases).toHaveLength(7);
    expect(d.metals.purchases[0]).toMatchObject({ movementId: 'mv-or-1', metal: 'gold', amountEur: 547, fineGrams: 6.4516, spotEurPerKg: 82_100 });
    const collier = d.metals.purchases.find((p) => p.movementId === 'mv-or-3')!;
    expect(collier.premium).toBeNull();

    const gold = d.metals.gold!;
    expect(gold).toMatchObject({ assetId: 'or', grams: 24.9, spotEurPerKg: 125_926 });
    expect(gold.valueEur).toBeCloseTo(3_136, 6);
    expect(gold.costEur).toBe(2_402);
    expect(gold.gainPct).toBeCloseTo((3_136 - 2_402) / 2_402, 9);
    expect(gold.avgCostPerKg).toBeCloseTo(((547 + 555 + 1300) / (6.4516 + 6.4516 + 0)) * 1000, 4);
    const goldPremiums = d.metals.purchases.filter((p) => p.metal === 'gold' && p.premium !== null).map((p) => p.premium!);
    expect(gold.avgPremium).toBeCloseTo(goldPremiums.reduce((s, p) => s + p, 0) / goldPremiums.length, 9);
    expect(d.metals.silver!.avgPremium).toBeNull(); // aucun spot d’achat d’argent connu
  });

  it('ratio, zone et positions nuls sans actifs métaux ou sans cours', () => {
    const noMetals = buildDashboard(input({
      assets: fixtureSeed.assets.filter((a) => a.assetClass !== 'Métaux précieux'),
      movements: fixtureSeed.movements.filter((m) => m.assetId !== 'or' && m.assetId !== 'ag'),
    }));
    expect(noMetals.metals).toMatchObject({ gold: null, silver: null, ratio: null, zone: null, purchases: [] });
    const noSpot = buildDashboard(input({ assets: fixtureSeed.assets.map((a) => (a.id === 'ag' ? { ...a, unitPrice: undefined } : a)) }));
    expect(noSpot.metals.ratio).toBeNull();
    expect(noSpot.metals.zone).toBeNull();
  });

  it('alerte quand le ratio reste hors zone neutre 14 jours consécutifs', () => {
    const snaps = Array.from({ length: 14 }, (_, i) => ({
      ...fixtureSeed.snapshots[0], date: `2026-10-${String(i + 12).padStart(2, '0')}`, goldSilverRatio: 85,
    }));
    expect(buildDashboard(input({ snapshots: snaps })).metals.alert).toBe(true);
  });

  it('ratioHistory : ratio or/argent aux dates communes ; [] sans série', () => {
    const series = {
      gold: [{ date: '2026-10-05', close: 4000 }, { date: '2026-10-12', close: 4100 }, { date: '2026-10-19', close: 4200 }],
      silver: [{ date: '2026-10-05', close: 50 }, { date: '2026-10-12', close: 0 }, { date: '2026-10-26', close: 60 }],
    };
    expect(buildDashboard(input({ series })).metals.ratioHistory).toEqual([{ date: '2026-10-05', ratio: 80 }]);
    expect(buildDashboard(input({ series: null })).metals.ratioHistory).toEqual([]);
  });

  it('monthSplit : lignes validées du mois pour l’or et l’argent', () => {
    expect(buildDashboard(input()).metals.monthSplit).toEqual({ goldEur: 165, silverEur: 135 });
  });

  it('monthSplit : montants de la proposition quand le mois n’est pas validé', () => {
    const d = buildDashboard(input({ plan: planWithoutNovember }));
    const p = d.plan.proposal!;
    expect(d.metals.monthSplit).toEqual({
      goldEur: p.filter((l) => l.assetId === 'or').reduce((s, l) => s + l.amount, 0),
      silverEur: p.filter((l) => l.assetId === 'ag').reduce((s, l) => s + l.amount, 0),
    });
    expect(d.metals.monthSplit.goldEur + d.metals.monthSplit.silverEur).toBeGreaterThan(0);
  });
});

describe('buildDashboard : budget', () => {
  it('résume le budget avec les lignes triées par ordre', () => {
    const d = buildDashboard(input({ budget: [...fixtureSeed.budget].reverse() }));
    expect(d.budget.savingsEur).toBeCloseTo(1769.75, 2);
    expect(d.budget.investEur).toBe(900);
    expect(d.budget.lines.map((l) => l.order)).toEqual([...d.budget.lines.map((l) => l.order)].sort((a, b) => a - b));
    expect(d.budget.lines).toHaveLength(fixtureSeed.budget.length);
  });
});

describe('buildDashboard : plan du mois', () => {
  it('mois non validé : proposition = allocate(budget.investEur)', () => {
    const d = buildDashboard(input({ plan: planWithoutNovember }));
    expect(d.plan).toMatchObject({ month: '2026-11', validated: false, allocationError: null, lines: [] });
    const expected = allocate({
      amount: d.budget.investEur,
      assets: d.assets,
      strategy: fixtureSeed.strategy,
      ratio: d.metals.ratio,
    });
    expect(d.plan.proposal).toEqual(expected);
    expect(d.plan.proposal!.length).toBeGreaterThan(0);
  });

  it('mois validé : lignes cohérentes avec le cumul et les statuts', () => {
    const d = buildDashboard(input());
    expect(d.plan).toMatchObject({ month: '2026-11', validated: true, proposal: null, allocationError: null });
    const byId = Object.fromEntries(d.plan.lines.map((l) => [l.assetId, l]));
    expect(Object.keys(byId).sort()).toEqual(['ag', 'crypto', 'hsbc', 'or', 'per', 'syla']);
    expect(byId.syla).toMatchObject({ assetName: 'Syla Invest', plannedEur: 100, origin: 'cible', toInvestEur: 600, monthsAccrued: 6, status: 'pending', reason: 'Selon tes cibles' });
    expect(byId.or).toMatchObject({ plannedEur: 165, origin: 'signal', toInvestEur: 330, monthsAccrued: 2, status: 'pending', reason: 'Signal or / argent' });
    expect(byId.ag).toMatchObject({ toInvestEur: 270, status: 'pending' });
    expect(byId.per).toMatchObject({ origin: 'fixe', toInvestEur: 0, monthsAccrued: 0, status: 'declared', reason: 'Versement fixe programmé' });
    expect(byId.hsbc.status).toBe('declared');
    expect(byId.crypto.status).toBe('declared');
  });

  it('montants du mois : investi, en attente, libre, épargne et historique sur 6 mois', () => {
    const d = buildDashboard(input());
    expect(d.plan.investedEur).toBe(500);
    expect(d.plan.pendingEur).toBe(1200);
    expect(d.plan.freeEur).toBeCloseTo(d.budget.freeEur, 9);
    expect(d.plan.savings.balanceEur).toBeCloseTo(toEur(160_000, 'MAD', d.fx), 6);
    expect(d.plan.savings.reservedEur).toBe(1200);
    expect(d.plan.savings.freeEur).toBeCloseTo(d.plan.savings.balanceEur - 1200, 6);
    expect(d.plan.history6.map((h) => h.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(d.plan.history6.every((h) => h.savedEur === d.budget.savingsEur)).toBe(true);
    expect(d.plan.history6.map((h) => h.investedEur)).toEqual([0, 0, 0, 0, 500, 500]);
  });

  it('history6 traverse le changement d’année', () => {
    const d = buildDashboard(input({ now: new Date('2027-02-10T10:00:00Z') }));
    expect(d.plan.month).toBe('2027-02');
    expect(d.plan.history6.map((h) => h.month)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('le mois du plan suit Paris : 23:30 UTC le 31 octobre = 1er novembre', () => {
    const d = buildDashboard(input({ now: new Date('2026-10-31T23:30:00Z') }));
    expect(d.plan.month).toBe('2026-11');
    expect(d.asOf).toBe('2026-11-01');
  });

  it('Review Focus 3 : classe ciblée sans actif principal → allocationError, sans exception', () => {
    const strategy = {
      ...fixtureSeed.strategy,
      targets: { ...fixtureSeed.strategy.targets, Crypto: 0.3 }, // assez en retard pour recevoir une part
      mainAssetByClass: { ...fixtureSeed.strategy.mainAssetByClass, Crypto: undefined },
    };
    const d = buildDashboard(input({ strategy, plan: planWithoutNovember }));
    expect(d.plan.allocationError).toBe('Aucun actif principal pour la classe Crypto');
    expect(d.plan.proposal).toBeNull();
    expect(d.plan.validated).toBe(false);
    expect(d.metals.monthSplit).toEqual({ goldEur: 0, silverEur: 0 });
  });
});
