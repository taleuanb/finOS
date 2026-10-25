'use server';

import type { AssetInput, DebtInput } from '@/domain/types';
import { revalidateNotion } from '@/lib/cacheTags';
import { getRepo } from '@/notion';
import {
  addMovementWith, archiveAssetWith, createAssetWith, createDebtWith, deleteDebtWith, updateAssetWith, updateDebtWith,
  type ActionResult, type AssetPatch, type DebtPatch, type MovementInput,
} from './patrimoineOps';

// Fichier 'use server' : uniquement de fines enveloppes ; la logique et la validation sont dans patrimoineOps.ts.
// Le cache n'est invalidé qu'en cas de succès.

export async function createAsset(input: AssetInput): Promise<ActionResult> {
  const res = await createAssetWith(getRepo(), input);
  if (res.ok) revalidateNotion('assets');
  return res;
}

export async function updateAsset(id: string, patch: AssetPatch): Promise<ActionResult> {
  const res = await updateAssetWith(getRepo(), id, patch);
  if (res.ok) revalidateNotion('assets');
  return res;
}

export async function archiveAsset(id: string, archived: boolean): Promise<ActionResult> {
  const res = await archiveAssetWith(getRepo(), id, archived);
  if (res.ok) revalidateNotion('assets');
  return res;
}

export async function addMovement(m: MovementInput): Promise<ActionResult> {
  const res = await addMovementWith(getRepo(), m);
  if (res.ok) revalidateNotion('movements', 'assets');
  return res;
}

export async function createDebt(input: DebtInput): Promise<ActionResult> {
  const res = await createDebtWith(getRepo(), input);
  if (res.ok) revalidateNotion('debts');
  return res;
}

export async function updateDebt(id: string, patch: DebtPatch): Promise<ActionResult> {
  const res = await updateDebtWith(getRepo(), id, patch);
  if (res.ok) revalidateNotion('debts');
  return res;
}

export async function deleteDebt(id: string): Promise<ActionResult> {
  const res = await deleteDebtWith(getRepo(), id);
  if (res.ok) revalidateNotion('debts');
  return res;
}
