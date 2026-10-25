import { allocate } from '@/domain/allocation';
import { summarizeBudget } from '@/domain/budget';
import { monthsBetween, parisDate, parisMonth } from '@/domain/dates';
import { variation } from '@/domain/history';
import { averageCostPerKg, goldSilverRatio, premium, ratioAlert } from '@/domain/metals';
import { fromEur, toEur } from '@/domain/money';
import { monthStatus, monthsAccrued, reservedAndFree, toInvestByAsset } from '@/domain/plan';
import { withPositions } from '@/domain/positions';
import { savingsBalanceEur } from '@/domain/savings';
import { AllocationError } from '@/domain/types';
import type {
  Asset, AssetClass, BudgetLine, Debt, FxRates, Movement, PlanLine, Snapshot, Strategy,
} from '@/domain/types';
import { gain, valueAsset } from '@/domain/valuation';
import { gridIssue, zoneFor } from '@/domain/zones';
import type {
  Dashboard, MetalPosition, MetalPurchaseView, Period, PlanLineView, ValuedAsset,
} from './dashboard';

/** Clôtures hebdomadaires de l'or (GC=F) et de l'argent (SI=F), toutes deux en $/oz. */
export interface DashboardSeries {
  gold: { date: string; close: number }[];
  silver: { date: string; close: number }[];
}

export interface DashboardInput {
  assets: Asset[]; movements: Movement[]; debts: Debt[]; budget: BudgetLine[];
  strategy: Strategy; plan: PlanLine[]; snapshots: Snapshot[];
  series: DashboardSeries | null; now: Date;
  demo?: boolean;                                   // FakeRepo actif (WOS_DEMO=1)
}

const STALE_AFTER_MS = 36 * 3_600_000;
const PERIODS: Period[] = ['1M', 'YTD', '1A', 'Tout'];
const DEFAULT_FX = { EUR: 1 as const, MAD: 10.85, USD: 1.08, GBP: 0.84 };
const ORIGIN_REASON: Record<PlanLine['origin'], string> = {
  fixe: 'Versement fixe programmé',
  cible: 'Selon tes cibles',
  signal: 'Signal or / argent',
};

const CARRIED_REASON = 'Reliquat des mois précédents';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Mois 'AAAA-MM' décalé de `delta` mois. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function fxFrom(snapshots: Snapshot[], today: string): FxRates {
  const last = snapshots.length > 0
    ? snapshots.reduce((a, b) => (b.date >= a.date ? b : a))
    : null;
  return last
    ? { ...DEFAULT_FX, date: last.date, MAD: last.eurMad, USD: last.eurUsd }
    : { ...DEFAULT_FX, date: today };
}

function isStale(a: Asset, nowMs: number): boolean {
  if (a.mode === 'manual') return a.syncStatus?.startsWith('⚠') ?? false;
  const updated = a.lastUpdate ? Date.parse(a.lastUpdate) : NaN;
  return Number.isNaN(updated) || nowMs - updated > STALE_AFTER_MS;
}

/**
 * Valeurs à afficher : actif Épargne = solde estimé (`savingsEur`), actif manuel = valeur manuelle du jour
 * (jamais la dernière valeur synchronisée, qui vaut 0 avant la première synchro), actif auto = quantité des mouvements ×
 * dernier cours synchronisé (valeur synchronisée seulement tant qu'aucun cours n'est connu).
 */
function valueAssets(
  assets: Asset[], fx: FxRates, nowMs: number, savings: { id: string; valueEur: number } | null,
): ValuedAsset[] {
  return assets.filter((a) => !a.archived).map((a) => {
    let value: number;
    let valueEur: number;
    if (savings && a.id === savings.id) {
      valueEur = savings.valueEur;
      value = fromEur(valueEur, a.currency, fx);
    } else if (a.mode === 'manual' || a.unitPrice !== undefined) {
      // Auto avec un cours connu : quantité des mouvements × dernier cours, comme la synchro (un mouvement
      // ajouté depuis la dernière synchro compte aussitôt).
      ({ value, valueEur } = valueAsset(a, undefined, fx));
    } else {
      value = a.value ?? 0;
      valueEur = a.valueEur ?? toEur(value, a.currency, fx);
    }
    const g = a.costBasis > 0 ? gain(value, a.costBasis) : null;
    return {
      ...a, value, valueEur,
      gainAbs: g ? g.abs : null, gainPct: g ? g.pct : null, stale: isStale(a, nowMs),
    };
  });
}

/** Variation d'une période, ou null si le point de référence est le dernier instantané lui-même. */
function periodVariation(snapshots: Snapshot[], period: Period, today: string) {
  const v = variation(snapshots, period, today);
  if (!v || snapshots.length === 0) return v;
  // `variation` n'expose pas son point de référence. Test : on majore le dernier net de 1 € ; la variation
  // absolue augmente alors d'1 € si la référence est un autre point, et reste 0 si c'est le dernier lui-même.
  const last = snapshots.reduce((a, b) => (b.date >= a.date ? b : a));
  const bumped = snapshots.map((s) => (s === last ? { ...s, netEur: s.netEur + 1 } : s));
  const v2 = variation(bumped, period, today);
  return v2 && Math.abs(v2.abs - v.abs - 1) < 1e-6 ? v : null;
}

function ratioHistoryFrom(series: DashboardSeries | null): { date: string; ratio: number }[] {
  if (!series) return [];
  const silver = new Map(series.silver.map((p) => [p.date, p.close]));
  const out: { date: string; ratio: number }[] = [];
  for (const g of series.gold) {
    const s = silver.get(g.date);
    if (s !== undefined && s > 0 && g.close > 0) out.push({ date: g.date, ratio: g.close / s });
  }
  return out;
}

/** Assemble le tableau de bord à partir des lectures brutes. Pure : aucune lecture ni horloge. */
export function buildDashboard(i: DashboardInput): Dashboard {
  const { movements, strategy, plan, now } = i;
  const nowMs = now.getTime();
  const today = parisDate(now);
  const month = parisMonth(now);
  const snapshots = [...i.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const fx = fxFrom(snapshots, today);
  // Quantité et prix de revient recalculés depuis les mouvements (les rollups Notion sont tronqués à 25).
  const positioned = withPositions(i.assets, movements);
  const savingsSource = strategy.savingsAssetId
    ? positioned.find((a) => a.id === strategy.savingsAssetId && !a.archived)
    : undefined;
  const savingsValue = savingsSource
    ? {
      id: savingsSource.id,
      valueEur: savingsBalanceEur({
        asset: savingsSource, budget: i.budget, strategy, movements, plan, assets: i.assets, fx, today,
      }),
    }
    : null;
  const assets = valueAssets(positioned, fx, nowMs, savingsValue);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const nameOf = new Map(i.assets.map((a) => [a.id, a.name]));

  // --- Totaux, répartition, historique ---
  // Toujours depuis le capital restant dû (comme la synchro) : une « Valeur € » stockée serait périmée après une modification.
  const debts = i.debts.map((d) => ({ ...d, valueEur: toEur(d.outstanding, d.currency, fx) }));
  const grossEur = sum(assets.map((a) => a.valueEur));
  const debtsEur = sum(debts.map((d) => d.valueEur));
  const netEur = grossEur - debtsEur;

  const classTotals = new Map<AssetClass, number>();
  for (const a of assets) classTotals.set(a.assetClass, (classTotals.get(a.assetClass) ?? 0) + a.valueEur);
  const positive = [...classTotals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const positiveTotal = sum(positive.map(([, v]) => v));
  const byClass = positive.map(([assetClass, valueEur]) => ({ assetClass, valueEur, pct: valueEur / positiveTotal }));

  const variations = Object.fromEntries(
    PERIODS.map((p) => [p, periodVariation(snapshots, p, today)]),
  ) as Dashboard['variations'];

  const topPerformers = assets
    .filter((a) => a.gainPct !== null)
    .sort((a, b) => b.gainPct! - a.gainPct!)
    .slice(0, 5);

  // --- Fraîcheur ---
  const updates = i.assets.filter((a) => !a.archived && a.lastUpdate && !Number.isNaN(Date.parse(a.lastUpdate)));
  const newest = updates.reduce<Asset | null>(
    (best, a) => (best === null || Date.parse(a.lastUpdate!) > Date.parse(best.lastUpdate!) ? a : best), null,
  );
  const lastSyncOk = newest?.lastUpdate ?? null;
  const stale = snapshots.length === 0 || lastSyncOk === null || nowMs - Date.parse(lastSyncOk) > STALE_AFTER_MS;

  // --- Métaux ---
  const metalOf = new Map<string, 'gold' | 'silver'>();
  if (strategy.goldAssetId) metalOf.set(strategy.goldAssetId, 'gold');
  if (strategy.silverAssetId) metalOf.set(strategy.silverAssetId, 'silver');
  const currencyOf = new Map(i.assets.map((a) => [a.id, a.currency]));

  const purchases: MetalPurchaseView[] = movements
    .filter((m) => m.kind === 'buy' && metalOf.has(m.assetId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      const amountEur = toEur(m.amount, currencyOf.get(m.assetId) ?? 'EUR', fx);
      return {
        movementId: m.id, date: m.date, label: m.label, nature: m.nature,
        metal: metalOf.get(m.assetId)!, fineGrams: m.quantity, amountEur,
        spotEurPerKg: m.spotEurPerKg ?? null,
        premium: m.spotEurPerKg && m.quantity > 0 ? premium(amountEur, m.quantity, m.spotEurPerKg) : null,
      };
    });

  const position = (metal: 'gold' | 'silver'): MetalPosition | null => {
    const id = metal === 'gold' ? strategy.goldAssetId : strategy.silverAssetId;
    const a = id ? assetById.get(id) : undefined;
    if (!a) return null;
    const premiums = purchases
      .filter((p) => p.metal === metal && p.fineGrams > 0 && p.premium !== null)
      .map((p) => p.premium!);
    const own = movements.filter((m) => m.assetId === a.id);
    return {
      assetId: a.id, grams: a.quantity, valueEur: a.valueEur, costEur: toEur(a.costBasis, a.currency, fx),
      avgCostPerKg: toEur(averageCostPerKg(own), a.currency, fx), spotEurPerKg: a.unitPrice ?? 0,
      avgPremium: premiums.length > 0 ? sum(premiums) / premiums.length : null,
      gainPct: gain(a.value, a.costBasis).pct ?? 0,
    };
  };
  const gold = position('gold');
  const silver = position('silver');
  const ratio = gold && silver && gold.spotEurPerKg > 0 && silver.spotEurPerKg > 0
    ? goldSilverRatio(gold.spotEurPerKg, silver.spotEurPerKg)
    : null;
  const zone = ratio !== null && strategy.metalGrid.length > 0 ? zoneFor(ratio, strategy.metalGrid) : null;
  const gridProblems = [
    ...(strategy.gridWarnings ?? []).map((label) => `zone illisible : ${label}`),
    ...[gridIssue(strategy.metalGrid)].filter((x): x is string => x !== null),
  ];
  const gridWarning = gridProblems.length > 0
    ? `⚠ Grille or/argent incomplète dans la Stratégie (${gridProblems.join(' ; ')})`
    : null;

  // --- Budget ---
  const budgetSummary = summarizeBudget(i.budget, fx, strategy.monthlyInvest);
  const budget = { ...budgetSummary, lines: [...i.budget].sort((a, b) => a.order - b.order) };

  // --- Plan du mois ---
  const monthLines = plan.filter((l) => l.month === month);
  const validated = monthLines.length > 0;
  let proposal: Dashboard['plan']['proposal'] = null;
  let allocationError: string | null = null;
  if (!validated) {
    try {
      proposal = allocate({ amount: budget.investEur, assets, strategy, ratio, fx });
    } catch (e) {
      if (!(e instanceof AllocationError)) throw e;
      allocationError = e.message;
    }
  }

  const toInvest = toInvestByAsset(plan, movements, i.assets, fx, month);
  const lineView = (l: Pick<PlanLine, 'assetId' | 'amount' | 'origin'>, reason: string): PlanLineView => ({
    assetId: l.assetId, assetName: nameOf.get(l.assetId) ?? l.assetId, plannedEur: l.amount, origin: l.origin,
    reason, toInvestEur: toInvest.get(l.assetId) ?? 0,
    monthsAccrued: monthsAccrued(toInvest.get(l.assetId) ?? 0, l.amount),
    status: monthStatus(l.assetId, month, plan, movements, i.assets, fx),
  });
  // Lignes du mois, puis les reliquats : actifs absents du mois (validé ou non) qui ont encore un reste à investir.
  const lines: PlanLineView[] = monthLines.map((l) => lineView(l, ORIGIN_REASON[l.origin]));
  const inMonth = new Set(monthLines.map((l) => l.assetId));
  for (const [assetId, rest] of toInvest) {
    if (rest <= 0 || inMonth.has(assetId)) continue;
    const last = plan.filter((l) => l.assetId === assetId && l.month < month).sort((a, b) => a.month.localeCompare(b.month)).at(-1);
    lines.push(lineView({ assetId, amount: 0, origin: last?.origin ?? 'cible' }, CARRIED_REASON));
  }

  const planAssetIds = new Set(plan.map((l) => l.assetId));
  const investedIn = (m: string) => sum(
    movements
      .filter((mv) => mv.kind === 'buy' && planAssetIds.has(mv.assetId) && mv.date.slice(0, 7) === m)
      .map((mv) => toEur(mv.amount, currencyOf.get(mv.assetId) ?? 'EUR', fx)),
  );

  const savingsAsset = strategy.savingsAssetId ? assetById.get(strategy.savingsAssetId) : undefined;
  const balanceEur = savingsAsset?.valueEur ?? 0;
  const { reservedEur, freeEur: savingsFreeEur } = reservedAndFree(balanceEur, toInvest);

  const splitLines = validated ? monthLines : (proposal ?? []);
  const splitOf = (id: string | undefined) => sum(splitLines.filter((l) => id !== undefined && l.assetId === id).map((l) => l.amount));

  return {
    asOf: today, lastSyncOk, stale, fx, strategy, demo: i.demo ?? false,
    totals: { grossEur, debtsEur, netEur },
    variations,
    history: snapshots.map((s) => ({ date: s.date, netEur: s.netEur })),
    byClass, assets, debts, topPerformers,
    metals: {
      gold, silver, ratio, zone, alert: ratioAlert(snapshots, strategy.metalGrid),
      ratioHistory: ratioHistoryFrom(i.series), purchases,
      monthSplit: { goldEur: splitOf(strategy.goldAssetId), silverEur: splitOf(strategy.silverAssetId) },
      gridWarning,
    },
    budget,
    plan: {
      month, validated, proposal, allocationError, lines,
      investedEur: investedIn(month),
      pendingEur: sum(lines.filter((l) => l.status === 'pending').map((l) => l.toInvestEur)),
      freeEur: budget.freeEur,
      savings: { balanceEur, reservedEur, freeEur: savingsFreeEur },
      history6: monthsBetween(shiftMonth(month, -5), month).map((m) => ({
        month: m, savedEur: budget.savingsEur, investedEur: investedIn(m),
      })),
    },
  };
}
