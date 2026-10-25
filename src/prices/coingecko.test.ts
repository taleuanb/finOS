import { describe, it, expect, vi } from 'vitest';
import { createCoinGeckoProvider } from './coingecko';
import simple from './__fixtures__/coingecko-simple.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const asFetch = (f: unknown) => f as typeof fetch;

describe('CoinGecko getQuotes', () => {
  it('une seule requête groupée, prix en EUR', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL) => json(simple));
    const q = await createCoinGeckoProvider(asFetch(f)).getQuotes(['bitcoin', 'ethereum']);
    expect(q.get('bitcoin')).toEqual({ id: 'bitcoin', price: 61234.5, currency: 'EUR' });
    expect(q.get('ethereum')).toEqual({ id: 'ethereum', price: 2410.12, currency: 'EUR' });
    expect(f).toHaveBeenCalledTimes(1);
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.origin + u.pathname).toBe('https://api.coingecko.com/api/v3/simple/price');
    expect(u.searchParams.get('ids')).toBe('bitcoin,ethereum');
    expect(u.searchParams.get('vs_currencies')).toBe('eur');
  });

  it('id inconnu : Error pour cet id, les autres restent OK', async () => {
    const f = vi.fn(async () => json(simple));
    const q = await createCoinGeckoProvider(asFetch(f)).getQuotes(['bitcoin', 'nope']);
    expect(q.get('nope')).toBeInstanceOf(Error);
    expect((q.get('nope') as Error).message).toBe('crypto introuvable : nope');
    expect(q.get('bitcoin')).toMatchObject({ price: 61234.5 });
  });

  it('HTTP 429 : une Error pour chaque id, sans exception', async () => {
    const f = vi.fn(async () => json({}, 429));
    const q = await createCoinGeckoProvider(asFetch(f)).getQuotes(['bitcoin', 'ethereum']);
    expect(q.get('bitcoin')).toBeInstanceOf(Error);
    expect(q.get('ethereum')).toBeInstanceOf(Error);
  });

  it('erreur réseau : une Error pour chaque id', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const q = await createCoinGeckoProvider(asFetch(f)).getQuotes(['bitcoin']);
    expect(q.get('bitcoin')).toBeInstanceOf(Error);
  });

  it('aucun id : aucune requête', async () => {
    const f = vi.fn();
    const q = await createCoinGeckoProvider(asFetch(f)).getQuotes([]);
    expect(q.size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
