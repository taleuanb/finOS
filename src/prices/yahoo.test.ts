import { describe, it, expect, vi } from 'vitest';
import { createYahooProvider, METAL_SYMBOLS } from './yahoo';
import aapl from './__fixtures__/yahoo-aapl.json';
import gold from './__fixtures__/yahoo-gold.json';
import pence from './__fixtures__/yahoo-gbp-pence.json';
import gbx from './__fixtures__/yahoo-gbx.json';
import chf from './__fixtures__/yahoo-chf.json';
import notFound from './__fixtures__/yahoo-not-found.json';
import series from './__fixtures__/yahoo-series.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** fetch factice : route selon le symbole présent dans l'URL (nombre = statut HTTP). */
function routed(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const m = /\/chart\/([^?]+)/.exec(String(input));
    const sym = decodeURIComponent(m![1]);
    const r = routes[sym];
    if (typeof r === 'number') return json({}, r);
    if (r === undefined) throw new Error(`route inattendue ${sym}`);
    return json(r);
  });
}
const asFetch = (f: unknown) => f as typeof fetch;

describe('METAL_SYMBOLS', () => {
  it('associe XAU et XAG aux contrats futures', () => {
    expect(METAL_SYMBOLS).toEqual({ XAU: 'GC=F', XAG: 'SI=F' });
  });
});

describe('Yahoo getQuotes', () => {
  it('lit le cours et la devise', async () => {
    const f = routed({ AAPL: aapl });
    const y = createYahooProvider(asFetch(f));
    expect((await y.getQuotes(['AAPL'])).get('AAPL')).toEqual({ id: 'AAPL', price: 216.5, currency: 'USD' });
    expect(String(f.mock.calls[0][0])).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d',
    );
  });

  it('envoie un User-Agent de navigateur', async () => {
    const f = routed({ AAPL: aapl });
    await createYahooProvider(asFetch(f)).getQuotes(['AAPL']);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('user-agent')).toMatch(/Mozilla/);
  });

  it('mappe XAU vers GC=F et renvoie la cotation sous XAU', async () => {
    const f = routed({ 'GC=F': gold });
    const q = await createYahooProvider(asFetch(f)).getQuotes(['XAU']);
    expect(q.get('XAU')).toMatchObject({ id: 'XAU', price: 3020.4, currency: 'USD' });
    expect(String(f.mock.calls[0][0])).toContain('/chart/GC%3DF?');
  });

  it('convertit les pence (GBp) en GBP', async () => {
    const y = createYahooProvider(asFetch(routed({ 'CSPX.L': pence })));
    expect((await y.getQuotes(['CSPX.L'])).get('CSPX.L')).toEqual({ id: 'CSPX.L', price: 500, currency: 'GBP' });
  });

  it('convertit aussi GBX', async () => {
    const y = createYahooProvider(asFetch(routed({ 'VUSA.L': gbx })));
    expect((await y.getQuotes(['VUSA.L'])).get('VUSA.L')).toEqual({ id: 'VUSA.L', price: 80, currency: 'GBP' });
  });

  it('refuse une devise non gérée pour cet id seulement', async () => {
    const y = createYahooProvider(asFetch(routed({ 'NESN.SW': chf, AAPL: aapl })));
    const q = await y.getQuotes(['NESN.SW', 'AAPL']);
    expect(q.get('NESN.SW')).toBeInstanceOf(Error);
    expect((q.get('NESN.SW') as Error).message).toBe('devise non gérée : CHF');
    expect(q.get('AAPL')).toMatchObject({ price: 216.5 });
  });

  it('ticker inconnu : Error, les autres ids restent OK', async () => {
    const y = createYahooProvider(asFetch(routed({ ZZZ: notFound, AAPL: aapl })));
    const q = await y.getQuotes(['ZZZ', 'AAPL']);
    expect(q.get('ZZZ')).toBeInstanceOf(Error);
    expect((q.get('ZZZ') as Error).message).toBe('ticker introuvable : ZZZ');
    expect(q.get('AAPL')).toMatchObject({ currency: 'USD' });
  });

  it('HTTP 500 : Error pour cet id, sans exception', async () => {
    const y = createYahooProvider(asFetch(routed({ AAPL: 500, 'GC=F': gold })));
    const q = await y.getQuotes(['AAPL', 'XAU']);
    expect(q.get('AAPL')).toBeInstanceOf(Error);
    expect(q.get('XAU')).toMatchObject({ price: 3020.4 });
  });

  it('erreur réseau : Error pour cet id', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const q = await createYahooProvider(asFetch(f)).getQuotes(['AAPL']);
    expect(q.get('AAPL')).toBeInstanceOf(Error);
  });

  it('prix absent : Error', async () => {
    const bad = { chart: { result: [{ meta: { currency: 'USD' } }], error: null } };
    const q = await createYahooProvider(asFetch(routed({ AAPL: bad }))).getQuotes(['AAPL']);
    expect(q.get('AAPL')).toBeInstanceOf(Error);
  });

  it('au plus 4 requêtes en parallèle', async () => {
    let inflight = 0;
    let max = 0;
    const f = vi.fn(async () => {
      inflight++;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return json(aapl);
    });
    const ids = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const q = await createYahooProvider(asFetch(f)).getQuotes(ids);
    expect(q.size).toBe(10);
    expect(f).toHaveBeenCalledTimes(10);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });
});

describe('Yahoo getCloseOn', () => {
  const mk = () => {
    const f = routed({ 'GC=F': gold });
    return { f, y: createYahooProvider(asFetch(f)) };
  };

  it('week-end : renvoie la clôture du vendredi', async () => {
    expect(await mk().y.getCloseOn('GC=F', '2025-03-22')).toBe(3022.9);
  });

  it('ignore les clôtures nulles (mercredi nul : mardi)', async () => {
    expect(await mk().y.getCloseOn('GC=F', '2025-03-19')).toBe(3041.7);
  });

  it('ignore les barres postérieures à la date', async () => {
    const { y } = mk();
    expect(await y.getCloseOn('GC=F', '2025-03-21')).toBe(3022.9);
    expect(await y.getCloseOn('GC=F', '2025-03-24')).toBe(3057.2);
  });

  it('construit period1 = date-7j et period2 = date+1j (UTC)', async () => {
    const { f, y } = mk();
    await y.getCloseOn('GC=F', '2025-03-22');
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.searchParams.get('period1')).toBe(String(Date.UTC(2025, 2, 15) / 1000));
    expect(u.searchParams.get('period2')).toBe(String(Date.UTC(2025, 2, 23) / 1000));
    expect(u.searchParams.get('interval')).toBe('1d');
  });

  it('lève une Error si aucun cours ≤ date', async () => {
    await expect(mk().y.getCloseOn('GC=F', '2025-03-10')).rejects.toBeInstanceOf(Error);
  });

  it('lève une Error sur HTTP 500 et ticker inconnu', async () => {
    const y = createYahooProvider(asFetch(routed({ A: 500, B: notFound })));
    await expect(y.getCloseOn('A', '2025-03-22')).rejects.toBeInstanceOf(Error);
    await expect(y.getCloseOn('B', '2025-03-22')).rejects.toThrow('ticker introuvable : B');
  });

  it('rejette une date invalide', async () => {
    await expect(mk().y.getCloseOn('GC=F', 'hier')).rejects.toBeInstanceOf(Error);
  });
});

describe('Yahoo getSeries', () => {
  it('renvoie des points ISO et ignore les clôtures nulles', async () => {
    const f = routed({ 'EURUSD=X': series });
    const y = createYahooProvider(asFetch(f));
    expect(await y.getSeries('EURUSD=X', '5y', '1wk')).toEqual([
      { date: '2020-10-26', close: 1900.5 },
      { date: '2020-11-09', close: 1875.2 },
    ]);
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.searchParams.get('range')).toBe('5y');
    expect(u.searchParams.get('interval')).toBe('1wk');
  });

  it('lève une Error sur échec', async () => {
    const y = createYahooProvider(asFetch(routed({ X: 500 })));
    await expect(y.getSeries('X', '5y', '1wk')).rejects.toBeInstanceOf(Error);
  });
});
