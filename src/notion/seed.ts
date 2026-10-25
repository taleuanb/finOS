// Données des maquettes V2 (écrans Patrimoine, Budget, Épargne, Métaux).
// Servent de jeu de données au FakeRepo et de base à fixtureDashboard.
import type {
  Asset, AssetClass, BudgetLine, Debt, Movement, PlanLine, Snapshot, Strategy,
} from '@/domain/types';
import { ASSET_CLASSES, DEFAULT_METAL_GRID } from '@/domain/types';

export interface FakeSeed {
  assets: Asset[]; movements: Movement[]; debts: Debt[]; budget: BudgetLine[];
  strategy: Strategy; plan: PlanLine[]; snapshots: Snapshot[];
}

/** Taux de la maquette (unités par euro). */
export const FIXTURE_FX = { date: '2026-10-25', EUR: 1 as const, MAD: 10.85, USD: 1.08, GBP: 0.84 };

/** Prix de revient déduit de la valeur et de la performance (ex. +8,3 % → 0.083). */
const cost = (value: number, perf: number) => Math.round(value / (1 + perf));

const TODAY = '2026-10-25';
const manual = (a: Omit<Asset, 'mode' | 'archived' | 'quantity'> & { quantity?: number }): Asset => ({
  mode: 'manual', archived: false, quantity: 1, manualValueDate: '2026-10-01', syncStatus: 'manuel', lastUpdate: TODAY, ...a,
});

const toEurValue = (value: number, cur: Asset['currency']) => (cur === 'EUR' ? value : value / FIXTURE_FX[cur]);

function withValue(a: Asset, value: number): Asset {
  return { ...a, value, valueEur: toEurValue(value, a.currency) };
}

const assets: Asset[] = [
  // Immobilier (MAD)
  withValue(manual({ id: 'dar-sakan', name: 'Dar Sakan', assetClass: 'Immobilier', subtype: 'Résidence secondaire · Maroc', currency: 'MAD', manualValue: 1_200_000, costBasis: cost(1_200_000, 0.083) }), 1_200_000),
  withValue(manual({ id: 'lcd-kesh', name: 'LCD Kesh', assetClass: 'Immobilier', subtype: 'Bien locatif · Marrakech', currency: 'MAD', manualValue: 900_000, costBasis: 900_000 }), 900_000),
  withValue(manual({ id: 'terr-v-kesh', name: 'Terr V Kesh', assetClass: 'Immobilier', subtype: 'Terrain · Marrakech', currency: 'MAD', manualValue: 800_000, costBasis: cost(800_000, 0.071) }), 800_000),
  withValue(manual({ id: 'arouit', name: 'Terrain Arouit/Setout', assetClass: 'Immobilier', subtype: 'Terrain', currency: 'MAD', manualValue: 500_000, costBasis: cost(500_000, 0.25) }), 500_000),
  withValue(manual({ id: 'bab-tg', name: 'Bab Tg 4', assetClass: 'Immobilier', subtype: 'Résidence secondaire · Tanger', currency: 'MAD', manualValue: 400_000, costBasis: 400_000 }), 400_000),
  // Fonds & ETF
  withValue({
    id: 'hsbc', name: 'HSBC Islamic Global Equity', assetClass: 'Fonds & ETF', currency: 'EUR', mode: 'auto', quoteId: 'LU0806931092',
    manualValue: 22_140, manualValueDate: '2026-10-01', quantity: 600, costBasis: cost(22_140, 0.319), unitPrice: 36.9,
    archived: false, syncStatus: 'ok', lastUpdate: TODAY,
  }, 22_140),
  withValue({
    id: 'etf-revolut', name: 'ETF Revolut', assetClass: 'Fonds & ETF', institution: 'Revolut', currency: 'EUR', mode: 'auto', quoteId: 'IWDA.AS',
    quantity: 100, costBasis: cost(16_310, 0.124), unitPrice: 163.1, archived: false, syncStatus: 'ok', lastUpdate: TODAY,
  }, 16_310),
  // Autres
  withValue(manual({ id: 'akhdar', name: 'Akhdar', assetClass: 'Autres', currency: 'MAD', manualValue: 300_000, costBasis: 300_000 }), 300_000),
  // PER
  withValue(manual({ id: 'per', name: 'Pertinence Retraite (Suravenir)', assetClass: 'PER', institution: 'Suravenir', currency: 'EUR', manualValue: 21_300, costBasis: cost(21_300, 0.179), fixedMonthly: 100 }), 21_300),
  // Épargne (pas de prix de revient : le solde n'a pas de plus-value)
  withValue(manual({ id: 'epargne', name: 'Épargne (Banque Maroc)', assetClass: 'Épargne', institution: 'Banque Maroc', currency: 'MAD', manualValue: 160_000, costBasis: 0 }), 160_000),
  // Crypto
  withValue({
    id: 'crypto', name: 'Finary Crypto', assetClass: 'Crypto', institution: 'Finary', currency: 'EUR', mode: 'auto', quoteId: 'bitcoin',
    quantity: 0.1, costBasis: cost(9_870, -0.319), unitPrice: 98_700, archived: false, syncStatus: 'ok', lastUpdate: TODAY,
  }, 9_870),
  // Comptes courants
  withValue(manual({ id: 'lcl', name: 'Compte de dépôts (LCL)', assetClass: 'Comptes courants', institution: 'LCL', currency: 'EUR', manualValue: 4_200, costBasis: 0 }), 4_200),
  withValue(manual({ id: 'revolut', name: 'Revolut Current', assetClass: 'Comptes courants', institution: 'Revolut', currency: 'EUR', manualValue: 1_100, costBasis: 0 }), 1_100),
  // Startups
  withValue(manual({ id: 'syla', name: 'Syla Invest', assetClass: 'Startups', currency: 'EUR', manualValue: 2_000, costBasis: 2_000 }), 2_000),
  withValue(manual({ id: 'kunto', name: 'kunto', assetClass: 'Startups', currency: 'EUR', manualValue: 1_500, costBasis: 1_500 }), 1_500),
  withValue(manual({ id: 'fullsoon', name: 'Fullsoon', assetClass: 'Startups', currency: 'EUR', manualValue: 1_500, costBasis: 1_500 }), 1_500),
  // Métaux précieux (quantité en grammes fins ; valeurs arrondies comme sur la maquette)
  withValue({
    id: 'or', name: 'Or physique', assetClass: 'Métaux précieux', institution: 'Physique', currency: 'EUR', mode: 'auto', quoteId: 'XAU',
    quantity: 24.9, costBasis: 2_402, unitPrice: 125_926, archived: false, syncStatus: 'ok', lastUpdate: TODAY,
  }, 3_136),
  withValue({
    id: 'ag', name: 'Argent physique', assetClass: 'Métaux précieux', institution: 'Physique', currency: 'EUR', mode: 'auto', quoteId: 'XAG',
    quantity: 593.3, costBasis: 948, unitPrice: 1_952, archived: false, syncStatus: 'ok', lastUpdate: TODAY,
  }, 1_158),
  // Noms de domaine
  withValue(manual({ id: 'domaines', name: 'Portefeuille domaines', assetClass: 'Noms de domaine', currency: 'EUR', manualValue: 1_606, costBasis: cost(1_606, 0.338) }), 1_606),
];

const debts: Debt[] = [
  { id: 'credit-dar-sakan', name: 'Crédit Dar Sakan', type: 'Crédit immobilier', currency: 'MAD', outstanding: 600_000, financedAssetId: 'dar-sakan', valueEur: 600_000 / FIXTURE_FX.MAD },
];

const bl = (id: string, name: string, section: BudgetLine['section'], category: string, monthlyAmount: number, currency: BudgetLine['currency'], order: number): BudgetLine =>
  ({ id, name, section, category, monthlyAmount, currency, order });

const budget: BudgetLine[] = [
  bl('b-salaire', 'Salaire', 'revenu', 'Activité', 3200, 'EUR', 1),
  bl('b-loyer-lcd', 'Loyer LCD Kesh', 'revenu', 'Revenus locatifs', 4500, 'MAD', 2),
  bl('b-loyer', 'Loyer', 'depense', 'Logement', 900, 'EUR', 3),
  bl('b-charges', 'Charges', 'depense', 'Logement', 150, 'EUR', 4),
  bl('b-courses', 'Courses', 'depense', 'Vie quotidienne', 400, 'EUR', 5),
  bl('b-restaurants', 'Restaurants', 'depense', 'Vie quotidienne', 120, 'EUR', 6),
  bl('b-transport', 'Transport', 'depense', 'Vie quotidienne', 100, 'EUR', 7),
  bl('b-internet', 'Internet / Téléphone', 'depense', 'Abonnements', 45, 'EUR', 8),
  bl('b-sport', 'Sport', 'depense', 'Abonnements', 30, 'EUR', 9),
  bl('b-dons', 'Dons', 'depense', 'Dons & famille', 100, 'EUR', 10),
];

const strategy: Strategy = {
  targets: { 'Fonds & ETF': 0.45, PER: 0.2, Crypto: 0.1, 'Métaux précieux': 0.08, Startups: 0.05 },
  mainAssetByClass: { 'Fonds & ETF': 'hsbc', PER: 'per', Crypto: 'crypto', Startups: 'syla' },
  goldAssetId: 'or', silverAssetId: 'ag', savingsAssetId: 'epargne',
  monthlyInvest: 900, metalGrid: DEFAULT_METAL_GRID, displayCurrency: 'EUR',
};

const mv = (id: string, label: string, date: string, assetId: string, quantity: number, amount: number, extra: Partial<Movement> = {}): Movement =>
  ({ id, label, date, assetId, kind: 'buy', quantity, amount, ...extra });

const movements: Movement[] = [
  // Achats de métaux (quantité = grammes fins)
  mv('mv-or-1', '20 Francs Suisse', '2025-03-19', 'or', 6.4516, 547, { nature: 'Pièce', spotEurPerKg: 82_100 }),
  mv('mv-ag-1', 'Maple Leaf 1 oz ×3', '2025-03-19', 'ag', 93.309, 126, { nature: 'Pièce' }),
  mv('mv-ag-2', 'Philharmonique 1 oz ×3', '2025-03-19', 'ag', 93.309, 126, { nature: 'Pièce' }),
  mv('mv-or-2', '20 Francs Napoléon', '2025-06-25', 'or', 6.4516, 555, { nature: 'Pièce', spotEurPerKg: 83_301 }),
  mv('mv-ag-3', 'Britannia 1 oz ×3', '2025-06-25', 'ag', 93.309, 81, { nature: 'Pièce' }),
  mv('mv-ag-4', 'Lingot 500 g', '2025-06-25', 'ag', 500, 615, { nature: 'Lingot' }),
  mv('mv-or-3', 'Collier', '2025-11-01', 'or', 0, 1300, { nature: 'Bijou' }), // poids fin manquant
  // Versements du plan déjà déclarés (octobre et novembre)
  mv('mv-per-10', 'Versement PER', '2026-10-03', 'per', 1, 100, { nature: 'Versement', planMonth: '2026-10' }),
  mv('mv-hsbc-10', 'Achat HSBC', '2026-10-03', 'hsbc', 8.13, 300, { nature: 'Part', planMonth: '2026-10' }),
  mv('mv-crypto-10', 'Achat crypto', '2026-10-03', 'crypto', 0.001, 100, { nature: 'Token', planMonth: '2026-10' }),
  mv('mv-per-11', 'Versement PER', '2026-11-02', 'per', 1, 100, { nature: 'Versement', planMonth: '2026-11' }),
  mv('mv-hsbc-11', 'Achat HSBC', '2026-11-02', 'hsbc', 8.13, 300, { nature: 'Part', planMonth: '2026-11' }),
  mv('mv-crypto-11', 'Achat crypto', '2026-11-02', 'crypto', 0.001, 100, { nature: 'Token', planMonth: '2026-11' }),
];

const pl = (month: string, assetId: string, amount: number, origin: PlanLine['origin']): PlanLine => ({ id: `pl-${month}-${assetId}`, month, assetId, amount, origin });
const planMonth = (month: string): PlanLine[] => [
  pl(month, 'per', 100, 'fixe'), pl(month, 'hsbc', 300, 'cible'), pl(month, 'or', 165, 'signal'),
  pl(month, 'ag', 135, 'signal'), pl(month, 'crypto', 100, 'cible'), pl(month, 'syla', 100, 'cible'),
];
const plan: PlanLine[] = [
  // Syla : prévu depuis juin, jamais acheté → s'accumule (6 × 100 = 600 à investir en novembre)
  ...['2026-06', '2026-07', '2026-08', '2026-09'].map((m) => pl(m, 'syla', 100, 'cible')),
  ...planMonth('2026-10'), ...planMonth('2026-11'),
];

// Valeurs d'arrivée du 2026-10-25 par classe (€), cohérentes avec les actifs ci-dessus.
function finalByClass(): Record<AssetClass, number> {
  const out = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>;
  for (const a of assets) out[a.assetClass] += a.valueEur ?? 0;
  return out;
}

/** Instantanés mensuels du 2025-11-01 au 2026-10-25, net croissant jusqu'à ≈ 423 147 €. */
function buildSnapshots(): Snapshot[] {
  const end = finalByClass();
  const endAssets = Object.values(end).reduce((s, v) => s + v, 0);
  const debt = debts[0].valueEur!;
  const dates = ['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01',
    '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-10-25'];
  const nets = [352_000, 357_400, 363_200, 369_800, 374_100, 381_500, 388_200, 395_600, 402_300, 409_900, 416_200, 421_000, endAssets - debt];
  const ratios = [67.2, 66.8, 66.1, 66.5, 65.9, 65.4, 65.1, 64.9, 64.3, 64.8, 64.6, 64.4, 64.51];
  return dates.map((date, i) => {
    const last = i === dates.length - 1;
    const totalAssetsEur = last ? endAssets : nets[i] + debt;
    const k = totalAssetsEur / endAssets;
    const byClass = Object.fromEntries(ASSET_CLASSES.map((c) => [c, end[c] * k])) as Record<AssetClass, number>;
    return {
      date, totalAssetsEur, totalDebtsEur: debt, netEur: totalAssetsEur - debt, byClass,
      goldSilverRatio: ratios[i], eurMad: FIXTURE_FX.MAD, eurUsd: FIXTURE_FX.USD, partial: false,
    };
  });
}

export const fixtureSeed: FakeSeed = { assets, movements, debts, budget, strategy, plan, snapshots: buildSnapshots() };
