import { describe, it, expect, vi } from 'vitest';
import fixture from './__fixtures__/er-api.json';
import { createFxProvider } from './fx';

const now = () => new Date('2026-10-31T23:30:00Z'); // 1er novembre à Paris

function okFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('createFxProvider', () => {
  it('retourne les taux avec la date de Paris', async () => {
    const fetchFn = okFetch(fixture);
    const rates = await createFxProvider(fetchFn, now).getRates();
    expect(rates).toEqual({ EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84, date: '2026-11-01' });
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://open.er-api.com/v6/latest/EUR',
    );
  });

  it('lève si result vaut error', async () => {
    const fetchFn = okFetch({ result: 'error', 'error-type': 'unsupported-code' });
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });

  it('lève sur une erreur HTTP', async () => {
    const fetchFn = okFetch(fixture, { ok: false, status: 500 });
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });

  it('lève si le réseau échoue', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('réseau'); }) as unknown as typeof fetch;
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });

  it("lève si le corps n'est pas du JSON valide", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('x'); },
    })) as unknown as typeof fetch;
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });

  it.each(['MAD', 'USD', 'GBP'])('lève si %s est manquant', async (code) => {
    const rates: Record<string, number> = { ...fixture.rates };
    delete rates[code];
    const fetchFn = okFetch({ ...fixture, rates });
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });

  it("lève si un taux n'est pas un nombre positif", async () => {
    const fetchFn = okFetch({ ...fixture, rates: { ...fixture.rates, MAD: 0 } });
    await expect(createFxProvider(fetchFn, now).getRates()).rejects.toThrow('taux de change indisponible');
  });
});
