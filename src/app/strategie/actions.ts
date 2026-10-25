'use server';

import type { AssetClass } from '@/domain/types';
import { revalidateNotion } from '@/lib/cacheTags';
import { getRepo } from '@/notion';
import {
  saveMetalGridWith, saveMonthlyInvestWith, saveSpecialAssetsWith, saveTargetWith,
  type ActionResult, type MetalGridZoneInput,
} from './strategieOps';

// Fichier 'use server' : uniquement de fines enveloppes ; la logique est dans strategieOps.ts.
// Le cache de la base Stratégie n'est invalidé qu'en cas de succès.

export async function saveMonthlyInvest(amount: number): Promise<ActionResult> {
  const res = await saveMonthlyInvestWith(getRepo(), amount);
  if (res.ok) revalidateNotion('strategy');
  return res;
}

export async function saveTarget(assetClass: AssetClass, percent: number | null, mainAssetId: string | null): Promise<ActionResult> {
  const res = await saveTargetWith(getRepo(), assetClass, percent, mainAssetId);
  if (res.ok) revalidateNotion('strategy');
  return res;
}

export async function saveSpecialAssets(
  p: { goldAssetId?: string | null; silverAssetId?: string | null; savingsAssetId?: string | null },
): Promise<ActionResult> {
  const res = await saveSpecialAssetsWith(getRepo(), p);
  if (res.ok) revalidateNotion('strategy');
  return res;
}

export async function saveMetalGrid(zones: MetalGridZoneInput[]): Promise<ActionResult> {
  const res = await saveMetalGridWith(getRepo(), zones);
  if (res.ok) revalidateNotion('strategy');
  return res;
}
