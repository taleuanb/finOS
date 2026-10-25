import { describe, expect, it } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE } from '@/auth/session';

describe('POST /api/logout', () => {
  it('efface le cookie et redirige vers /login (303)', async () => {
    const res = await POST(new Request('https://wealth.example.com/api/logout', { method: 'POST' }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
