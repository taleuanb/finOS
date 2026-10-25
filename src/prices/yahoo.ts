import type { HistoricalPriceProvider, PriceProvider, Quote } from '@/domain/types';

export const METAL_SYMBOLS = { XAU: 'GC=F', XAG: 'SI=F' } as const;

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_PARALLEL = 4;
const DAY_S = 86_400;

interface YahooResult {
  meta?: { regularMarketPrice?: number; currency?: string };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}
interface YahooChart {
  chart?: { result?: YahooResult[] | null; error?: { code?: string; description?: string } | null };
}

const isoDay = (tsSeconds: number) => new Date(tsSeconds * 1000).toISOString().slice(0, 10);

/** Convertit une date ISO `YYYY-MM-DD` en secondes UTC (minuit). */
function dayToSeconds(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date invalide : ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`date invalide : ${date}`);
  return ms / 1000;
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés (ordre des résultats conservé). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createYahooProvider(fetchFn: typeof fetch = fetch): PriceProvider & HistoricalPriceProvider {
  /** Appelle l'API chart ; lève une Error (ticker inconnu, HTTP, réseau, JSON invalide). */
  async function chart(symbol: string, query: string, label = symbol): Promise<YahooResult> {
    const res = await fetchFn(`${BASE}/${encodeURIComponent(symbol)}?${query}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} pour ${label}`);
    const body = (await res.json()) as YahooChart;
    const result = body.chart?.result?.[0];
    if (body.chart?.error || !result) throw new Error(`ticker introuvable : ${label}`);
    return result;
  }

  async function quote(id: string): Promise<Quote | Error> {
    try {
      const symbol = (METAL_SYMBOLS as Record<string, string>)[id] ?? id;
      const { meta } = await chart(symbol, 'range=1d&interval=1d', id);
      const price = meta?.regularMarketPrice;
      if (typeof price !== 'number' || !Number.isFinite(price)) throw new Error(`cours indisponible : ${id}`);
      const cur = meta?.currency;
      if (cur === 'USD' || cur === 'EUR' || cur === 'GBP') return { id, price, currency: cur };
      if (cur === 'GBp' || cur === 'GBX') return { id, price: price / 100, currency: 'GBP' };
      throw new Error(`devise non gérée : ${cur}`);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }

  return {
    async getQuotes(ids) {
      const results = await mapLimit(ids, MAX_PARALLEL, quote);
      return new Map(ids.map((id, i) => [id, results[i]]));
    },

    async getCloseOn(id, date) {
      const day = dayToSeconds(date);
      const r = await chart(id, `period1=${day - 7 * DAY_S}&period2=${day + DAY_S}&interval=1d`);
      const closes = r.indicators?.quote?.[0]?.close ?? [];
      const ts = r.timestamp ?? [];
      for (let i = Math.min(ts.length, closes.length) - 1; i >= 0; i--) {
        const c = closes[i];
        if (typeof c === 'number' && c !== 0 && isoDay(ts[i]) <= date) return c;
      }
      throw new Error(`aucun cours au ${date} pour ${id}`);
    },

    async getSeries(id, range, interval) {
      const r = await chart(id, `range=${range}&interval=${interval}`);
      const closes = r.indicators?.quote?.[0]?.close ?? [];
      const ts = r.timestamp ?? [];
      const out: { date: string; close: number }[] = [];
      for (let i = 0; i < Math.min(ts.length, closes.length); i++) {
        const c = closes[i];
        if (typeof c === 'number' && c !== 0) out.push({ date: isoDay(ts[i]), close: c });
      }
      return out;
    },
  };
}
