import { ASSET_CLASSES, type Asset, type AssetClass } from '@/domain/types';
import type { Repo } from '@/notion/repo';
import { STRATEGY_KEY } from '@/notion/schema';

// Module ordinaire (hors 'use server') : ces fonctions ne sont pas exposées comme actions serveur.
// Elles n'invalident aucun cache : c'est le rôle de `actions.ts`, seulement en cas de succès.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Classes que le plan peut piloter par une cible (les autres ne sont pas investissables par le plan). */
export const PILOTABLE_CLASSES: readonly AssetClass[] = ASSET_CLASSES.filter(
  (c) => c !== 'Épargne' && c !== 'Comptes courants' && c !== 'Immobilier' && c !== 'Autres',
);

const METALS: AssetClass = 'Métaux précieux';
const SAVINGS: AssetClass = 'Épargne';
const MAX_MONTHLY_INVEST = 1_000_000;
const MAX_BOUND = 100_000;
const MIN_ZONES = 2;
const MAX_ZONES = 8;
const MAX_LABEL = 40;
const EPSILON = 1e-6;

const GENERIC_ERROR = "L'enregistrement a échoué. Réessaie dans un instant.";
const fail = (error: string): ActionResult => ({ ok: false, error });
const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Journalise l'erreur (jamais renvoyée au client) et renvoie le message générique. */
function failed(where: string, e: unknown): ActionResult {
  console.error(where, e);
  return fail(GENERIC_ERROR);
}

/** Actifs non archivés par identifiant. */
async function activeAssets(repo: Repo): Promise<Map<string, Asset>> {
  return new Map((await repo.listAssets()).filter((a) => !a.archived).map((a) => [a.id, a]));
}

export async function saveMonthlyInvestWith(repo: Repo, amount: number): Promise<ActionResult> {
  if (!isNum(amount) || amount < 0 || amount > MAX_MONTHLY_INVEST) return fail('Montant invalide');
  try {
    await repo.setStrategyEntry({ key: STRATEGY_KEY.monthlyInvest, value: round2(amount) });
    return { ok: true };
  } catch (e) {
    return failed('saveMonthlyInvest', e);
  }
}

/** `percent` null = supprime la cible (et son actif principal) ; sinon pourcentage 0..100. */
export async function saveTargetWith(
  repo: Repo, assetClass: AssetClass, percent: number | null, mainAssetId: string | null,
): Promise<ActionResult> {
  if (!PILOTABLE_CLASSES.includes(assetClass)) return fail('Classe invalide');
  const key = STRATEGY_KEY.targetPrefix + assetClass;
  try {
    if (percent === null) {
      await repo.deleteStrategyEntry(key);
      return { ok: true };
    }
    if (!isNum(percent) || percent < 0 || percent > 100) return fail('Pourcentage invalide');
    const main = typeof mainAssetId === 'string' && mainAssetId ? mainAssetId : null;

    if (main !== null) {
      if (assetClass === METALS) return fail('Pas d’actif principal pour les métaux précieux');
      const asset = (await activeAssets(repo)).get(main);
      if (!asset || asset.assetClass !== assetClass) return fail('Actif principal invalide pour cette classe');
    }

    const { targets } = await repo.getStrategy();
    const others = Object.entries(targets)
      .filter(([cls]) => cls !== assetClass)
      .reduce((sum, [, fraction]) => sum + (fraction ?? 0) * 100, 0);
    if (others + round2(percent) > 100 + EPSILON) return fail('La somme des cibles dépasse 100 %');

    await repo.setStrategyEntry({ key, value: round2(percent), assetId: main });
    return { ok: true };
  } catch (e) {
    return failed('saveTarget', e);
  }
}

type SpecialKey = 'goldAssetId' | 'silverAssetId' | 'savingsAssetId';
const SPECIALS: { prop: SpecialKey; key: string; cls: AssetClass; error: string }[] = [
  { prop: 'goldAssetId', key: STRATEGY_KEY.gold, cls: METALS, error: 'Actif or invalide' },
  { prop: 'silverAssetId', key: STRATEGY_KEY.silver, cls: METALS, error: 'Actif argent invalide' },
  { prop: 'savingsAssetId', key: STRATEGY_KEY.savings, cls: SAVINGS, error: 'Actif épargne invalide' },
];

/** Champ absent = inchangé ; `null` = supprime le réglage ; sinon identifiant vérifié (existant, actif, bonne classe). */
export async function saveSpecialAssetsWith(
  repo: Repo, p: { goldAssetId?: string | null; silverAssetId?: string | null; savingsAssetId?: string | null },
): Promise<ActionResult> {
  const input = (p ?? {}) as Record<string, unknown>;
  const requested = SPECIALS.filter((s) => input[s.prop] !== undefined);
  if (requested.length === 0) return fail('Aucun réglage à enregistrer');
  try {
    const assets = await activeAssets(repo);
    for (const s of requested) {
      const id = input[s.prop];
      if (id === null) continue;
      const asset = typeof id === 'string' ? assets.get(id) : undefined;
      if (!asset || asset.assetClass !== s.cls) return fail(s.error);
    }
    for (const s of requested) {
      const id = input[s.prop];
      if (id === null) await repo.deleteStrategyEntry(s.key);
      else await repo.setStrategyEntry({ key: s.key, assetId: id as string });
    }
    return { ok: true };
  } catch (e) {
    return failed('saveSpecialAssets', e);
  }
}

export interface MetalGridZoneInput { label: string; min: number; max: number | null; goldPercent: number }

interface CleanZone { label: string; min: number; max: number | null; goldPercent: number }

function parseGrid(zones: unknown): { ok: true; zones: CleanZone[] } | { ok: false; error: string } {
  if (!Array.isArray(zones) || zones.length < MIN_ZONES || zones.length > MAX_ZONES) {
    return { ok: false, error: `La grille doit avoir entre ${MIN_ZONES} et ${MAX_ZONES} zones` };
  }
  const clean: CleanZone[] = [];
  const labels = new Set<string>();
  for (const raw of zones as Record<string, unknown>[]) {
    const z = raw ?? {};
    const label = typeof z.label === 'string' ? z.label.trim() : '';
    if (!label || label.length > MAX_LABEL) return { ok: false, error: 'Libellé de zone invalide' };
    if (labels.has(label.toLowerCase())) return { ok: false, error: 'Les libellés de zones doivent être uniques' };
    labels.add(label.toLowerCase());
    const maxOpen = z.max === null || z.max === undefined;
    if (!isNum(z.min) || z.min < 0 || z.min > MAX_BOUND || (!maxOpen && (!isNum(z.max) || z.max < 0 || z.max > MAX_BOUND))) {
      return { ok: false, error: 'Bornes invalides' };
    }
    if (!isNum(z.goldPercent) || z.goldPercent < 0 || z.goldPercent > 100) return { ok: false, error: 'Part d’or invalide' };
    clean.push({ label, min: round2(z.min), max: maxOpen ? null : round2(z.max as number), goldPercent: round2(z.goldPercent) });
  }

  if (clean[0].min !== 0) return { ok: false, error: 'La première zone doit commencer à 0' };
  for (const [i, z] of clean.entries()) {
    if (i > 0 && z.min !== clean[i - 1].max) return { ok: false, error: 'Les zones doivent se suivre sans trou ni recouvrement' };
    if (i === clean.length - 1) {
      if (z.max !== null) return { ok: false, error: 'La dernière zone doit rester ouverte (sans maximum)' };
    } else {
      if (z.max === null) return { ok: false, error: 'Chaque zone sauf la dernière doit avoir un maximum' };
      if (z.max <= z.min) return { ok: false, error: 'Chaque zone doit avoir un maximum supérieur à son minimum' };
    }
  }
  return { ok: true, zones: clean };
}

/** Remplace la grille : écrit les zones demandées puis supprime celles qui n'y figurent plus. */
export async function saveMetalGridWith(repo: Repo, zones: MetalGridZoneInput[]): Promise<ActionResult> {
  const parsed = parseGrid(zones);
  if (!parsed.ok) return fail(parsed.error);
  try {
    const { metalGrid, gridWarnings } = await repo.getStrategy();
    for (const z of parsed.zones) {
      await repo.setStrategyEntry({
        key: STRATEGY_KEY.zonePrefix + z.label,
        value: z.goldPercent,
        text: `${z.min}-${z.max ?? ''}`,
      });
    }
    const keep = new Set(parsed.zones.map((z) => z.label));
    const existing = [...metalGrid.map((z) => z.label), ...(gridWarnings ?? [])];
    for (const label of new Set(existing)) {
      if (!keep.has(label)) await repo.deleteStrategyEntry(STRATEGY_KEY.zonePrefix + label);
    }
    return { ok: true };
  } catch (e) {
    return failed('saveMetalGrid', e);
  }
}
