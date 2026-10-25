'use server';

import { getRepo } from '@/notion';
import {
  deleteBudgetLineWith, reorderBudgetWith, saveBudgetLineWith,
  type ActionResult, type BudgetLineInput, type SaveResult,
} from './budgetOps';

export async function saveBudgetLine(line: BudgetLineInput): Promise<SaveResult> {
  return saveBudgetLineWith(getRepo(), line);
}

export async function deleteBudgetLine(id: string): Promise<ActionResult> {
  return deleteBudgetLineWith(getRepo(), id);
}

export async function reorderBudget(ids: string[]): Promise<ActionResult> {
  return reorderBudgetWith(getRepo(), ids);
}
