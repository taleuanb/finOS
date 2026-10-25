import type { Asset, BudgetLine, Debt, Movement, PlanLine, Snapshot, Strategy } from '@/domain/types';
import type { Repo } from './repo';
import { fixtureSeed, type FakeSeed } from './seed';

export { fixtureSeed };
export type { FakeSeed };

const copy = <T>(v: T): T => structuredClone(v);

/** Repo en mémoire, mutable. L'état initial est cloné : le seed n'est jamais modifié. */
export class FakeRepo implements Repo {
  private assets: Asset[] = [];
  private movements: Movement[] = [];
  private debts: Debt[] = [];
  private budget: BudgetLine[] = [];
  private strategy: Strategy;
  private plan: PlanLine[] = [];
  private snapshots: Snapshot[] = [];
  private seq = 0;

  constructor(seed: Partial<FakeSeed> = {}) {
    this.assets = copy(seed.assets ?? []);
    this.movements = copy(seed.movements ?? []);
    this.debts = copy(seed.debts ?? []);
    this.budget = copy(seed.budget ?? []);
    this.plan = copy(seed.plan ?? []);
    this.snapshots = copy(seed.snapshots ?? []);
    this.strategy = copy(seed.strategy ?? { targets: {}, mainAssetByClass: {}, monthlyInvest: 0, metalGrid: [], displayCurrency: 'EUR' });
  }

  private nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  async listAssets() { return copy(this.assets); }
  async listMovements() { return copy(this.movements); }
  async listDebts() { return copy(this.debts); }
  async listBudget() { return copy(this.budget); }
  async getStrategy() { return copy(this.strategy); }
  async listPlan() { return copy(this.plan); }

  async listSnapshots(sinceDate?: string) {
    return copy(this.snapshots)
      .filter((s) => !sinceDate || s.date >= sinceDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async updateAssetValuation(id: string, patch: { unitPrice?: number; value: number; valueEur: number; syncStatus: string; lastUpdate: string }) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new Error(`Actif introuvable : ${id}`);
    Object.assign(a, patch);
  }

  async setMovementSpot(id: string, spotEurPerKg: number) {
    const m = this.movements.find((x) => x.id === id);
    if (!m) throw new Error(`Mouvement introuvable : ${id}`);
    m.spotEurPerKg = spotEurPerKg;
  }

  async upsertSnapshot(s: Snapshot) {
    const i = this.snapshots.findIndex((x) => x.date === s.date);
    if (i >= 0) this.snapshots[i] = copy(s);
    else this.snapshots.push(copy(s));
  }

  async createMovement(m: Omit<Movement, 'id'>) {
    const id = this.nextId('mv');
    this.movements.push({ ...copy(m), id });
    return id;
  }

  async upsertBudgetLine(l: Omit<BudgetLine, 'id'> & { id?: string }) {
    const i = l.id ? this.budget.findIndex((x) => x.id === l.id) : -1;
    if (i >= 0) {
      this.budget[i] = { ...copy(l), id: this.budget[i].id };
      return this.budget[i].id;
    }
    const id = l.id ?? this.nextId('bl');
    this.budget.push({ ...copy(l), id });
    return id;
  }

  async deleteBudgetLine(id: string) {
    this.budget = this.budget.filter((l) => l.id !== id);
  }

  async createPlanLines(lines: PlanLine[]) {
    for (const l of lines) this.plan.push({ ...copy(l), id: l.id ?? this.nextId('pl') });
  }
}
