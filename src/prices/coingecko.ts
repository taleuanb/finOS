import type { PriceProvider, Quote } from '@/domain/types';

const BASE = 'https://api.coingecko.com/api/v3/simple/price';

export function createCoinGeckoProvider(fetchFn: typeof fetch = fetch): PriceProvider {
  return {
    async getQuotes(ids) {
      const out = new Map<string, Quote | Error>();
      if (ids.length === 0) return out;
      const failAll = (e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e));
        for (const id of ids) out.set(id, err);
        return out;
      };
      let body: Record<string, { eur?: number } | undefined>;
      try {
        const res = await fetchFn(`${BASE}?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=eur`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return failAll(new Error(`CoinGecko HTTP ${res.status}`));
        body = (await res.json()) as typeof body;
      } catch (e) {
        return failAll(e);
      }
      for (const id of ids) {
        const price = body?.[id]?.eur;
        out.set(
          id,
          typeof price === 'number' && Number.isFinite(price)
            ? { id, price, currency: 'EUR' }
            : new Error(`crypto introuvable : ${id}`),
        );
      }
      return out;
    },
  };
}
