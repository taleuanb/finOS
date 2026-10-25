import { convert, fromEur, toEur } from './money';
import { usdPerOzToEurPerKg } from './units';
import type { Asset, FxRates, Quote } from './types';

export interface Valuation { unitPrice?: number; value: number; valueEur: number }

/**
 * Valeur d'une position à un cours unitaire donné (convention du champ « Cours unitaire ») :
 * - métaux précieux : cours en €/kg, quantité en grammes fins → `valueEur` = q × cours / 1000 ;
 * - sinon : cours dans la devise de l'actif → `value` = q × cours.
 * Partagé par la synchro et le tableau de bord pour que totaux affichés et instantanés concordent.
 */
export function valueAtUnitPrice(a: Asset, unitPrice: number, fx: FxRates): Valuation {
  if (a.assetClass === 'Métaux précieux') {
    const valueEur = (a.quantity * unitPrice) / 1000;
    return { unitPrice, value: fromEur(valueEur, a.currency, fx), valueEur };
  }
  const value = a.quantity * unitPrice;
  return { unitPrice, value, valueEur: toEur(value, a.currency, fx) };
}

/**
 * Valorise un actif. `value` est dans la devise de l'actif, `valueEur` en euros.
 * - manuel : `manualValue` ;
 * - métaux précieux : cours USD/oz → €/kg, quantité en grammes fins ;
 * - sinon : quantité × cours converti dans la devise de l'actif ;
 * - auto sans cotation : quantité (issue des mouvements) × dernier cours connu (`a.unitPrice`) ;
 *   sans cours connu, dernière valeur connue (`a.value`), sinon 0.
 */
export function valueAsset(a: Asset, quote: Quote | undefined, fx: FxRates): Valuation {
  if (a.mode === 'manual') {
    const value = a.manualValue ?? 0;
    return { value, valueEur: toEur(value, a.currency, fx) };
  }
  if (!quote) {
    if (a.unitPrice !== undefined) return valueAtUnitPrice(a, a.unitPrice, fx);
    const value = a.value ?? 0;
    return { value, valueEur: toEur(value, a.currency, fx) };
  }
  if (a.assetClass === 'Métaux précieux') return valueAtUnitPrice(a, usdPerOzToEurPerKg(quote.price, fx), fx);
  return valueAtUnitPrice(a, convert(quote.price, quote.currency, a.currency, fx), fx);
}

/** Plus-value : montant absolu et fraction du coût de revient (null si coût nul). */
export function gain(value: number, costBasis: number): { abs: number; pct: number | null } {
  const abs = value - costBasis;
  return { abs, pct: costBasis > 0 ? abs / costBasis : null };
}
