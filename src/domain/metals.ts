import type { MetalZone, Snapshot } from './types';
import { neutralZone, zoneFor } from './zones';

export { OZ_G, usdPerOzToEurPerKg } from './units';
export { neutralZone, zoneFor } from './zones';

/** Prime payée par rapport au spot : montant / (grammes fins × spot €/kg / 1000) − 1. */
export function premium(amountEur: number, fineGrams: number, spotEurPerKg: number): number {
  return amountEur / ((fineGrams / 1000) * spotEurPerKg) - 1;
}

/** Ratio or / argent (prix du kg d'or divisé par celui du kg d'argent). */
export function goldSilverRatio(goldEurPerKg: number, silverEurPerKg: number): number {
  return goldEurPerKg / silverEurPerKg;
}

/**
 * Coût moyen pondéré en devise/kg : somme des achats / somme des grammes achetés × 1000.
 * Les ventes et les achats sans poids fin connu (quantité ≤ 0) ne comptent pas ; 0 si aucun achat.
 */
export function averageCostPerKg(movs: { quantity: number; amount: number; kind: 'buy' | 'sell' }[]): number {
  let amount = 0;
  let grams = 0;
  for (const m of movs) {
    if (m.kind !== 'buy' || !(m.quantity > 0)) continue;
    amount += m.amount;
    grams += m.quantity;
  }
  return grams > 0 ? (amount / grams) * 1000 : 0;
}

const DAY_MS = 86_400_000;
const dayIndex = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * Vrai si les `days` derniers instantanés (triés par date) sont des jours consécutifs sans trou,
 * tous avec un ratio connu situé hors de la zone neutre.
 */
export function ratioAlert(snapshots: Snapshot[], grid: MetalZone[], days = 14): boolean {
  if (snapshots.length < days) return false;
  const window = [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
  const neutral = neutralZone(grid);
  for (let i = 0; i < window.length; i++) {
    const ratio = window[i].goldSilverRatio;
    if (ratio === null || zoneFor(ratio, grid) === neutral) return false;
    if (i > 0 && dayIndex(window[i].date) - dayIndex(window[i - 1].date) !== 1) return false;
  }
  return true;
}
