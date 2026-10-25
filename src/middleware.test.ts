import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { SESSION_COOKIE, createSessionToken } from '@/auth/session';

const ORIGINAL = { ...process.env };
const SECRET = 'secret-de-session-de-test';

function req(path: string, init: { cookie?: string; auth?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', `${SESSION_COOKIE}=${init.cookie}`);
  if (init.auth) headers.set('authorization', init.auth);
  return new NextRequest(`https://wealth.example.com${path}`, { headers });
}

const isPass = (res: Response) => res.headers.get('x-middleware-next') === '1';

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.CRON_SECRET = 'cron-secret';
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('middleware', () => {
  it('laisse passer les routes publiques', async () => {
    for (const p of ['/login', '/api/login', '/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/icon.png']) {
      expect(isPass(await middleware(req(p))), p).toBe(true);
    }
  });

  it('redirige les pages vers /login sans cookie valide', async () => {
    const res = await middleware(req('/patrimoine'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('renvoie 401 JSON pour /api/* sans cookie valide', async () => {
    const res = await middleware(req('/api/assets'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Non authentifié' });
  });

  it('refuse un cookie invalide ou expiré', async () => {
    const old = await createSessionToken(SECRET, Date.now() - 31 * 24 * 3600 * 1000);
    expect((await middleware(req('/', { cookie: old }))).status).toBe(307);
    expect((await middleware(req('/', { cookie: 'n.importe.quoi' }))).status).toBe(307);
  });

  it('laisse passer avec un cookie valide', async () => {
    const token = await createSessionToken(SECRET, Date.now());
    expect(isPass(await middleware(req('/', { cookie: token })))).toBe(true);
    expect(isPass(await middleware(req('/api/assets', { cookie: token })))).toBe(true);
  });

  it('/api/sync : accepté avec Bearer CRON_SECRET, refusé sinon', async () => {
    expect(isPass(await middleware(req('/api/sync', { auth: 'Bearer cron-secret' })))).toBe(true);
    expect((await middleware(req('/api/sync', { auth: 'Bearer faux' }))).status).toBe(401);
    expect((await middleware(req('/api/sync'))).status).toBe(401);
    // le Bearer ne vaut que pour /api/sync
    expect((await middleware(req('/api/assets', { auth: 'Bearer cron-secret' }))).status).toBe(401);
  });

  it('/api/sync : CRON_SECRET absent ou vide ne laisse rien passer', async () => {
    delete process.env.CRON_SECRET;
    expect((await middleware(req('/api/sync', { auth: 'Bearer ' }))).status).toBe(401);
    process.env.CRON_SECRET = '';
    expect((await middleware(req('/api/sync', { auth: 'Bearer ' }))).status).toBe(401);
  });
});
