import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import { createNotionClient, createRateLimiter, withRateLimit } from './client';

function apiError(status: number, code: APIErrorCode, headers: Record<string, string> = {}) {
  return new APIResponseError({
    code, status, message: `HTTP ${status}`, headers: new Headers(headers),
    rawBodyText: '', additional_data: undefined, request_id: undefined,
  });
}
const rateLimited = (headers: Record<string, string> = {}) => apiError(429, APIErrorCode.RateLimited, headers);

describe('withRateLimit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('démarre au plus 3 appels par fenêtre de 1 s', async () => {
    const { run } = createRateLimiter();
    const starts: number[] = [];
    const t0 = Date.now();
    const calls = Array.from({ length: 10 }, (_, i) => run(async () => { starts.push(Date.now() - t0); return i; }));
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toHaveLength(9);
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toHaveLength(10);
    expect(await Promise.all(calls)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const s of starts) expect(starts.filter(o => o >= s && o < s + 1000).length).toBeLessThanOrEqual(3);
  });

  it('le withRateLimit exporté renvoie la valeur de la fonction', async () => {
    await expect(withRateLimit(async () => 42)).resolves.toBe(42);
  });

  it('429 avec Retry-After: 2 → nouvelle tentative après 2 s puis succès', async () => {
    const { run } = createRateLimiter();
    const fn = vi.fn().mockRejectedValueOnce(rateLimited({ 'Retry-After': '2' })).mockResolvedValueOnce('ok');
    const p = run(fn);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toBe('ok');
  });

  it('429 sans Retry-After → délais croissants 1 s, 2 s, 4 s', async () => {
    const { run } = createRateLimiter();
    const t0 = Date.now();
    const at: number[] = [];
    const fn = vi.fn(async () => {
      at.push(Date.now() - t0);
      if (at.length < 4) throw rateLimited();
      return 'ok';
    });
    const p = run(fn);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe('ok');
    expect(at).toEqual([0, 1000, 3000, 7000]);
  });

  it('429 en continu → l’erreur remonte après 3 nouvelles tentatives', async () => {
    const { run } = createRateLimiter();
    const err = rateLimited();
    const fn = vi.fn().mockRejectedValue(err);
    const p = run(fn);
    const assertion = expect(p).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('une erreur 400 → aucune nouvelle tentative', async () => {
    const { run } = createRateLimiter();
    const err = apiError(400, APIErrorCode.ValidationError);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(run(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('une erreur quelconque (non Notion) est relancée immédiatement', async () => {
    const { run } = createRateLimiter();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(run(fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('createNotionClient', () => {
  it('renvoie un client Notion v5 (data sources)', () => {
    const c = createNotionClient('secret_x');
    expect(typeof c.databases.create).toBe('function');
    expect(typeof c.dataSources.query).toBe('function');
  });
});
