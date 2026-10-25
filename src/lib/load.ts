import { unstable_cache } from 'next/cache';
import type { MetalZone } from '@/domain/types';
import { getRepo } from '@/notion';
import { createYahooProvider, METAL_SYMBOLS } from '@/prices/yahoo';
import { buildDashboard, type DashboardSeries } from './buildDashboard';
import type { Dashboard } from './dashboard';

/** Clôtures hebdomadaires or / argent sur 5 ans (cache 24 h, tag `series`). */
const cachedSeries = unstable_cache(
  async (): Promise<DashboardSeries> => {
    const yahoo = createYahooProvider();
    const [gold, silver] = await Promise.all([
      yahoo.getSeries(METAL_SYMBOLS.XAU, '5y', '1wk'),
      yahoo.getSeries(METAL_SYMBOLS.XAG, '5y', '1wk'),
    ]);
    return { gold, silver };
  },
  ['series'],
  { tags: ['series'], revalidate: 86_400 },
);

/** Le ratio historique est un confort : toute erreur donne `null`, jamais un tableau de bord en échec. */
async function loadSeries(): Promise<DashboardSeries | null> {
  try {
    return await cachedSeries();
  } catch {
    return null;
  }
}

const cachedDashboard = unstable_cache(
  async (): Promise<Dashboard> => {
    const repo = getRepo();
    const [assets, movements, debts, budget, strategy, plan, snapshots, series] = await Promise.all([
      repo.listAssets(), repo.listMovements(), repo.listDebts(), repo.listBudget(),
      repo.getStrategy(), repo.listPlan(), repo.listSnapshots(), loadSeries(),
    ]);
    return buildDashboard({ assets, movements, debts, budget, strategy, plan, snapshots, series, now: new Date() });
  },
  ['dashboard'],
  { tags: ['notion'], revalidate: 600 },
);

/** Le cache sérialise en JSON : `Infinity` (borne haute de la dernière zone) devient `null`. */
function reviveZone<Z extends MetalZone | null>(z: Z): Z {
  return z && z.max === null ? { ...z, max: Infinity } : z;
}

export function reviveDashboard(d: Dashboard): Dashboard {
  return {
    ...d,
    strategy: { ...d.strategy, metalGrid: d.strategy.metalGrid.map((z) => reviveZone(z)) },
    metals: { ...d.metals, zone: reviveZone(d.metals.zone) },
  };
}

let lastGood: Dashboard | null = null;

/**
 * Tableau de bord complet, mis en cache 10 min (tag `notion`). Si la lecture échoue, renvoie la dernière
 * valeur réussie gardée en mémoire avec `stale: true` ; relance l'erreur s'il n'y en a aucune.
 */
export async function getDashboard(): Promise<Dashboard> {
  try {
    lastGood = reviveDashboard(await cachedDashboard());
    return lastGood;
  } catch (e) {
    if (lastGood) return { ...lastGood, stale: true };
    throw e;
  }
}
