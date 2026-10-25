import { formatMoney } from './money';
import { AllocationError } from './types';
import type { AllocationLine, Asset, AssetClass, Strategy } from './types';
import { neutralZone, zoneFor } from './zones';

export interface AllocateInput {
  amount: number;
  months?: 1 | 12;
  assets: Asset[];
  strategy: Strategy;
  ratio: number | null;
}

const METALS: AssetClass = 'Métaux précieux';
const FIXED_REASON = 'Versement fixe programmé';

interface Share { assetId: string; raw: number; origin: AllocationLine['origin']; reason: string }

/** Arrondi à l'euro par la méthode du plus grand reste : la somme des parts vaut `total`. */
function roundLargestRemainder(raws: number[], total: number): number[] {
  const floors = raws.map((r) => Math.floor(r));
  let missing = total - floors.reduce((s, f) => s + f, 0);
  const order = raws
    .map((r, i) => ({ i, rem: r - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; missing > 0 && order.length > 0; k = (k + 1) % order.length, missing--) floors[order[k].i] += 1;
  return floors;
}

/**
 * Répartition d'un apport sans vente (spec §5.5) : versements fixes d'abord, puis le reste
 * va aux classes en retard sur leur cible ; le surplus éventuel suit les cibles.
 */
export function allocate(input: AllocateInput): AllocationLine[] {
  const { amount: M, assets, strategy, ratio } = input;
  const months = input.months ?? 1;
  const active = assets.filter((a) => !a.archived);
  const byId = new Map(active.map((a) => [a.id, a]));

  // Étape 1 : versements fixes, plafonnés au montant restant.
  const fixedLines: AllocationLine[] = [];
  let fixedTotal = 0;
  for (const a of active) {
    if (!a.fixedMonthly || a.fixedMonthly <= 0) continue;
    const amt = Math.min(a.fixedMonthly * months, Math.max(0, M - fixedTotal));
    if (amt <= 0) continue;
    fixedTotal += amt;
    fixedLines.push({ assetId: a.id, amount: amt, origin: 'fixe', reason: FIXED_REASON });
  }
  const R = M - fixedTotal;

  // Étape 2 : écarts par classe pilotée.
  const classes = Object.keys(strategy.targets) as AssetClass[];
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

  const rounded = roundLargestRemainder(shares.map((s) => s.raw), shares.length > 0 ? Math.round(R) : 0);

  // Une ligne par actif : un actif à versement fixe qui est aussi actif principal cumule ses montants.
  const lines = new Map<string, AllocationLine>();
  for (const l of fixedLines) lines.set(l.assetId, { ...l });
  shares.forEach((s, i) => {
    if (rounded[i] <= 0) return;
    const existing = lines.get(s.assetId);
    if (existing) {
      existing.amount += rounded[i];
      existing.reason = `${existing.reason} · ${s.reason}`;
    } else {
      lines.set(s.assetId, { assetId: s.assetId, amount: rounded[i], origin: s.origin, reason: s.reason });
    }
  });
  return [...lines.values()];
}
