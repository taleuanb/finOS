import { describe, expect, it } from 'vitest';
import { positionFromMovements, withPositions } from './positions';
import type { Asset, Movement } from './types';

const mv = (id: string, assetId: string, kind: Movement['kind'], quantity: number, amount: number): Movement => ({
  id, label: id, date: '2026-01-01', assetId, kind, quantity, amount,
});
const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, name: id, assetClass: 'Fonds & ETF', currency: 'EUR', mode: 'auto', quantity: 0, costBasis: 0, archived: false, ...over,
});

describe('positionFromMovements', () => {
  it('somme signée : achats +, ventes −', () => {
    const movements = [mv('a', 'etf', 'buy', 10, 1000), mv('b', 'etf', 'buy', 5, 600), mv('c', 'etf', 'sell', 3, 400), mv('d', 'x', 'buy', 1, 1)];
    expect(positionFromMovements(movements, 'etf')).toEqual({ quantity: 12, costBasis: 1200 });
  });

  it('au-delà de 25 mouvements (limite des rollups Notion), tout est compté', () => {
    const movements = Array.from({ length: 40 }, (_, i) => mv(`m${i}`, 'etf', 'buy', 1, 100));
    expect(positionFromMovements(movements, 'etf')).toEqual({ quantity: 40, costBasis: 4000 });
  });

  it('élimine le bruit des flottants', () => {
    const movements = [mv('a', 'etf', 'buy', 583.74, 1), mv('b', 'etf', 'buy', 8.13, 1), mv('c', 'etf', 'buy', 8.13, 1)];
    expect(positionFromMovements(movements, 'etf')!.quantity).toBe(600);
  });

  it('null sans mouvement', () => {
    expect(positionFromMovements([mv('a', 'x', 'buy', 1, 1)], 'etf')).toBeNull();
  });
});

describe('withPositions', () => {
  it('remplace quantité et prix de revient des actifs qui ont des mouvements, garde les autres', () => {
    const assets = [asset('etf', { quantity: 25, costBasis: 2500 }), asset('maison', { mode: 'manual', quantity: 1, costBasis: 90_000 })];
    const movements = Array.from({ length: 30 }, (_, i) => mv(`m${i}`, 'etf', 'buy', 1, 100));
    const out = withPositions(assets, movements);
    expect(out[0]).toMatchObject({ id: 'etf', quantity: 30, costBasis: 3000 });
    expect(out[1]).toMatchObject({ id: 'maison', quantity: 1, costBasis: 90_000 });
    expect(assets[0].quantity).toBe(25); // pas de mutation
  });
});
