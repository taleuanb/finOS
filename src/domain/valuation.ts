import { convert, fromEur, toEur } from './money';
import { usdPerOzToEurPerKg } from './units';
import type { Asset, FxRates, Quote } from './types';

export interface Valuation { unitPrice?: number; value: number; valueEur: number }

/**
 * Valorise un actif. `value` est dans la devise de l'actif, `valueEur` en euros.
 * - manuel : `manualValue` ;
 * - métaux précieux : cours USD/oz → €/kg, quantité en grammes fins ;
 * - sinon : quantité × cours converti dans la devise de l'actif ;
 * - auto sans cotation : dernière valeur connue (`a.value`), sinon 0.
 */
export function valueAsset(a: Asset, quote: Quote | undefined, fx: FxRates): Valuation {
  if (a.mode === 'manual') {
    const value = a.manualValue ?? 0;
    return { value, valueEur: toEur(value, a.currency, fx) };
  }
  if (!quote) {
    const value = a.value ?? 0;
    return { value, valueEur: toEur(value, a.currency, fx) };
  }
  if (a.assetClass === 'Métaux précieux') {
    const unitPrice = usdPerOzToEurPerKg(quote.price, fx); // €/kg
    const valueEur = (a.quantity * unitPrice) / 1000;
    return { unitPrice, value: fromEur(valueEur, a.currency, fx), valueEur };
  }
  const unitPrice = convert(quote.price, quote.currency, a.currency, fx);
  const value = a.quantity * unitPrice;
  return { unitPrice, value, valueEur: toEur(value, a.currency, fx) };
}

/** Plus-value : montant absolu et fraction du coût de revient (null si coût nul). */
export function gain(value: number, costBasis: number): { abs: number; pct: number | null } {
  const abs = value - costBasis;
  return { abs, pct: costBasis > 0 ? abs / costBasis : null };
}
