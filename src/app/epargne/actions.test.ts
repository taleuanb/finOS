import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationLine } from '@/domain/types';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';

const revalidateNotion = vi.fn();
vi.mock('@/lib/cacheTags', () => ({ revalidateNotion: (...a: unknown[]) => revalidateNotion(...a) }));

let repo: FakeRepo;
vi.mock('@/notion', () => ({ getRepo: () => repo }));

const { declarePurchase, validatePlan } = await import('./actions');

const lines: AllocationLine[] = [
  { assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' },
  { assetId: 'hsbc', amount: 800, origin: 'cible', reason: 'Classe Fonds & ETF en retard sur sa cible' },
];

beforeEach(() => {
  revalidateNotion.mockClear();
  repo = new FakeRepo({ ...fixtureSeed, plan: [] });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('validatePlan (action)', () => {
  it('écrit le plan et invalide les caches mouvements et plan', async () => {
    expect(await validatePlan('2026-11', lines)).toEqual({ ok: true });
    expect(await repo.listPlan()).toHaveLength(2);
    expect(revalidateNotion).toHaveBeenCalledWith('movements', 'plan');
  });

  it('la seconde validation du même mois échoue sans invalider le cache', async () => {
    await validatePlan('2026-11', lines);
    revalidateNotion.mockClear();
    expect(await validatePlan('2026-11', lines)).toEqual({ ok: false, error: 'Plan déjà validé pour 2026-11' });
    expect(revalidateNotion).not.toHaveBeenCalled();
  });
});

describe('declarePurchase (action)', () => {
  it('crée un mouvement lié au mois du plan et invalide le cache', async () => {
    const before = (await repo.listMovements()).length;
    expect(await declarePurchase('syla', '2026-11', 600, '2026-11-05')).toEqual({ ok: true });
    expect((await repo.listMovements()).slice(before)).toEqual([
      expect.objectContaining({ assetId: 'syla', planMonth: '2026-11', label: 'Plan 2026-11', amount: 600 }),
    ]);
    expect(revalidateNotion).toHaveBeenCalledWith('movements', 'plan');
  });

  it("n'invalide pas le cache en cas de refus", async () => {
    expect((await declarePurchase('syla', '2026-11', 0, '2026-11-05')).ok).toBe(false);
    expect(revalidateNotion).not.toHaveBeenCalled();
  });
});
