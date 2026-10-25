import type {
  Asset, AssetInput, AssetUpdate, BudgetLine, Debt, DebtInput, Movement, PlanLine, Snapshot, Strategy, StrategyEntryInput,
} from '@/domain/types';

/** Accès aux données (Notion en production, FakeRepo en test). */
export interface Repo {
  listAssets(): Promise<Asset[]>;
  listMovements(): Promise<Movement[]>;
  listDebts(): Promise<Debt[]>;
  listBudget(): Promise<BudgetLine[]>;
  getStrategy(): Promise<Strategy>;
  listPlan(): Promise<PlanLine[]>;
  listSnapshots(sinceDate?: string): Promise<Snapshot[]>;
  updateAssetValuation(id: string, patch: { unitPrice?: number; value: number; valueEur: number; syncStatus: string; lastUpdate: string }): Promise<void>;
  setMovementSpot(id: string, spotEurPerKg: number): Promise<void>;
  upsertSnapshot(s: Snapshot): Promise<void>;
  createMovement(m: Omit<Movement, 'id'>): Promise<string>;
  upsertBudgetLine(l: Omit<BudgetLine, 'id'> & { id?: string }): Promise<string>;
  deleteBudgetLine(id: string): Promise<void>;
  createPlanLines(lines: PlanLine[]): Promise<void>;
  createAsset(a: AssetInput): Promise<string>;
  /** N'écrit que les clés présentes ; `null` efface un champ optionnel (`unitPrice: null` vide le cours unitaire). */
  updateAsset(id: string, patch: AssetUpdate): Promise<void>;
  createDebt(d: DebtInput): Promise<string>;
  updateDebt(id: string, patch: { [K in keyof DebtInput]?: DebtInput[K] | null }): Promise<void>;
  deleteDebt(id: string): Promise<void>;                  // corbeille Notion
  /** Upsert par clé (titre) ; `null` efface le champ ; absent = inchangé. */
  setStrategyEntry(e: StrategyEntryInput): Promise<void>;
  deleteStrategyEntry(key: string): Promise<void>;        // corbeille Notion ; sans effet si la clé n'existe pas
}
