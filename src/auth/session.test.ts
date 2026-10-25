import { describe, expect, it } from 'vitest';
import {
  SESSION_DURATION_MS,
  constantTimeEqual,
  createSessionToken,
  verifySessionToken,
} from './session';

const SECRET = 'un-secret-de-test-assez-long';
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

describe('createSessionToken / verifySessionToken', () => {
  it('accepte un jeton valide', async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifySessionToken(token, SECRET, NOW + 1000)).toBe(true);
  });

  it("encode l'expiration à 30 jours", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(Number(token.split('.')[0])).toBe(NOW + SESSION_DURATION_MS);
    expect(SESSION_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('refuse un jeton daté de plus de 30 jours', async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(token, SECRET, NOW + SESSION_DURATION_MS - 1)).toBe(true);
    expect(await verifySessionToken(token, SECRET, NOW + SESSION_DURATION_MS)).toBe(false);
    expect(await verifySessionToken(token, SECRET, NOW + SESSION_DURATION_MS + 1)).toBe(false);
  });

  it('refuse une signature altérée', async () => {
    const token = await createSessionToken(SECRET, NOW);
    const [exp, sig] = token.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(await verifySessionToken(`${exp}.${flipped}`, SECRET, NOW)).toBe(false);
    expect(await verifySessionToken(`${exp}.`, SECRET, NOW)).toBe(false);
  });

  it('refuse une expiration altérée (prolongation)', async () => {
    const token = await createSessionToken(SECRET, NOW);
    const [exp, sig] = token.split('.');
    const forged = `${Number(exp) + SESSION_DURATION_MS}.${sig}`;
    expect(await verifySessionToken(forged, SECRET, NOW)).toBe(false);
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const token = await createSessionToken('autre-secret', NOW);
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(false);
  });

  it('refuse les jetons mal formés ou vides', async () => {
    for (const bad of ['', 'abc', '.', 'x.y', '1.2.3', 'NaN.sig', '-5.sig']) {
      expect(await verifySessionToken(bad, SECRET, NOW)).toBe(false);
    }
  });

  it('refuse tout jeton si le secret est vide', async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(token, '', NOW)).toBe(false);
    await expect(createSessionToken('', NOW)).rejects.toThrow();
  });
});

describe('constantTimeEqual', () => {
  it('compare des chaînes de longueurs différentes sans lever', async () => {
    expect(await constantTimeEqual('abc', 'abc')).toBe(true);
    expect(await constantTimeEqual('abc', 'abd')).toBe(false);
    expect(await constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(await constantTimeEqual('', 'a')).toBe(false);
  });
});
