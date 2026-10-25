'use server';

import { revalidateTag } from 'next/cache';
import type { AllocationLine } from '@/domain/types';
import { getRepo } from '@/notion';
import type { Repo } from '@/notion/repo';

export type ActionResult = { ok: true } | { ok: false; error: string };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGINS = new Set(['fixe', 'cible', 'signal']);
const METALS = 'Métaux précieux';

const fail = (error: string): ActionResult => ({ ok: false, error });
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Erreur inconnue');

/** Écrit les lignes du plan du mois ; refuse si le mois est déjà validé. */
export async function validatePlanWith(repo: Repo, month: string, lines: AllocationLine[]): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return fail('Mois invalide');
  if (!Array.isArray(lines) || lines.length === 0) return fail('Aucune ligne à valider');
  for (const l of lines) {
    if (!l || typeof l.assetId !== 'string' || !ORIGINS.has(l.origin)) return fail('Ligne de plan invalide');
    if (!Number.isFinite(l.amount) || l.amount < 0) return fail('Montant invalide');
  }
  try {
    const existing = await repo.listPlan();
    if (existing.some((l) => l.month === month)) return fail(`Plan déjà validé pour ${month}`);
    await repo.createPlanLines(lines.map((l) => ({ month, assetId: l.assetId, amount: l.amount, origin: l.origin })));
    revalidateTag('notion');
    return { ok: true };
  } catch (e) {
    return fail(messageOf(e));
  }
}

/**
 * Déclare l'achat d'un actif du plan : crée un mouvement lié au mois.
 * Pour les métaux, `fineGrams` (poids fin, > 0) devient la quantité.
 */
export async function declarePurchaseWith(
  repo: Repo, assetId: string, month: string, amountEur: number, date: string, fineGrams?: number,
): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return fail('Mois invalide');
  if (!DATE_RE.test(date)) return fail('Date invalide');
  if (!Number.isFinite(amountEur) || amountEur <= 0) return fail('Le montant doit être supérieur à 0');
  try {
    const asset = (await repo.listAssets()).find((a) => a.id === assetId);
    if (!asset) return fail('Actif introuvable');
    let quantity = 0;
    if (asset.assetClass === METALS) {
      if (fineGrams === undefined || !Number.isFinite(fineGrams) || fineGrams <= 0) {
        return fail('Poids fin requis pour un métal précieux');
      }
      quantity = fineGrams;
    }
    await repo.createMovement({
      assetId, date, kind: 'buy', label: `Plan ${month}`, planMonth: month, quantity, amount: amountEur,
    });
    revalidateTag('notion');
    return { ok: true };
  } catch (e) {
    return fail(messageOf(e));
  }
}

export async function validatePlan(month: string, lines: AllocationLine[]): Promise<ActionResult> {
  return validatePlanWith(getRepo(), month, lines);
}

export async function declarePurchase(
  assetId: string, month: string, amountEur: number, date: string, fineGrams?: number,
): Promise<ActionResult> {
  return declarePurchaseWith(getRepo(), assetId, month, amountEur, date, fineGrams);
}
