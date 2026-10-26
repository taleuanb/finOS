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
    // L'Épargne compte pour son solde estimé (I3), les autres actifs pour leur valeur.
    const gross = fixtureSeed.assets.filter((a) => a.id !== 'epargne').reduce((s, a) => s + (a.valueEur ?? 0), 0)
      + d.plan.savings.balanceEur;
    const debts = fixtureSeed.debts.reduce((s, x) => s + (x.valueEur ?? 0), 0);
    expect(d.totals.grossEur).toBeCloseTo(gross, 6);
    expect(d.totals.debtsEur).toBeCloseTo(debts, 6);
    expect(d.totals.netEur).toBeCloseTo(gross - debts, 6);
    expect(d.assets.map((a) => a.id)).not.toContain('vieux');
    expect(d.debts[0].valueEur).toBeCloseTo(600_000 / 10.85, 6);
  });

  it('byClass est trié, sans les classes à 0, et les pct somment à 1', () => {
    const zero: Asset = { ...fixtureSeed.assets[0], id: 'nul', assetClass: 'Noms de domaine', manualValue: 0, value: 0, valueEur: 0 };
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

  it('actif auto : valueEur retombe sur la conversion de value quand la synchro ne l’a pas écrit', () => {
    const a: Asset = { ...fixtureSeed.assets[0], mode: 'auto', valueEur: undefined, value: 1085, currency: 'MAD' };
    const d = buildDashboard(input({ assets: [a] }));
    expect(d.assets[0].valueEur).toBeCloseTo(100, 6);
  });

  it('topPerformers : 5 meilleurs gainPct, décroissants', () => {
    const d = buildDashboard(input());
    expect(d.topPerformers).toHaveLength(5);
    expect(d.topPerformers[0].id).toBe('ag'); // argent : 779,927 g × 1 952 €/kg pour 948 € investis
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
    // Grammes = somme des mouvements (I12) : 6,4516 + 6,4516 + collier 0 g.
    expect(gold).toMatchObject({ assetId: 'or', grams: 12.9032, spotEurPerKg: 125_926 });
    const goldValue = (12.9032 * 125_926) / 1000; // grammes des mouvements × cours €/kg
    expect(gold.valueEur).toBeCloseTo(goldValue, 6);
    expect(gold.costEur).toBe(2_402);
    expect(gold.gainPct).toBeCloseTo((goldValue - 2_402) / 2_402, 9);
    // M1 : le collier (0 g fin) est exclu du coût moyen (≈ 85 405 €/kg au lieu de 186 k€/kg).
    expect(gold.avgCostPerKg).toBeCloseTo(((547 + 555) / (6.4516 + 6.4516)) * 1000, 4);
    const goldPremiums = d.metals.purchases.filter((p) => p.metal === 'gold' && p.premium !== null).map((p) => p.premium!);
    expect(gold.avgPremium).toBeCloseTo(goldPremiums.reduce((s, p) => s + p, 0) / goldPremiums.length, 9);
    expect(d.metals.silver!.avgPremium).toBeNull(); // aucun spot d’achat d’argent connu
  });

  it('M1 : la liste des achats de métaux exclut les ventes', () => {
    const sale = { id: 'mv-or-vente', label: 'Vente', date: '2026-01-10', assetId: 'or', kind: 'sell' as const, quantity: 1, amount: 120, spotEurPerKg: 100_000 };
    const d = buildDashboard(input({ movements: [...fixtureSeed.movements, sale] }));
    expect(d.metals.purchases.map((p) => p.movementId)).not.toContain('mv-or-vente');
    expect(d.metals.purchases).toHaveLength(7);
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
    expect(d.plan).toMatchObject({ month: '2026-11', validated: false, allocationError: null });
    // I4 : seuls les reliquats (plannedEur 0) figurent dans les lignes d'un mois non validé.
    expect(d.plan.lines.every((l) => l.plannedEur === 0 && l.reason === 'Reliquat des mois précédents')).toBe(true);
    const expected = allocate({
      amount: d.budget.investEur,
      assets: d.assets,
      strategy: fixtureSeed.strategy,
      ratio: d.metals.ratio,
      fx: d.fx,
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
    // Solde estimé (I3) : 160 000 MAD le 2026-10-01 + épargne du 1er novembre − achats du plan (oct. 500 + nov. 500).
    expect(d.plan.savings.balanceEur).toBeCloseTo(toEur(160_000, 'MAD', d.fx) + d.budget.savingsEur - 1_000, 6);
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

describe('buildDashboard : fraîcheur des valeurs (I3) et positions (I12)', () => {
  it('actif manuel jamais synchronisé : la valeur manuelle, pas 0', () => {
    const a: Asset = { ...fixtureSeed.assets.find((x) => x.id === 'lcl')!, value: undefined, valueEur: undefined, manualValue: 5_000 };
    const d = buildDashboard(input({ assets: [a] }));
    expect(d.assets[0]).toMatchObject({ value: 5_000, valueEur: 5_000 });
    expect(d.totals.grossEur).toBe(5_000);
  });

  it('valeur manuelle modifiée dans Notion après la synchro : la nouvelle valeur', () => {
    const a: Asset = { ...fixtureSeed.assets.find((x) => x.id === 'dar-sakan')!, manualValue: 1_302_000 };
    const d = buildDashboard(input({ assets: [a] }));
    expect(d.assets[0].value).toBe(1_302_000);
    expect(d.assets[0].valueEur).toBeCloseTo(1_302_000 / 10.85, 6);
  });

  it('Épargne : solde estimé recalculé, un achat déclaré après la synchro réduit aussitôt « Libre »', () => {
    const before = buildDashboard(input());
    const declared = { id: 'mv-new', label: 'Plan 2026-11', date: '2026-11-09', assetId: 'or', kind: 'buy' as const, quantity: 1, amount: 165, planMonth: '2026-11' };
    const after = buildDashboard(input({ movements: [...fixtureSeed.movements, declared] }));
    // 160 000 MAD le 2026-10-01 + épargne du 1er novembre − achats du plan depuis (oct. 500 + nov. 500)
    expect(before.plan.savings.balanceEur).toBeCloseTo(160_000 / 10.85 + before.budget.savingsEur - 1_000, 6);
    expect(after.plan.savings.balanceEur).toBeCloseTo(before.plan.savings.balanceEur - 165, 6);
    expect(after.plan.savings.freeEur).toBeCloseTo(before.plan.savings.freeEur, 6); // −165 de solde, −165 de réservé
    const ep = after.assets.find((a) => a.id === 'epargne')!;
    expect(ep.valueEur).toBeCloseTo(after.plan.savings.balanceEur, 9);
    expect(ep.value).toBeCloseTo(after.plan.savings.balanceEur * 10.85, 6);
  });

  it('quantité et prix de revient depuis les mouvements, au-delà de 25', () => {
    const extra = Array.from({ length: 30 }, (_, i) => ({
      id: `mv-x-${i}`, label: 'Achat', date: '2026-09-01', assetId: 'etf-revolut', kind: 'buy' as const, quantity: 1, amount: 150,
    }));
    const assets = fixtureSeed.assets.map((a) => (a.id === 'etf-revolut' ? { ...a, quantity: 25, costBasis: 3_750 } : a));
    const d = buildDashboard(input({ assets, movements: [...fixtureSeed.movements, ...extra] }));
    expect(d.assets.find((a) => a.id === 'etf-revolut')).toMatchObject({ quantity: 30, costBasis: 4_500 });
    expect(d.assets.find((a) => a.id === 'lcl')).toMatchObject({ quantity: 1, costBasis: 0 }); // sans mouvement : inchangé
  });
});


describe('buildDashboard : reliquats des mois précédents (I4)', () => {
  // Syla : 600 € prévus de juin à novembre, jamais achetés. On retire Syla du plan de novembre.
  const planNoSylaNov = fixtureSeed.plan.filter((l) => !(l.month === '2026-11' && l.assetId === 'syla'));

  it('mois validé : un actif absent du mois mais avec un reste à investir a sa ligne, déclarable', () => {
    const d = buildDashboard(input({ plan: planNoSylaNov }));
    const syla = d.plan.lines.find((l) => l.assetId === 'syla');
    expect(syla).toMatchObject({
      assetName: 'Syla Invest', plannedEur: 0, toInvestEur: 500, status: 'pending', reason: 'Reliquat des mois précédents',
    });
    expect(d.plan.pendingEur).toBe(d.plan.savings.reservedEur);
  });

  it('mois non validé : proposition et reliquats affichés, En attente = Réservé', () => {
    const d = buildDashboard(input({ plan: planWithoutNovember }));
    expect(d.plan.validated).toBe(false);
    expect(d.plan.proposal).not.toBeNull();
    const byId = Object.fromEntries(d.plan.lines.map((l) => [l.assetId, l]));
    expect(Object.keys(byId).sort()).toEqual(['ag', 'or', 'syla']); // or 165, argent 135, Syla 500 dus
    expect(byId.syla).toMatchObject({ plannedEur: 0, toInvestEur: 500, status: 'pending', reason: 'Reliquat des mois précédents' });
    expect(byId.or).toMatchObject({ toInvestEur: 165, status: 'pending' });
    expect(d.plan.pendingEur).toBe(800);
    expect(d.plan.pendingEur).toBe(d.plan.savings.reservedEur);
  });

  it('cas des maquettes : En attente = Réservé', () => {
    const d = buildDashboard(input());
    expect(d.plan.pendingEur).toBe(d.plan.savings.reservedEur);
  });
});

describe('buildDashboard : grille or/argent (I10)', () => {
  it('grille par défaut : aucun avertissement', () => {
    expect(buildDashboard(input()).metals.gridWarning).toBeNull();
  });
  it('zone illisible dans la Stratégie : avertissement', () => {
    const strategy = { ...fixtureSeed.strategy, gridWarnings: ['Bizarre'] };
    expect(buildDashboard(input({ strategy })).metals.gridWarning).toMatch(/^⚠ Grille or\/argent incomplète dans la Stratégie/);
  });
  it('grille à trous : avertissement et zone neutre pour un ratio hors grille', () => {
    const metalGrid = fixtureSeed.strategy.metalGrid.filter((z) => z.label !== 'Neutre'); // trou 50–65
    const d = buildDashboard(input({ strategy: { ...fixtureSeed.strategy, metalGrid } }));
    expect(d.metals.gridWarning).toMatch(/Grille or\/argent incomplète/);
    expect(d.metals.ratio).toBeCloseTo(64.51, 2);
    expect(d.metals.zone!.label).not.toBe('Argent bon marché');
  });
});

describe('buildDashboard : mode démo (I9)', () => {
  it('demo vaut false par défaut, true si demandé', () => {
    expect(buildDashboard(input()).demo).toBe(false);
    expect(buildDashboard(input({ demo: true })).demo).toBe(true);
  });
});


describe('buildDashboard : valeur des actifs auto suivant les mouvements (quantité × cours)', () => {
  const auto = (over: Partial<Asset>): Asset => ({
    id: 'x', name: 'X', assetClass: 'Fonds & ETF', currency: 'EUR', mode: 'auto', quoteId: 'X',
    quantity: 0, costBasis: 0, archived: false, syncStatus: 'OK', lastUpdate: '2026-11-10T06:00:00Z', ...over,
  });
  const buy = (assetId: string, quantity: number, amount: number) => ({
    id: `mv-${assetId}-${quantity}`, label: 'Achat', date: '2026-11-09', assetId, kind: 'buy' as const, quantity, amount,
  });

  it('ETF en USD : un achat ajouté après la synchro change aussitôt la valeur (quantité × cours, en USD puis €)', () => {
    const etf = auto({ id: 'etf-usd', currency: 'USD', unitPrice: 50, value: 500, valueEur: 500 / 1.08 });
    const d = buildDashboard(input({ assets: [etf], movements: [buy('etf-usd', 10, 480), buy('etf-usd', 4, 190)], strategy: { ...fixtureSeed.strategy, savingsAssetId: undefined } }));
    expect(d.assets[0].quantity).toBe(14);
    expect(d.assets[0].value).toBeCloseTo(700, 9);
    expect(d.assets[0].valueEur).toBeCloseTo(700 / 1.08, 9);
    expect(d.totals.grossEur).toBeCloseTo(700 / 1.08, 9);
  });

  it('métal : grammes fins × cours €/kg ÷ 1000, même pour un actif en MAD', () => {
    const or = auto({ id: 'or-mad', assetClass: 'Métaux précieux', currency: 'MAD', quoteId: 'XAU', unitPrice: 120_000, value: 0, valueEur: 0 });
    const d = buildDashboard(input({ assets: [or], movements: [buy('or-mad', 10, 13_000)], strategy: { ...fixtureSeed.strategy, savingsAssetId: undefined } }));
    expect(d.assets[0].valueEur).toBeCloseTo(1_200, 9);
    expect(d.assets[0].value).toBeCloseTo(1_200 * 10.85, 6);
  });

  it('sans cours connu (jamais synchronisé) : la valeur stockée est conservée', () => {
    const fresh = auto({ id: 'neuf', value: 321, valueEur: 321 });
    const d = buildDashboard(input({ assets: [fresh], movements: [buy('neuf', 3, 300)], strategy: { ...fixtureSeed.strategy, savingsAssetId: undefined } }));
    expect(d.assets[0]).toMatchObject({ quantity: 3, value: 321, valueEur: 321 });
  });

  it('les métaux du jeu de démonstration valent grammes des mouvements × cours', () => {
    const d = buildDashboard(input());
    expect(d.metals.gold!.valueEur).toBeCloseTo((12.9032 * 125_926) / 1000, 6);
    expect(d.metals.silver!.valueEur).toBeCloseTo(((93.309 * 3 + 500) * 1_952) / 1000, 6);
  });
});

describe('buildDashboard : crédits', () => {
  it('la valeur € d’un crédit suit toujours le capital restant dû (jamais une « Valeur € » stockée périmée)', () => {
    const debt = { ...fixtureSeed.debts[0], outstanding: 540_000, valueEur: 600_000 / 10.85 };
    const d = buildDashboard(input({ debts: [debt] }));
    expect(d.debts[0].valueEur).toBeCloseTo(540_000 / 10.85, 6);
    expect(d.totals.debtsEur).toBeCloseTo(540_000 / 10.85, 6);
  });
});

describe('buildDashboard : versement fixe en devise', () => {
  it('la proposition convertit le versement fixe d’un actif en MAD : 1 085 MAD = 100 € exactement', () => {
    const assets = fixtureSeed.assets.map((a) => (a.id === 'per' ? { ...a, currency: 'MAD' as const, fixedMonthly: 1_085 } : a));
    // Sans cible PER, la ligne du PER ne contient que le versement fixe (taux du dernier instantané : 10,85).
    const targets = { ...fixtureSeed.strategy.targets };
    const mainAssetByClass = { ...fixtureSeed.strategy.mainAssetByClass };
    delete targets.PER;
    delete mainAssetByClass.PER;
    const strategy = { ...fixtureSeed.strategy, targets, mainAssetByClass };
    const d = buildDashboard(input({ assets, strategy, plan: planWithoutNovember }));
    expect(d.plan.proposal!.find((l) => l.assetId === 'per')).toEqual({
      assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé',
    });
  });
});
