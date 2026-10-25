import type {
  Asset, AssetClass, AllocationLine, BudgetLine, BudgetSummary, Debt, FxRates, MetalZone, PlanLine, Strategy,
} from '@/domain/types';

export interface ValuedAsset extends Asset { value: number; valueEur: number; gainAbs: number | null; gainPct: number | null; stale: boolean }

export interface MetalPosition {
  assetId: string; grams: number; valueEur: number; costEur: number;
  avgCostPerKg: number; spotEurPerKg: number; avgPremium: number | null; gainPct: number;
}

export interface MetalPurchaseView {
  movementId: string; date: string; label: string; nature?: string;
  metal: 'gold' | 'silver'; fineGrams: number; amountEur: number; spotEurPerKg: number | null; premium: number | null;
}

export interface PlanLineView {
  assetId: string; assetName: string; plannedEur: number; origin: PlanLine['origin'];
  reason: string; toInvestEur: number; monthsAccrued: number; status: 'declared' | 'pending';
}

export type Period = '1M' | 'YTD' | '1A' | 'Tout';

export interface Dashboard {
  asOf: string; lastSyncOk: string | null; stale: boolean; fx: FxRates; strategy: Strategy;
  totals: { grossEur: number; debtsEur: number; netEur: number };
  variations: Record<Period, { abs: number; pct: number } | null>;
  history: { date: string; netEur: number }[];
  byClass: { assetClass: AssetClass; valueEur: number; pct: number }[];   // trié décroissant, sans les 0
  assets: ValuedAsset[]; debts: (Debt & { valueEur: number })[]; topPerformers: ValuedAsset[]; // 5 meilleurs gainPct
  metals: {
    gold: MetalPosition | null; silver: MetalPosition | null; ratio: number | null; zone: MetalZone | null;
    alert: boolean; ratioHistory: { date: string; ratio: number }[]; purchases: MetalPurchaseView[];
    monthSplit: { goldEur: number; silverEur: number };
  };
  budget: BudgetSummary & { lines: BudgetLine[] };
  plan: {
    month: string; validated: boolean; proposal: AllocationLine[] | null; allocationError: string | null;
    lines: PlanLineView[]; investedEur: number; pendingEur: number; freeEur: number;
    savings: { balanceEur: number; reservedEur: number; freeEur: number };
    history6: { month: string; savedEur: number; investedEur: number }[];
  };
}
