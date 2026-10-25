import type {
  Asset, AssetInput, BudgetLine, Debt, DebtInput, Movement, PlanLine, Snapshot, Strategy, StrategyEntryInput,
} from '@/domain/types';
import { strategyFromRows, strategyToRows, type StrategyRow } from './mappers';
import type { Repo } from './repo';
import { fixtureSeed, type FakeSeed } from './seed';

export { fixtureSeed };
export type { FakeSeed };

const copy = <T>(v: T): T => structuredClone(v);

type Patch<T> = { [K in keyof T]?: T[K] | null };

/**
 * Applique un patch comme Notion : clé absente ou `undefined` = inchangé, `null` = champ optionnel supprimé,
 * `null` sur un champ obligatoire = ignoré.
 */
function applyPatch<T extends object>(target: T, patch: Patch<T>, required: readonly (keyof T)[]): void {
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) {
      if (!required.includes(k as keyof T)) delete t[k];
    } else {
      t[k] = copy(v);
    }
  }
}

const ASSET_REQUIRED = ['name', 'assetClass', 'currency', 'mode'] as const;
const DEBT_REQUIRED = ['name', 'currency', 'outstanding'] as const;

/** Repo en mémoire, mutable. L'état initial est cloné : le seed n'est jamais modifié. */
export class FakeRepo implements Repo {
  private assets: Asset[] = [];
  private movements: Movement[] = [];
  private debts: Debt[] = [];
  private budget: BudgetLine[] = [];
  private strategy: Strategy;
  private plan: PlanLine[] = [];
  private snapshots: Snapshot[] = [];
  private strategyRows: StrategyRow[] | null = null; // matérialisé à la première écriture Stratégie
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

  async createAsset(a: AssetInput) {
    const id = this.nextId('asset');
    const asset: Asset = { quantity: 0, costBasis: 0, archived: false, id, name: a.name, assetClass: a.assetClass, currency: a.currency, mode: a.mode };
    applyPatch<Asset>(asset, a, ASSET_REQUIRED);
    this.assets.push(asset);
    return id;
  }

  async updateAsset(id: string, patch: Patch<AssetInput>) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new Error(`Actif introuvable : ${id}`);
    const { archived, ...rest } = patch;
    applyPatch<Asset>(a, rest, ASSET_REQUIRED);
    if (archived !== undefined) a.archived = archived === true;
  }

  async createDebt(d: DebtInput) {
    const id = this.nextId('debt');
    const debt: Debt = { id, name: d.name, currency: d.currency, outstanding: d.outstanding };
    applyPatch<Debt>(debt, d, DEBT_REQUIRED);
    this.debts.push(debt);
    return id;
  }

  async updateDebt(id: string, patch: Patch<DebtInput>) {
    const d = this.debts.find((x) => x.id === id);
    if (!d) throw new Error(`Crédit introuvable : ${id}`);
    applyPatch<Debt>(d, patch, DEBT_REQUIRED);
  }

  async deleteDebt(id: string) {
    if (!this.debts.some((x) => x.id === id)) throw new Error(`Crédit introuvable : ${id}`);
    this.debts = this.debts.filter((x) => x.id !== id);
  }

  private rows(): StrategyRow[] {
    return (this.strategyRows ??= strategyToRows(this.strategy));
  }

  async setStrategyEntry(e: StrategyEntryInput) {
    const rows = this.rows();
    let row = rows.find((r) => r.key === e.key);
    if (!row) { row = { key: e.key }; rows.push(row); }
    if (e.value !== undefined) { if (e.value === null) delete row.value; else row.value = e.value; }
    if (e.text !== undefined) { if (!e.text) delete row.text; else row.text = e.text; }
    if (e.assetId !== undefined) { if (!e.assetId) delete row.assetId; else row.assetId = e.assetId; }
    this.strategy = strategyFromRows(rows);
  }

  async deleteStrategyEntry(key: string) {
    const rows = this.rows();
    if (!rows.some((r) => r.key === key)) return;
    this.strategyRows = rows.filter((r) => r.key !== key);
    this.strategy = strategyFromRows(this.strategyRows);
  }
}
