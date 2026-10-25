import { parisMonth } from '@/domain/dates';
import type { AllocationLine } from '@/domain/types';
import type { Repo } from '@/notion/repo';

// Module ordinaire (hors 'use server') : ces fonctions ne sont pas exposées comme actions serveur.

export type ActionResult = { ok: true } | { ok: false; error: string };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORIGINS = new Set(['fixe', 'cible', 'signal']);
const METALS = 'Métaux précieux';
const MAX_LINE_AMOUNT = 1_000_000;

const fail = (error: string): ActionResult => ({ ok: false, error });
const GENERIC_ERROR = "L'enregistrement a échoué. Réessaie dans un instant.";
const cents = (n: number) => Math.round(n * 100) / 100;

/** Vrai pour une date calendaire réelle 'AAAA-MM-JJ' (refuse 2026-13-45 et 2026-02-30). */
function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Écrit les lignes du plan du mois courant (Paris) ; refuse si le mois est déjà validé. */
export async function validatePlanWith(
  repo: Repo, month: string, lines: AllocationLine[], now: Date = new Date(),
): Promise<ActionResult> {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) return fail('Mois invalide');
  if (month !== parisMonth(now)) return fail('Le plan ne peut être validé que pour le mois en cours');
  if (!Array.isArray(lines) || lines.length === 0) return fail('Aucune ligne à valider');

  const seen = new Set<string>();
  let total = 0;
  for (const l of lines) {
    if (!l || typeof l.assetId !== 'string' || !ORIGINS.has(l.origin)) return fail('Ligne de plan invalide');
    if (typeof l.amount !== 'number' || !Number.isFinite(l.amount)) return fail('Montant invalide');
    const amount = cents(l.amount);
    if (amount <= 0 || amount > MAX_LINE_AMOUNT) return fail('Montant invalide');
    if (seen.has(l.assetId)) return fail('Un actif ne peut apparaître qu’une fois dans le plan');
    seen.add(l.assetId);
    total += amount;
  }
  if (total <= 0) return fail('Le plan est vide');

  try {
    const assets = await repo.listAssets();
    const active = new Set(assets.filter((a) => !a.archived).map((a) => a.id));
    if (lines.some((l) => !active.has(l.assetId))) return fail('Actif inconnu ou archivé');
    const existing = await repo.listPlan();
    if (existing.some((l) => l.month === month)) return fail(`Plan déjà validé pour ${month}`);
    await repo.createPlanLines(lines.map((l) => ({ month, assetId: l.assetId, amount: cents(l.amount), origin: l.origin })));
    return { ok: true };
  } catch {
    return fail(GENERIC_ERROR);
  }
}

/**
 * Déclare l'achat d'un actif du plan : crée un mouvement lié au mois.
 * `amount` est dans la devise de l'actif (comme Movement.amount). `quantity` : pour un métal, le poids fin
 * (> 0, requis) ; pour un actif coté (auto) hors métaux, le nombre de parts / tokens (≥ 0, facultatif :
 * 0 = à compléter dans Notion) ; ignorée pour un actif manuel.
 */
export async function declarePurchaseWith(
  repo: Repo, assetId: string, month: string, amount: number, date: string, quantity?: number,
): Promise<ActionResult> {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) return fail('Mois invalide');
  if (typeof date !== 'string' || !isRealDate(date)) return fail('Date invalide');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return fail('Le montant doit être supérieur à 0');
  try {
    const asset = (await repo.listAssets()).find((a) => a.id === assetId);
    if (!asset) return fail('Actif introuvable');
    let movementQuantity = 0;
    if (asset.assetClass === METALS) {
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        return fail('Poids fin requis pour un métal précieux');
      }
      movementQuantity = quantity;
    } else if (asset.mode === 'auto' && quantity !== undefined) {
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) return fail('Quantité invalide');
      movementQuantity = quantity;
    }
    await repo.createMovement({
      assetId, date, kind: 'buy', label: `Plan ${month}`, planMonth: month, quantity: movementQuantity, amount: cents(amount),
    });
    return { ok: true };
  } catch {
    return fail(GENERIC_ERROR);
  }
}
