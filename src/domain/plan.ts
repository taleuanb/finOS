import { monthsBetween } from './dates';
import { toEur } from './money';
import type { Asset, FxRates, Movement, PlanLine } from './types';

/** Montant d'un mouvement en €, selon la devise de son actif (0 si l'actif est inconnu). */
function movementEur(m: Movement, assetById: Map<string, Asset>, fx: FxRates): number {
  const asset = assetById.get(m.assetId);
  return asset ? toEur(m.amount, asset.currency, fx) : 0;
}

/**
 * « À investir » par actif jusqu'à uptoMonth inclus (spec 5.4) :
 * Σ des montants prévus − Σ des achats depuis le premier mois du plan de l'actif, minimum 0.
 * Les actifs sans ligne de plan jusqu'à uptoMonth sont absents de la Map.
 */
export function toInvestByAsset(
  plan: PlanLine[], movements: Movement[], assets: Asset[], fx: FxRates, uptoMonth: string,
): Map<string, number> {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const planned = new Map<string, { start: string; total: number }>();
  for (const l of plan) {
    if (l.month > uptoMonth) continue;
    const cur = planned.get(l.assetId);
    if (cur) {
      cur.total += l.amount;
      if (l.month < cur.start) cur.start = l.month;
    } else {
      planned.set(l.assetId, { start: l.month, total: l.amount });
    }
  }

  const bought = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== 'buy') continue;
    const p = planned.get(m.assetId);
    if (!p) continue;
    const month = m.date.slice(0, 7);
    if (month < p.start || month > uptoMonth) continue;
    bought.set(m.assetId, (bought.get(m.assetId) ?? 0) + movementEur(m, assetById, fx));
  }

  const out = new Map<string, number>();
  for (const [assetId, p] of planned) {
    out.set(assetId, Math.max(0, p.total - (bought.get(assetId) ?? 0)));
  }
  return out;
}

/** « Déclaré » si les achats jusqu'à la fin du mois couvrent le cumul prévu, sinon « En attente ». */
export function monthStatus(
  assetId: string, month: string, plan: PlanLine[], movements: Movement[], assets: Asset[], fx: FxRates,
): 'declared' | 'pending' {
  return toInvestByAsset(plan, movements, assets, fx, month).get(assetId) === 0 ? 'declared' : 'pending';
}

/** Nombre de mois de plan cumulés dans le montant à investir. */
export function monthsAccrued(toInvest: number, plannedThisMonth: number): number {
  return plannedThisMonth <= 0 ? 0 : Math.round(toInvest / plannedThisMonth);
}

/**
 * Solde estimé de l'Épargne : dernière saisie manuelle + épargne mensuelle pour chaque 1er du mois d
 * tel que manualDate < d ≤ today − achats d'actifs du plan datés dans ]manualDate, today].
 */
export function estimatedSavingsBalance(i: {
  manualValueEur: number; manualDate: string; monthlySavingsEur: number;
  movements: Movement[]; plan: PlanLine[]; assets: Asset[]; fx: FxRates; today: string;
}): number {
  const firsts = monthsBetween(i.manualDate.slice(0, 7), i.today.slice(0, 7))
    .map((m) => `${m}-01`)
    .filter((d) => d > i.manualDate && d <= i.today);

  const assetById = new Map(i.assets.map((a) => [a.id, a]));
  const planAssetIds = new Set(i.plan.map((l) => l.assetId));
  let purchases = 0;
  for (const m of i.movements) {
    if (m.kind !== 'buy' || !planAssetIds.has(m.assetId)) continue;
    if (m.date <= i.manualDate || m.date > i.today) continue;
    purchases += movementEur(m, assetById, i.fx);
  }

  return i.manualValueEur + firsts.length * i.monthlySavingsEur - purchases;
}

/** Réservé au plan = Σ des montants à investir ; libre = solde estimé − réservé. */
export function reservedAndFree(
  balanceEur: number, toInvest: Map<string, number>,
): { reservedEur: number; freeEur: number } {
  let reservedEur = 0;
  for (const v of toInvest.values()) reservedEur += v;
  return { reservedEur, freeEur: balanceEur - reservedEur };
}
