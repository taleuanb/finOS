import { describe, expect, it } from 'vitest';
import { savingsBalanceEur } from './savings';
import type { Asset, BudgetLine, FxRates, Movement, PlanLine, Strategy } from './types';
import { DEFAULT_METAL_GRID } from './types';

const fx: FxRates = { date: '2026-11-10', EUR: 1, MAD: 10, USD: 1.1, GBP: 0.85 };
const savings: Asset = {
  id: 'epargne', name: 'Épargne', assetClass: 'Épargne', currency: 'MAD', mode: 'manual', quantity: 1, costBasis: 0,
  archived: false, manualValue: 100_000, manualValueDate: '2026-10-01', value: 100_000, valueEur: 10_000,
};
const etf: Asset = { id: 'etf', name: 'ETF', assetClass: 'Fonds & ETF', currency: 'EUR', mode: 'auto', quantity: 1, costBasis: 0, archived: false };
const budget: BudgetLine[] = [
  { id: 'r', name: 'Salaire', section: 'revenu', category: 'Activité', monthlyAmount: 3000, currency: 'EUR', order: 1 },
  { id: 'd', name: 'Loyer', section: 'depense', category: 'Logement', monthlyAmount: 1000, currency: 'EUR', order: 2 },
];
const strategy: Strategy = {
  targets: {}, mainAssetByClass: {}, savingsAssetId: 'epargne', monthlyInvest: 900, metalGrid: DEFAULT_METAL_GRID, displayCurrency: 'EUR',
};
const plan: PlanLine[] = [{ month: '2026-11', assetId: 'etf', amount: 500, origin: 'cible' }];
const buy: Movement = { id: 'b', label: 'b', date: '2026-11-05', assetId: 'etf', kind: 'buy', quantity: 1, amount: 400 };

describe('savingsBalanceEur', () => {
  it('saisie manuelle + épargne de chaque 1er du mois − achats du plan', () => {
    const v = savingsBalanceEur({ asset: savings, budget, strategy, movements: [buy], plan, assets: [savings, etf], fx, today: '2026-11-10' });
    expect(v).toBeCloseTo(10_000 + 2000 - 400, 9);
  });

  it('sans date de saisie : la valeur manuelle convertie', () => {
    const v = savingsBalanceEur({
      asset: { ...savings, manualValueDate: undefined }, budget, strategy, movements: [buy], plan, assets: [savings, etf], fx, today: '2026-11-10',
    });
    expect(v).toBe(10_000);
  });
});
