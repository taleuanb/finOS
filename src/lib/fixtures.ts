// Dashboard des maquettes V2, construit à la main à partir de fixtureSeed (pas de fonctions du domaine).
// Cohérent avec le seed : net ≈ 422 000 €, brut ≈ 477 300 €, dettes ≈ 55 300 €, épargne du mois 1 769,75 €.
import type { AssetClass, FxRates } from '@/domain/types';
import { fixtureSeed, FIXTURE_FX } from '@/notion/seed';
import type { Dashboard, MetalPosition, MetalPurchaseView, Period, PlanLineView, ValuedAsset } from './dashboard';

const { assets: seedAssets, debts: seedDebts, snapshots, strategy, budget: budgetLines, movements } = fixtureSeed;
const fx: FxRates = { ...FIXTURE_FX };

const assets: ValuedAsset[] = seedAssets.map((a) => ({
  ...a,
  value: a.value!,
  valueEur: a.valueEur!,
  gainAbs: a.costBasis > 0 ? a.value! - a.costBasis : null,
  gainPct: a.costBasis > 0 ? (a.value! - a.costBasis) / a.costBasis : null,
  stale: false,
}));

const grossEur = assets.reduce((s, a) => s + a.valueEur, 0);
const debts = seedDebts.map((d) => ({ ...d, valueEur: d.valueEur! }));
const debtsEur = debts.reduce((s, d) => s + d.valueEur, 0);
const netEur = grossEur - debtsEur;

const byClassMap = new Map<AssetClass, number>();
for (const a of assets) byClassMap.set(a.assetClass, (byClassMap.get(a.assetClass) ?? 0) + a.valueEur);
const byClass = [...byClassMap.entries()]
  .filter(([, v]) => v > 0)
  .map(([assetClass, valueEur]) => ({ assetClass, valueEur, pct: valueEur / grossEur }))
  .sort((a, b) => b.valueEur - a.valueEur);

const history = snapshots.map((s) => ({ date: s.date, netEur: s.netEur }));
function variation(fromDate: string) {
  const base = history.find((h) => h.date >= fromDate) ?? history[0];
  if (base.date === history[history.length - 1].date) return null;
  return { abs: netEur - base.netEur, pct: (netEur - base.netEur) / base.netEur };
}
const variations: Record<Period, { abs: number; pct: number } | null> = {
  '1M': variation('2026-09-25'), YTD: variation('2026-01-01'), '1A': variation('2025-10-25'), Tout: variation('0000-00-00'),
};

const topPerformers = assets
  .filter((a) => a.gainPct !== null)
  .sort((a, b) => b.gainPct! - a.gainPct!)
  .slice(0, 5);

// --- Métaux ---
const GOLD_EUR_KG = 125_926;
const SILVER_EUR_KG = 1_952;
const ratio = Math.round((GOLD_EUR_KG / SILVER_EUR_KG) * 100) / 100; // 64,51

function position(id: 'or' | 'ag', spot: number, avgPremium: number | null): MetalPosition {
  const a = assets.find((x) => x.id === id)!;
  return {
    assetId: id, grams: a.quantity, valueEur: a.valueEur, costEur: a.costBasis,
    avgCostPerKg: (a.costBasis / a.quantity) * 1000, spotEurPerKg: spot, avgPremium,
    gainPct: (a.valueEur - a.costBasis) / a.costBasis,
  };
}

const premiumOf = (amount: number, grams: number, spot: number) => amount / ((grams * spot) / 1000) - 1;
const purchases: MetalPurchaseView[] = movements
  .filter((m) => m.assetId === 'or' || m.assetId === 'ag')
  .map((m): MetalPurchaseView => ({
    movementId: m.id, date: m.date, label: m.label, nature: m.nature,
    metal: m.assetId === 'or' ? 'gold' : 'silver',
    fineGrams: m.quantity, amountEur: m.amount, spotEurPerKg: m.spotEurPerKg ?? null,
    premium: m.spotEurPerKg && m.quantity > 0 ? premiumOf(m.amount, m.quantity, m.spotEurPerKg) : null,
  }))
  .reverse();

const goldPremiums = purchases.filter((p) => p.metal === 'gold' && p.premium !== null).map((p) => p.premium!);
const metals: Dashboard['metals'] = {
  gold: position('or', GOLD_EUR_KG, goldPremiums.reduce((s, p) => s + p, 0) / goldPremiums.length),
  silver: position('ag', SILVER_EUR_KG, null),
  ratio,
  zone: strategy.metalGrid.find((z) => z.label === 'Neutre')!,
  alert: false,
  ratioHistory: snapshots.filter((s) => s.goldSilverRatio !== null).map((s) => ({ date: s.date, ratio: s.goldSilverRatio! })),
  purchases,
  monthSplit: { goldEur: 165, silverEur: 135 },
  gridWarning: null,
};

// --- Budget (mois type) ---
const incomeEur = 3200 + 4500 / fx.MAD;
const expensesEur = 900 + 150 + 400 + 120 + 100 + 45 + 30 + 100;
const savingsEur = incomeEur - expensesEur; // 1 769,75
const investEur = strategy.monthlyInvest;
const budget: Dashboard['budget'] = {
  incomeEur, expensesEur, savingsEur, savingsRate: savingsEur / incomeEur,
  investEur, freeEur: savingsEur - investEur,
  byCategory: [
    { category: 'Activité', section: 'revenu', totalEur: 3200 },
    { category: 'Revenus locatifs', section: 'revenu', totalEur: 4500 / fx.MAD },
    { category: 'Logement', section: 'depense', totalEur: 1050 },
    { category: 'Vie quotidienne', section: 'depense', totalEur: 620 },
    { category: 'Abonnements', section: 'depense', totalEur: 75 },
    { category: 'Dons & famille', section: 'depense', totalEur: 100 },
  ],
  lines: budgetLines,
};

// --- Plan de novembre 2026 (validé) ---
const planLines: PlanLineView[] = [
  { assetId: 'per', assetName: 'Pertinence Retraite (Suravenir)', plannedEur: 100, origin: 'fixe', reason: 'Versement fixe mensuel', toInvestEur: 0, monthsAccrued: 0, status: 'declared' },
  { assetId: 'hsbc', assetName: 'HSBC Islamic Global Equity', plannedEur: 300, origin: 'cible', reason: 'Classe Fonds & ETF en retard sur sa cible', toInvestEur: 0, monthsAccrued: 0, status: 'declared' },
  { assetId: 'or', assetName: 'Or physique', plannedEur: 165, origin: 'signal', reason: `Ratio ${String(ratio).replace('.', ',')} · zone Neutre (55 % or)`, toInvestEur: 330, monthsAccrued: 2, status: 'pending' },
  { assetId: 'ag', assetName: 'Argent physique', plannedEur: 135, origin: 'signal', reason: `Ratio ${String(ratio).replace('.', ',')} · zone Neutre (45 % argent)`, toInvestEur: 270, monthsAccrued: 2, status: 'pending' },
  { assetId: 'crypto', assetName: 'Finary Crypto', plannedEur: 100, origin: 'cible', reason: 'Classe Crypto en retard sur sa cible', toInvestEur: 0, monthsAccrued: 0, status: 'declared' },
  { assetId: 'syla', assetName: 'Syla Invest', plannedEur: 100, origin: 'cible', reason: 'Classe Startups en retard sur sa cible', toInvestEur: 600, monthsAccrued: 6, status: 'pending' },
];
const pendingEur = planLines.reduce((s, l) => s + l.toInvestEur, 0); // 1 200
const savingsBalanceEur = assets.find((a) => a.id === 'epargne')!.valueEur;

const plan: Dashboard['plan'] = {
  month: '2026-11', validated: true, proposal: null, allocationError: null,
  lines: planLines,
  investedEur: 500, pendingEur, freeEur: budget.freeEur,
  savings: { balanceEur: savingsBalanceEur, reservedEur: pendingEur, freeEur: savingsBalanceEur - pendingEur },
  history6: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((month) => ({
    month, savedEur: savingsEur, investedEur: 500,
  })),
};

export const fixtureDashboard: Dashboard = {
  asOf: '2026-10-25', lastSyncOk: '2026-10-25T05:00:00.000Z', stale: false, fx, strategy, demo: false,
  totals: { grossEur, debtsEur, netEur },
  variations, history, byClass, assets, debts, topPerformers, metals, budget, plan,
};
