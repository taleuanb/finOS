import type { Asset, Movement } from './types';

/** Arrondi à 1e-9 : supprime le bruit des sommes de flottants (583,74 + 8,13 + 8,13 = 600). */
const clean = (n: number) => Math.round(n * 1e9) / 1e9;

/**
 * Quantité et prix de revient d'un actif d'après ses mouvements (somme signée : achats +, ventes −),
 * dans la devise de l'actif. Calculé dans le code et non lu dans les rollups Notion, qui sont tronqués
 * au-delà de 25 relations. `null` si l'actif n'a aucun mouvement.
 */
export function positionFromMovements(movements: Movement[], assetId: string): { quantity: number; costBasis: number } | null {
  let quantity = 0;
  let costBasis = 0;
  let found = false;
  for (const m of movements) {
    if (m.assetId !== assetId) continue;
    found = true;
    const sign = m.kind === 'sell' ? -1 : 1;
    quantity += sign * m.quantity;
    costBasis += sign * m.amount;
  }
  return found ? { quantity: clean(quantity), costBasis: clean(costBasis) } : null;
}

/** Actifs dont quantité et prix de revient viennent des mouvements ; un actif sans mouvement garde les siens. */
export function withPositions(assets: Asset[], movements: Movement[]): Asset[] {
  return assets.map((a) => {
    const p = positionFromMovements(movements, a.id);
    return p ? { ...a, ...p } : a;
  });
}
