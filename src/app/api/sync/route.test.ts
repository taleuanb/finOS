import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const revalidateNotion = vi.fn((...a: unknown[]) => { order.push(`revalidate:${a.join(',')}`); });
const getDashboard = vi.fn(async () => { order.push('warm'); });
const runSync = vi.fn();
vi.mock('@/lib/cacheTags', () => ({ revalidateNotion: (...a: unknown[]) => revalidateNotion(...a) }));
vi.mock('@/lib/load', () => ({ getDashboard: () => getDashboard() }));
vi.mock('@/sync/run', () => ({ runSync: (...a: unknown[]) => runSync(...a) }));
vi.mock('@/notion', () => ({ getRepo: () => ({ fake: true }) }));
vi.mock('@/prices/yahoo', () => ({ createYahooProvider: () => ({ yahoo: true }) }));
vi.mock('@/prices/coingecko', () => ({ createCoinGeckoProvider: () => ({ crypto: true }) }));
vi.mock('@/prices/fx', () => ({ createFxProvider: () => ({ fx: true }) }));

import { GET, POST, dynamic, maxDuration } from './route';

const report = { date: '2026-10-27', updated: 18, errors: [{ assetId: 'hsbc', message: 'x' }], partial: true };

beforeEach(() => {
  order.length = 0;
  revalidateNotion.mockClear();
  getDashboard.mockReset();
  getDashboard.mockImplementation(async () => { order.push('warm'); });
  runSync.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/sync', () => {
  it('est dynamique', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('dispose de 60 s (Vercel Hobby) pour la synchro', () => {
    expect(maxDuration).toBe(60);
  });

  it.each([['GET', GET], ['POST', POST]] as const)('%s : lance la synchro, vide le cache et renvoie le rapport (200 même partiel)', async (_m, handler) => {
    runSync.mockResolvedValue(report);
    const res = await handler();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(runSync).toHaveBeenCalledWith(expect.objectContaining({
      repo: { fake: true }, yahoo: { yahoo: true }, crypto: { crypto: true }, fx: { fx: true }, now: expect.any(Date),
    }));
    expect(revalidateNotion).toHaveBeenCalledWith('assets', 'movements', 'history');
    expect(revalidateNotion).toHaveBeenCalledTimes(1);
  });

  it("invalide actifs, mouvements et historique PUIS préchauffe le tableau de bord, avant de répondre", async () => {
    runSync.mockResolvedValue(report);
    await GET();
    expect(order).toEqual(['revalidate:assets,movements,history', 'warm']);
  });

  it('ajoute un en-tête Server-Timing (synchro et préchauffage)', async () => {
    runSync.mockResolvedValue(report);
    const res = await GET();
    expect(res.headers.get('Server-Timing')).toMatch(/^sync;dur=\d+(\.\d+)?, warm;dur=\d+(\.\d+)?$/);
  });

  it('une erreur de préchauffage est journalisée mais ne fait pas échouer la réponse', async () => {
    runSync.mockResolvedValue(report);
    getDashboard.mockRejectedValue(new Error('Notion lent'));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(console.error).toHaveBeenCalled();
  });

  it("n'invalide ni ne préchauffe si la synchro lève", async () => {
    runSync.mockRejectedValue(new Error('Notion indisponible'));
    await GET();
    expect(revalidateNotion).not.toHaveBeenCalled();
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it('500 si runSync lui-même lève', async () => {
    runSync.mockRejectedValue(new Error('Notion indisponible'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Notion indisponible' });
  });
});
