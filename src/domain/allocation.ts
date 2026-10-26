import { formatMoney, toEur } from './money';
import { AllocationError, PILOTABLE_CLASSES } from './types';
import type { AllocationLine, Asset, AssetClass, FxRates, Strategy } from './types';
import { neutralZone, zoneFor } from './zones';

export interface AllocateInput {
  amount: number;
  months?: 1 | 12;
  assets: Asset[];
  strategy: Strategy;
  ratio: number | null;
  /** Taux du jour : les versements fixes sont saisis dans la devise de l'actif, le plan est en euros. */
  fx: FxRates;
}

const METALS: AssetClass = 'Métaux précieux';
const FIXED_REASON = 'Versement fixe programmé';

interface Share { assetId: string; raw: number; origin: AllocationLine['origin']; reason: string }

const toCents = (n: number) => Math.round(n * 100);

/** Entiers ≥ 0 proportionnels à `weights` dont la somme vaut `total` (méthode du plus grand reste). */
function largestRemainder(weights: number[], total: number): number[] {
  const w = weights.map((x) => Math.max(0, x));
  const sumW = w.reduce((s, x) => s + x, 0);
  if (total <= 0 || sumW <= 0) return w.map(() => 0);
  const exact = w.map((x) => (x * total) / sumW);
  const out = exact.map((x) => Math.floor(x));
  let missing = total - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, rem: x - out[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; missing > 0; k = (k + 1) % order.length, missing--) out[order[k].i] += 1;
  return out;
}

/**
 * Parts arrondies en centimes entiers dont la somme vaut exactement `totalCents`. Les parts restent à l'euro
 * près ; seuls les centimes du total (ex. M = 769,75 €) s'ajoutent aux parts dont le reste est le plus grand.
 */
function roundToCents(raws: number[], totalCents: number): number[] {
  const euros = largestRemainder(raws, Math.floor(totalCents / 100));
  const residual = totalCents - euros.reduce((s, e) => s + e, 0) * 100;
  const rest = raws.map((r, i) => r * 100 - euros[i] * 100);
  const extra = largestRemainder(rest.some((r) => r > 0) ? rest : raws, residual);
  return euros.map((e, i) => e * 100 + extra[i]);
}

/**
 * Répartition d'un apport sans vente (spec §5.5) : versements fixes d'abord, puis le reste
 * va aux classes en retard sur leur cible ; le surplus éventuel suit les cibles.
 */
export function allocate(input: AllocateInput): AllocationLine[] {
  const { amount: M, assets, strategy, ratio, fx } = input;
  const months = input.months ?? 1;
  const active = assets.filter((a) => !a.archived);
  const byId = new Map(active.map((a) => [a.id, a]));

  // Étape 1 : versements fixes (devise de l'actif, convertis en euros), plafonnés au montant restant.
  const fixedLines: AllocationLine[] = [];
  let fixedTotal = 0;
  for (const a of active) {
    if (!a.fixedMonthly || a.fixedMonthly <= 0) continue;
    const fixedEur = toEur(a.fixedMonthly * months, a.currency, fx);
    const amtCents = Math.min(toCents(fixedEur), Math.max(0, toCents(M) - toCents(fixedTotal)));
    if (amtCents <= 0) continue;
    const amt = amtCents / 100;
    fixedTotal = (toCents(fixedTotal) + amtCents) / 100;
    fixedLines.push({ assetId: a.id, amount: amt, origin: 'fixe', reason: FIXED_REASON });
  }
  const RCents = Math.max(0, toCents(M) - toCents(fixedTotal));
  const R = RCents / 100;

  // Étape 2 : écarts par classe pilotée. Une cible stockée sur une classe non pilotable (Épargne, Immobilier…)
  // est ignorée, comme l'annonce l'écran Stratégie.
  const classes = (Object.keys(strategy.targets) as AssetClass[]).filter((c) => PILOTABLE_CLASSES.includes(c));
  const fixedByClass = new Map<AssetClass, number>();
  for (const l of fixedLines) {
    const cls = byId.get(l.assetId)!.assetClass;
    fixedByClass.set(cls, (fixedByClass.get(cls) ?? 0) + l.amount);
  }
  const value = new Map<AssetClass, number>();
  for (const c of classes) {
    const held = active.filter((a) => a.assetClass === c).reduce((s, a) => s + (a.valueEur ?? 0), 0);
    value.set(c, held + (fixedByClass.get(c) ?? 0));
  }
  const attributedFixed = classes.reduce((s, c) => s + (fixedByClass.get(c) ?? 0), 0);
  const base = classes.reduce((s, c) => s + value.get(c)!, 0) - attributedFixed + M;

  const target = (c: AssetClass) => strategy.targets[c] ?? 0;
  const gap = new Map<AssetClass, number>();
  for (const c of classes) gap.set(c, Math.max(0, base * target(c) - value.get(c)!));
  const gapSum = [...gap.values()].reduce((s, g) => s + g, 0);
  const targetSum = classes.reduce((s, c) => s + target(c), 0);

  if (RCents > 0 && targetSum <= 0) throw new AllocationError('Aucune cible définie dans la Stratégie');

  const classShare = (c: AssetClass): number => {
    if (R <= 0) return 0;
    if (gapSum >= R) return gapSum > 0 ? (R * gap.get(c)!) / gapSum : 0;
    return gap.get(c)! + (targetSum > 0 ? ((R - gapSum) * target(c)) / targetSum : 0);
  };

  // Étape 3 : la part de la classe va à l'actif principal (ou à l'or/argent pour les métaux).
  const mainAsset = (id: string | undefined, cls: AssetClass): string => {
    if (!id || !byId.has(id)) throw new AllocationError(`Aucun actif principal pour la classe ${cls}`);
    return id;
  };

  const shares: Share[] = [];
  for (const c of classes) {
    const part = classShare(c);
    if (part <= 0) continue;
    if (c === METALS) {
      const zone = ratio === null ? neutralZone(strategy.metalGrid) : zoneFor(ratio, strategy.metalGrid);
      const gold = mainAsset(strategy.goldAssetId, c);
      const silver = mainAsset(strategy.silverAssetId, c);
      const goldPct = Math.round(zone.goldShare * 100);
      shares.push({
        assetId: gold, raw: part * zone.goldShare, origin: 'signal',
        reason: `${goldPct} % de la part métaux (zone ${zone.label})`,
      });
      shares.push({
        assetId: silver, raw: part * (1 - zone.goldShare), origin: 'signal',
        reason: `${100 - goldPct} % de la part métaux (zone ${zone.label})`,
      });
    } else {
      shares.push({
        assetId: mainAsset(strategy.mainAssetByClass[c], c), raw: part, origin: 'cible',
        reason: `Sous la cible de ${formatMoney(Math.round(gap.get(c)!), 'EUR')}`,
      });
    }
  }

  const rounded = roundToCents(shares.map((s) => s.raw), shares.length > 0 ? RCents : 0);

  // Une ligne par actif : un actif à versement fixe qui est aussi actif principal cumule ses montants.
  const lines = new Map<string, AllocationLine>();
  for (const l of fixedLines) lines.set(l.assetId, { ...l });
  shares.forEach((s, i) => {
    if (rounded[i] <= 0) return;
    const amount = rounded[i] / 100;
    const existing = lines.get(s.assetId);
    if (existing) {
      existing.amount = (toCents(existing.amount) + rounded[i]) / 100;
      existing.reason = `${existing.reason} · ${s.reason}`;
    } else {
      lines.set(s.assetId, { assetId: s.assetId, amount, origin: s.origin, reason: s.reason });
    }
  });
  return [...lines.values()];
}
