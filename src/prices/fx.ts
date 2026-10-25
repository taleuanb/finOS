import type { FxProvider, FxRates } from '../domain/types';
import { parisDate } from '../domain/dates';

const URL = 'https://open.er-api.com/v6/latest/EUR';
const UNAVAILABLE = 'taux de change indisponible';

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Taux « unités par 1 EUR » depuis open.er-api.com. Toute défaillance lève
 * Error('taux de change indisponible') : l'appelant se rabat sur le dernier instantané.
 */
export function createFxProvider(
  fetchFn: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): FxProvider {
  return {
    async getRates(): Promise<FxRates> {
      let body: { result?: string; rates?: Record<string, unknown> };
      try {
        const res = await fetchFn(URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = await res.json();
      } catch {
        throw new Error(UNAVAILABLE);
      }
      const r = body?.rates;
      if (body?.result !== 'success' || !r || !valid(r.MAD) || !valid(r.USD) || !valid(r.GBP)) {
        throw new Error(UNAVAILABLE);
      }
      return { EUR: 1, MAD: r.MAD, USD: r.USD, GBP: r.GBP, date: parisDate(now()) };
    },
  };
}
