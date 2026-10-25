import type { BudgetLine, Currency } from '@/domain/types';
import type { Repo } from '@/notion/repo';

/**
 * Logique des actions du budget, indépendante du dépôt réel (testée avec un FakeRepo).
 * Elle vit hors de `actions.ts` : un fichier 'use server' expose chacun de ses exports comme point d'entrée appelable.
 * L'invalidation du cache (`revalidateNotion('budget')`) est faite par `actions.ts`, seulement en cas de succès.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export type BudgetLineInput = Omit<BudgetLine, 'id'> & { id?: string };

const MAX_TEXT = 200;
const MAX_AMOUNT = 10_000_000;
const NOT_FOUND = 'Ligne introuvable';

const CURRENCIES: readonly Currency[] = ['EUR', 'MAD', 'USD'];

function parseLine(input: unknown): { ok: true; line: BudgetLineInput } | { ok: false; error: string } {
  const l = (input ?? {}) as Record<string, unknown>;
  const name = typeof l.name === 'string' ? l.name.trim() : '';
  const category = typeof l.category === 'string' ? l.category.trim() : '';
  if (!name || name.length > MAX_TEXT) return { ok: false, error: 'Nom requis' };
  if (!category || category.length > MAX_TEXT) return { ok: false, error: 'Catégorie requise' };
  if (l.section !== 'revenu' && l.section !== 'depense') return { ok: false, error: 'Section invalide' };
  if (typeof l.monthlyAmount !== 'number' || !Number.isFinite(l.monthlyAmount) || l.monthlyAmount < 0 || l.monthlyAmount > MAX_AMOUNT) {
    return { ok: false, error: 'Montant invalide' };
  }
  if (!CURRENCIES.includes(l.currency as Currency)) return { ok: false, error: 'Devise invalide' };
  const order = typeof l.order === 'number' && Number.isFinite(l.order) ? l.order : 0;
  const id = typeof l.id === 'string' && l.id ? l.id : undefined;
  return {
    ok: true,
    line: {
      ...(id ? { id } : {}),
      name, category, section: l.section, monthlyAmount: l.monthlyAmount, currency: l.currency as Currency, order,
    },
  };
}

async function isBudgetLine(repo: Repo, id: string): Promise<boolean> {
  return (await repo.listBudget()).some((l) => l.id === id);
}

export async function saveBudgetLineWith(repo: Repo, input: unknown): Promise<SaveResult> {
  const parsed = parseLine(input);
  if (!parsed.ok) return parsed;
  try {
    // L'id vient du client : il doit désigner une ligne de la base Budget, jamais une autre page Notion.
    if (parsed.line.id && !(await isBudgetLine(repo, parsed.line.id))) return { ok: false, error: NOT_FOUND };
    const id = await repo.upsertBudgetLine(parsed.line);
    return { ok: true, id };
  } catch (e) {
    console.error('saveBudgetLine', e);
    return { ok: false, error: "Enregistrement impossible, réessaie dans un instant." };
  }
}

export async function deleteBudgetLineWith(repo: Repo, id: unknown): Promise<ActionResult> {
  if (typeof id !== 'string' || !id) return { ok: false, error: NOT_FOUND };
  try {
    if (!(await isBudgetLine(repo, id))) return { ok: false, error: NOT_FOUND };
    await repo.deleteBudgetLine(id);
    return { ok: true };
  } catch (e) {
    console.error('deleteBudgetLine', e);
    return { ok: false, error: 'Suppression impossible, réessaie dans un instant.' };
  }
}

/** Écrit `order` = position dans `ids` pour chaque ligne existante dont l'ordre change. */
export async function reorderBudgetWith(repo: Repo, ids: unknown): Promise<ActionResult> {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) return { ok: false, error: 'Ordre invalide' };
  try {
    const byId = new Map((await repo.listBudget()).map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const [order, id] of (ids as string[]).entries()) {
      const line = byId.get(id);
      if (!line || seen.has(id)) continue;
      seen.add(id);
      if (line.order !== order) await repo.upsertBudgetLine({ ...line, order });
    }
    return { ok: true };
  } catch (e) {
    console.error('reorderBudget', e);
    return { ok: false, error: "Réorganisation impossible, réessaie dans un instant." };
  }
}
