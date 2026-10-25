'use server';

import { revalidateNotion } from '@/lib/cacheTags';
import { getRepo } from '@/notion';
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
  const res = await reorderBudgetWith(getRepo(), ids);
  if (res.ok) revalidateNotion('budget');
  return res;
}
