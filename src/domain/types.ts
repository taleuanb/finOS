// Contrats partagés du domaine. Toutes les tâches en dépendent : ne pas renommer.

export type Currency = 'EUR' | 'MAD' | 'USD';
export type QuoteCurrency = Currency | 'GBP';

export type AssetClass =
  | 'Immobilier' | 'Autres' | 'Fonds & ETF' | 'PER' | 'Épargne' | 'Crypto'
  | 'Comptes courants' | 'Startups' | 'Métaux précieux' | 'Noms de domaine';

export const ASSET_CLASSES: AssetClass[] = [
  'Immobilier', 'Autres', 'Fonds & ETF', 'PER', 'Épargne', 'Crypto',
  'Comptes courants', 'Startups', 'Métaux précieux', 'Noms de domaine',
];

/** Classes que le plan peut piloter par une cible (les autres ne sont pas investissables par le plan). */
export const PILOTABLE_CLASSES: readonly AssetClass[] = ASSET_CLASSES.filter(
  (c) => c !== 'Épargne' && c !== 'Comptes courants' && c !== 'Immobilier' && c !== 'Autres',
);

export interface FxRates { date: string; EUR: 1; MAD: number; USD: number; GBP: number }

export interface Asset {
  id: string; name: string; assetClass: AssetClass; subtype?: string; institution?: string;
  currency: Currency; mode: 'auto' | 'manual'; quoteId?: string;
  manualValue?: number; manualValueDate?: string;         // devise de l'actif, ISO yyyy-mm-dd
  quantity: number; costBasis: number;                     // issus des mouvements (withPositions), 0 à la lecture ; métaux : grammes fins
  unitPrice?: number; value?: number; valueEur?: number;   // (script)
  fixedMonthly?: number; archived: boolean; syncStatus?: string; lastUpdate?: string;
}

export interface Movement {
  id: string; label: string; date: string; assetId: string; kind: 'buy' | 'sell';
  nature?: string; quantity: number; amount: number;       // amount : devise de l'actif
  spotEurPerKg?: number; planMonth?: string;               // 'AAAA-MM'
}

export interface Debt {
  id: string; name: string; type?: string; currency: Currency; outstanding: number;
  rate?: number; monthly?: number; endDate?: string; financedAssetId?: string; valueEur?: number;
}

/** Saisie d'un actif depuis l'app (jamais les champs rollups / formules / « script »). */
export interface AssetInput {
  name: string; assetClass: AssetClass; subtype?: string; institution?: string;
  currency: Currency; mode: 'auto' | 'manual'; quoteId?: string;
  manualValue?: number; manualValueDate?: string;      // yyyy-mm-dd
  fixedMonthly?: number; archived?: boolean;
}

/**
 * Modification d'un actif : `null` efface un champ optionnel. `unitPrice: null` vide « Cours unitaire » (écrit par la
 * synchro, jamais saisi) quand la classe, la cotation ou le mode change : l'ancien cours serait lu dans une autre unité.
 */
export type AssetUpdate = { [K in keyof AssetInput]?: AssetInput[K] | null } & { unitPrice?: null };

/** Saisie d'un crédit depuis l'app (la valeur € est calculée ailleurs). */
export interface DebtInput {
  name: string; type?: string; currency: Currency; outstanding: number;
  rate?: number; monthly?: number; endDate?: string; financedAssetId?: string;
}

/** Écriture d'une ligne clé/valeur de la base Stratégie. */
export interface StrategyEntryInput { key: string; value?: number | null; text?: string | null; assetId?: string | null }

export interface BudgetLine {
  id: string; name: string; section: 'revenu' | 'depense'; category: string;
  monthlyAmount: number; currency: Currency; order: number;
}

export interface MetalZone { label: string; min: number; max: number; goldShare: number } // [min, max)

export interface Strategy {
  targets: Partial<Record<AssetClass, number>>;            // fractions 0..1
  mainAssetByClass: Partial<Record<AssetClass, string>>;   // assetId
  goldAssetId?: string; silverAssetId?: string; savingsAssetId?: string;
  monthlyInvest: number; metalGrid: MetalZone[]; displayCurrency: Currency;
  gridWarnings?: string[];                                  // libellés des lignes zone: illisibles
}

export interface PlanLine { id?: string; month: string; assetId: string; amount: number; origin: 'fixe' | 'cible' | 'signal' }

export interface Snapshot {
  date: string; totalAssetsEur: number; totalDebtsEur: number; netEur: number;
  byClass: Record<AssetClass, number>; goldSilverRatio: number | null; eurMad: number; eurUsd: number; partial: boolean;
}

export interface Quote { id: string; price: number; currency: QuoteCurrency }
export interface PriceProvider { getQuotes(ids: string[]): Promise<Map<string, Quote | Error>> }
export interface HistoricalPriceProvider {
  getCloseOn(id: string, date: string): Promise<number>;                       // dernier cours ≤ date
  getSeries(id: string, range: '5y', interval: '1wk'): Promise<{ date: string; close: number }[]>;
}
export interface FxProvider { getRates(): Promise<FxRates> }

export interface AllocationLine { assetId: string; amount: number; origin: PlanLine['origin']; reason: string }
export class AllocationError extends Error {}

export interface BudgetSummary {
  incomeEur: number; expensesEur: number; savingsEur: number; savingsRate: number;
  investEur: number; freeEur: number;
  byCategory: { category: string; section: BudgetLine['section']; totalEur: number }[];
}

// Spec §4.5
export const DEFAULT_METAL_GRID: MetalZone[] = [
  { label: 'Or bon marché', min: 0, max: 45, goldShare: 0.8 },
  { label: 'Penche or', min: 45, max: 50, goldShare: 0.65 },
  { label: 'Neutre', min: 50, max: 65, goldShare: 0.55 },
  { label: 'Penche argent', min: 65, max: 80, goldShare: 0.4 },
  { label: 'Argent bon marché', min: 80, max: Infinity, goldShare: 0.2 },
];
