import { parisDate } from '@/domain/dates';
import { buildSnapshot } from '@/domain/history';
import { goldSilverRatio } from '@/domain/metals';
import { fromEur, toEur } from '@/domain/money';
import { withPositions } from '@/domain/positions';
import { savingsBalanceEur } from '@/domain/savings';
import { OZ_G, usdPerOzToEurPerKg } from '@/domain/units';
import { valueAsset } from '@/domain/valuation';
import type { Repo } from '@/notion/repo';
import type {
  Asset, FxProvider, FxRates, HistoricalPriceProvider, Movement, PriceProvider, Quote,
} from '@/domain/types';

export interface SyncReport {
  date: string;
  updated: number;
  errors: { assetId: string; message: string }[];
  partial: boolean;
}

const TIMEOUT_MS = 8_000;
const METALS = 'Métaux précieux';
const SPOT_PARALLEL = 4;
const WRITE_PARALLEL = 3;
const SILVER_QUOTES = new Set(['XAG', 'SI=F']);

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
const warn = (e: unknown): string => `⚠ ${asError(e).message}`;

/** Borne un appel externe : une source qui ne répond pas devient une Error au lieu de bloquer la synchro. */
function withTimeout<T>(call: () => Promise<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`délai dépassé (${ms / 1000} s) : ${label}`)), ms);
  });
  return Promise.race([Promise.resolve().then(call), timeout]).finally(() => clearTimeout(timer));
}

/** Cours d'un lot d'identifiants ; toute défaillance de la source devient une Error pour chaque identifiant. */
async function fetchQuotes(provider: PriceProvider, ids: string[], label: string): Promise<Map<string, Quote | Error>> {
  const out = new Map<string, Quote | Error>();
  if (ids.length === 0) return out;
  try {
    const got = await withTimeout(() => provider.getQuotes(ids), label);
    for (const id of ids) out.set(id, got.get(id) ?? new Error(`cours absent : ${id}`));
  } catch (e) {
    for (const id of ids) out.set(id, asError(e));
  }
  return out;
}

/** Exécute `fn` sur chaque élément, au plus `limit` à la fois. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Synchronisation quotidienne (spec §6). Les lectures initiales qui échouent font lever runSync ;
 * ensuite chaque source, chaque actif et chaque écriture est isolé : un échec est consigné dans le rapport
 * (`errors`) et l'instantané du jour est tout de même écrit (`partial: true` si les totaux sont incomplets).
 */
export async function runSync(d: {
  repo: Repo; yahoo: PriceProvider & HistoricalPriceProvider; crypto: PriceProvider; fx: FxProvider; now: Date;
}): Promise<SyncReport> {
  const { repo, yahoo, crypto, now } = d;
  const date = parisDate(now);
  const nowIso = now.toISOString();
  const errors: SyncReport['errors'] = [];

  const [allAssets, strategy, movements, budget, debts, plan, snapshots] = await Promise.all([
    repo.listAssets(), repo.getStrategy(), repo.listMovements(), repo.listBudget(),
    repo.listDebts(), repo.listPlan(), repo.listSnapshots(),
  ]);
  // Quantité et prix de revient recalculés depuis les mouvements (les rollups Notion sont tronqués à 25).
  const active = withPositions(allAssets.filter((a) => !a.archived), movements);
  const lastSnapshot = [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).at(-1);

  // Taux de change et cours en parallèle, chaque source indépendante des autres.
  const savingsId = strategy.savingsAssetId;
  const autos = active.filter((a) => a.mode === 'auto' && a.id !== savingsId);
  const cryptoIds = new Set(autos.filter((a) => a.assetClass === 'Crypto' && a.quoteId).map((a) => a.quoteId!));
  const yahooIds = new Set(autos.filter((a) => a.assetClass !== 'Crypto' && a.quoteId).map((a) => a.quoteId!));
  yahooIds.add('XAU');
  yahooIds.add('XAG');
  const [fxResult, cryptoQuotes, yahooQuotes] = await Promise.all([
    withTimeout(() => d.fx.getRates(), 'taux de change').then((r) => r, (e: unknown) => asError(e)),
    fetchQuotes(crypto, [...cryptoIds], 'CoinGecko'),
    fetchQuotes(yahoo, [...yahooIds], 'Yahoo'),
  ]);

  // Taux de change : à défaut, ceux du dernier instantané.
  let fx: FxRates;
  let valuationIncomplete = false;
  if (fxResult instanceof Error) {
    valuationIncomplete = true;
    errors.push({ assetId: 'fx', message: fxResult.message });
    if (!lastSnapshot) return { date, updated: 0, errors, partial: true };
    // GBP n'est pas conservé dans l'instantané : les cotations en GBP échoueront (valeur non finie).
    fx = { date, EUR: 1, MAD: lastSnapshot.eurMad, USD: lastSnapshot.eurUsd, GBP: Number.NaN };
  } else {
    fx = fxResult;
  }

  const quoteOf = (a: Asset): Quote | Error => {
    if (!a.quoteId) return new Error('identifiant de cotation manquant');
    const src = a.assetClass === 'Crypto' ? cryptoQuotes : yahooQuotes;
    return src.get(a.quoteId) ?? new Error(`cours absent : ${a.quoteId}`);
  };

  // Valorisation de chaque actif, avec écriture isolée ; `current` reflète ce qui est réellement en base.
  const current = new Map(active.map((a) => [a.id, a]));
  let updated = 0;

  /**
   * Repli sans nouveau cours : quantité des mouvements × dernier cours connu (même calcul que le tableau de bord,
   * pour que l'instantané concorde avec les totaux affichés) ; sans cours connu (ou pour l'Épargne, dont le solde
   * estimé n'a pas pu être calculé), dernière valeur enregistrée.
   */
  const fallbackOf = (a: Asset): { unitPrice?: number; value: number; valueEur: number } => {
    const stored = { unitPrice: a.unitPrice, value: a.value ?? 0, valueEur: a.valueEur ?? 0 };
    if (a.id === savingsId) return stored;
    const v = valueAsset(a, undefined, fx);
    return Number.isFinite(v.value) && Number.isFinite(v.valueEur) ? { unitPrice: a.unitPrice, value: v.value, valueEur: v.valueEur } : stored;
  };

  const markFailed = async (a: Asset, e: unknown) => {
    errors.push({ assetId: a.id, message: asError(e).message });
    valuationIncomplete = true;
    const fallback = fallbackOf(a);
    current.set(a.id, { ...a, ...fallback });
    try {
      await repo.updateAssetValuation(a.id, { ...fallback, syncStatus: warn(e), lastUpdate: a.lastUpdate ?? nowIso });
    } catch {
      // Écriture du statut impossible aussi : l'erreur est déjà dans le rapport.
    }
  };

  const write = async (a: Asset, compute: () => { unitPrice?: number; value: number; valueEur: number }) => {
    try {
      const v = compute();
      if (!Number.isFinite(v.value) || !Number.isFinite(v.valueEur)) throw new Error('valeur non calculable (taux manquant)');
      await repo.updateAssetValuation(a.id, { ...v, syncStatus: 'OK', lastUpdate: nowIso });
      current.set(a.id, { ...a, ...v, syncStatus: 'OK', lastUpdate: nowIso });
      updated++;
    } catch (e) {
      await markFailed(a, e);
    }
  };

  // Écritures à 3 en parallèle au plus ; le limiteur Notion partagé garde 3 requêtes/s.
  await mapLimit(active.filter((a) => a.id !== savingsId), WRITE_PARALLEL, async (a) => {
    if (a.mode === 'manual') {
      await write(a, () => valueAsset(a, undefined, fx));
    } else {
      await write(a, () => {
        const quote = quoteOf(a);
        if (quote instanceof Error) throw quote;
        return valueAsset(a, quote, fx);
      });
    }
  });

  // Épargne : dernière saisie manuelle + épargne mensuelle − achats du plan (même calcul que le tableau de bord).
  const savings = savingsId ? active.find((a) => a.id === savingsId) : undefined;
  if (savings) {
    await write(savings, () => {
      const valueEur = savingsBalanceEur({ asset: savings, budget, strategy, movements, plan, assets: allAssets, fx, today: date });
      return { value: fromEur(valueEur, savings.currency, fx), valueEur };
    });
  }

  // Spots manquants des mouvements de métaux (erreurs rapportées, jamais bloquantes).
  const metalIds = new Map(allAssets.filter((a) => a.assetClass === METALS).map((a) => [a.id, a]));
  const missing = movements.filter((m) => m.spotEurPerKg === undefined && m.quantity > 0 && metalIds.has(m.assetId));
  const closes = new Map<string, Promise<number>>();
  const closeOn = (symbol: string, day: string) => {
    const key = `${symbol}|${day}`;
    if (!closes.has(key)) closes.set(key, withTimeout(() => yahoo.getCloseOn(symbol, day), `${symbol} au ${day}`));
    return closes.get(key)!;
  };
  const backfill = async (m: Movement) => {
    try {
      const asset = metalIds.get(m.assetId)!;
      const isSilver = asset.id === strategy.silverAssetId || SILVER_QUOTES.has(asset.quoteId ?? '');
      const symbol = isSilver ? 'SI=F' : 'GC=F';
      const [usdPerOz, eurUsd] = await Promise.all([closeOn(symbol, m.date), closeOn('EURUSD=X', m.date)]);
      await repo.setMovementSpot(m.id, (usdPerOz / OZ_G) * 1000 / eurUsd);
    } catch (e) {
      errors.push({ assetId: m.assetId, message: asError(e).message });
    }
  };
  await mapLimit(missing, SPOT_PARALLEL, backfill);

  // Ratio or/argent depuis les cotations XAU et XAG.
  const gold = yahooQuotes.get('XAU');
  const silver = yahooQuotes.get('XAG');
  const ratio = gold && silver && !(gold instanceof Error) && !(silver instanceof Error)
    ? goldSilverRatio(usdPerOzToEurPerKg(gold.price, fx), usdPerOzToEurPerKg(silver.price, fx))
    : null;

  // Instantané du jour : valeurs calculées (repli quantité × dernier cours pour un actif en échec).
  const debtsEur = debts.map((x) => ({ ...x, valueEur: toEur(x.outstanding, x.currency, fx) }));
  try {
    await repo.upsertSnapshot(buildSnapshot(date, [...current.values()], debtsEur, fx, ratio, valuationIncomplete));
  } catch (e) {
    errors.push({ assetId: 'historique', message: asError(e).message });
  }

  return { date, updated, errors, partial: errors.length > 0 };
}
