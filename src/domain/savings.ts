import { summarizeBudget } from './budget';
import { toEur } from './money';
import { estimatedSavingsBalance } from './plan';
import type { Asset, BudgetLine, FxRates, Movement, PlanLine, Strategy } from './types';

/**
 * Solde estimé de l'actif Épargne, en € (spec §5.4) : dernière saisie manuelle + épargne du mois à chaque
 * 1er du mois − achats du plan. Sans date de saisie : la valeur manuelle convertie.
 * Partagé par la synchro et le tableau de bord pour qu'ils ne divergent jamais.
 */
export function savingsBalanceEur(i: {
  asset: Asset; budget: BudgetLine[]; strategy: Strategy; movements: Movement[]; plan: PlanLine[];
  assets: Asset[]; fx: FxRates; today: string;
}): number {
  const manualValueEur = toEur(i.asset.manualValue ?? 0, i.asset.currency, i.fx);
  if (!i.asset.manualValueDate) return manualValueEur;
  return estimatedSavingsBalance({
    manualValueEur, manualDate: i.asset.manualValueDate,
    monthlySavingsEur: summarizeBudget(i.budget, i.fx, i.strategy.monthlyInvest).savingsEur,
    movements: i.movements, plan: i.plan, assets: i.assets, fx: i.fx, today: i.today,
  });
}
