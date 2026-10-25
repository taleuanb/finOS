import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, verifySessionToken } from '@/auth/session';

const ORIGINAL = { ...process.env };

function loginRequest(password: string | null, as: 'form' | 'json' = 'form') {
  const url = 'https://wealth.example.com/api/login';
  if (as === 'json') {
    return new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }
  return new Request(url, {
    method: 'POST',
    body: new URLSearchParams(password === null ? {} : { password }),
  });
}

beforeEach(() => {
  process.env.APP_PASSWORD = 'correct horse';
  process.env.SESSION_SECRET = 'secret-de-session-de-test';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('POST /api/login', () => {
  it('bon mot de passe : 303 vers / et cookie de session', async () => {
    const res = await POST(loginRequest('correct horse'));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=2592000/i);

    const token = decodeURIComponent(setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]);
    expect(await verifySessionToken(token, process.env.SESSION_SECRET!, Date.now())).toBe(true);
  });

  it('accepte aussi un corps JSON', async () => {
    const res = await POST(loginRequest('correct horse', 'json'));
    expect(res.status).toBe(303);
  });

  it('mauvais mot de passe : 401 sans cookie', async () => {
    const res = await POST(loginRequest('mauvais'));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ error: 'Mot de passe incorrect' });
  });

  it('mot de passe absent ou vide : 401', async () => {
    expect((await POST(loginRequest(null))).status).toBe(401);
    expect((await POST(loginRequest(''))).status).toBe(401);
  });

  it('APP_PASSWORD manquant : 500 explicite, jamais de mot de passe vide accepté', async () => {
    delete process.env.APP_PASSWORD;
    const res = await POST(loginRequest(''));
    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error).toContain('APP_PASSWORD');

    process.env.APP_PASSWORD = '';
    expect((await POST(loginRequest(''))).status).toBe(500);
  });

  it('SESSION_SECRET manquant : 500 explicite', async () => {
    delete process.env.SESSION_SECRET;
    const res = await POST(loginRequest('correct horse'));
    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error).toContain('SESSION_SECRET');
  });
});
