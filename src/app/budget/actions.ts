'use server';

import { revalidateNotion } from '@/lib/cacheTags';
import { getRepo } from '@/notion';
import { trackWrites } from '@/notion/trackWrites';
import {
  deleteBudgetLineWith, reorderBudgetWith, saveBudgetLineWith,
  type ActionResult, type BudgetLineInput, type SaveResult,
} from './budgetOps';

// Fichier 'use server' : uniquement de fines enveloppes ; la logique est dans budgetOps.ts.

export async function saveBudgetLine(line: BudgetLineInput): Promise<SaveResult> {
  const res = await saveBudgetLineWith(getRepo(), line);
  if (res.ok) revalidateNotion('budget');
  return res;
}

export async function deleteBudgetLine(id: string): Promise<ActionResult> {
  const res = await deleteBudgetLineWith(getRepo(), id);
  if (res.ok) revalidateNotion('budget');
  return res;
}

export async function reorderBudget(ids: string[]): Promise<ActionResult> {
  // Une écriture par ligne déplacée : un échec en cours de route laisse un ordre partiel, à invalider aussi.
  const t = trackWrites(getRepo());
  const res = await reorderBudgetWith(t.repo, ids);
  if (res.ok || t.attempted()) revalidateNotion('budget');
  return res;
}
