import { unstable_cache } from 'next/cache';
import type { MetalZone, Strategy } from '@/domain/types';
import { getRepo, isDemo } from '@/notion';
import type { Repo } from '@/notion/repo';
import { createYahooProvider, METAL_SYMBOLS } from '@/prices/yahoo';
import { buildDashboard, type DashboardSeries } from './buildDashboard';
import { TAGS, type CacheKey } from './cacheTags';
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
  [TAGS.series],
  { tags: [TAGS.series], revalidate: 86_400 },
);

/** Le ratio historique est un confort : toute erreur donne `null`, jamais un tableau de bord en échec. */
async function loadSeries(): Promise<DashboardSeries | null> {
  try {
    return await cachedSeries();
  } catch {
    return null;
  }
}

/** Durée de vie d'une lecture Notion en cache (15 min) ; la synchro quotidienne et les écritures l'invalident avant. */
const REVALIDATE_SECONDS = 900;

/**
 * Chronomètre une lecture de base (console.log de millisecondes, jamais de montant ni de secret).
 * Exécuté dans la fonction mise en cache : seules les vraies lectures Notion sont journalisées, pas les hits.
 */
async function timed<T>(name: string, read: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await read();
  } finally {
    console.log(`[perf] ${name} ${Date.now() - t0}ms`);
  }
}

/** Un cache par base (tag de `TAGS`) : une écriture ne vide que la base qu'elle touche. */
function cachedRead<T>(key: Exclude<CacheKey, 'series'>, read: (repo: Repo) => Promise<T>): () => Promise<T> {
  return unstable_cache(() => timed(key, () => read(getRepo())), [TAGS[key]], { tags: [TAGS[key]], revalidate: REVALIDATE_SECONDS });
}

const cachedAssets = cachedRead('assets', (r) => r.listAssets());
const cachedMovements = cachedRead('movements', (r) => r.listMovements());
const cachedDebts = cachedRead('debts', (r) => r.listDebts());
const cachedBudget = cachedRead('budget', (r) => r.listBudget());
const cachedStrategy = cachedRead('strategy', (r) => r.getStrategy());
const cachedPlan = cachedRead('plan', (r) => r.listPlan());
const cachedHistory = cachedRead('history', (r) => r.listSnapshots());

/** Le cache sérialise en JSON : `Infinity` (borne haute de la dernière zone) devient `null`. */
function reviveZone<Z extends MetalZone | null>(z: Z): Z {
  return z && z.max === null ? { ...z, max: Infinity } : z;
}

/** Seule lecture qui contient un `Infinity` : la grille des métaux de la Stratégie. */
export function reviveStrategy(s: Strategy): Strategy {
  return { ...s, metalGrid: s.metalGrid.map((z) => reviveZone(z)) };
}

let lastGood: Dashboard | null = null;

/**
 * Tableau de bord complet : sept lectures en parallèle, chacune dans son cache (tag de sa base, 15 min), puis
 * `buildDashboard` (pur, rapide) à chaque requête. Si une lecture échoue, renvoie la dernière valeur réussie
 * gardée en mémoire avec `stale: true` (et journalise l'erreur) ; relance l'erreur s'il n'y en a aucune.
 */
export async function getDashboard(): Promise<Dashboard> {
  try {
    const t0 = Date.now();
    const [assets, movements, debts, budget, strategy, plan, snapshots, series] = await Promise.all([
      cachedAssets(), cachedMovements(), cachedDebts(), cachedBudget(),
      cachedStrategy().then(reviveStrategy), cachedPlan(), cachedHistory(), loadSeries(),
    ]);
    console.log(`[perf] lectures ${Date.now() - t0}ms`);
    lastGood = buildDashboard({
      assets, movements, debts, budget, strategy, plan, snapshots, series, now: new Date(), demo: isDemo(),
    });
    return lastGood;
  } catch (e) {
    console.error('getDashboard : lecture impossible', e);
    if (lastGood) return { ...lastGood, stale: true };
    throw e;
  }
}
