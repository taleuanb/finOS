'use server';

import { revalidateTag } from 'next/cache';
import type { AllocationLine } from '@/domain/types';
import { getRepo } from '@/notion';
import { declarePurchaseWith, validatePlanWith, type ActionResult } from './planOps';

// Fichier 'use server' : uniquement de fines enveloppes ; la logique est dans planOps.ts.

export async function validatePlan(month: string, lines: AllocationLine[]): Promise<ActionResult> {
  const res = await validatePlanWith(getRepo(), month, lines);
  if (res.ok) revalidateTag('notion');
  return res;
}

export async function declarePurchase(
  assetId: string, month: string, amount: number, date: string, fineGrams?: number,
): Promise<ActionResult> {
  const res = await declarePurchaseWith(getRepo(), assetId, month, amount, date, fineGrams);
  if (res.ok) revalidateTag('notion');
  return res;
}
