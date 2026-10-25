import type { Asset, BudgetLine, Debt, Movement, PlanLine, Snapshot, Strategy } from '@/domain/types';

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
}
