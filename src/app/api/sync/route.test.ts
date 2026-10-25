import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
const runSync = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));
vi.mock('@/sync/run', () => ({ runSync: (...a: unknown[]) => runSync(...a) }));
vi.mock('@/notion', () => ({ getRepo: () => ({ fake: true }) }));
vi.mock('@/prices/yahoo', () => ({ createYahooProvider: () => ({ yahoo: true }) }));
vi.mock('@/prices/coingecko', () => ({ createCoinGeckoProvider: () => ({ crypto: true }) }));
vi.mock('@/prices/fx', () => ({ createFxProvider: () => ({ fx: true }) }));

import { GET, POST, dynamic } from './route';

const report = { date: '2026-10-27', updated: 18, errors: [{ assetId: 'hsbc', message: 'x' }], partial: true };

beforeEach(() => {
  revalidateTag.mockReset();
  runSync.mockReset();
});

describe('/api/sync', () => {
  it('est dynamique', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it.each([['GET', GET], ['POST', POST]] as const)('%s : lance la synchro, vide le cache et renvoie le rapport (200 même partiel)', async (_m, handler) => {
    runSync.mockResolvedValue(report);
    const res = await handler();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(runSync).toHaveBeenCalledWith(expect.objectContaining({
      repo: { fake: true }, yahoo: { yahoo: true }, crypto: { crypto: true }, fx: { fx: true }, now: expect.any(Date),
    }));
    expect(revalidateTag).toHaveBeenCalledWith('notion');
  });

  it('500 si runSync lui-même lève', async () => {
    runSync.mockRejectedValue(new Error('Notion indisponible'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Notion indisponible' });
  });
});
