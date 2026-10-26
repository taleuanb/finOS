import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

import { TAGS, revalidateNotion } from './cacheTags';

beforeEach(() => revalidateTag.mockReset());

describe('revalidateNotion', () => {
  it("invalide le tag de la base demandée", () => {
    revalidateNotion('assets');
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith('notion:assets');
  });
  it('invalide plusieurs bases, une fois chacune', () => {
    revalidateNotion('assets', 'debts', 'assets');
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual(['notion:assets', 'notion:debts']);
  });
  it('sans argument : toutes les bases Notion, pas series', () => {
    revalidateNotion();
    const called = revalidateTag.mock.calls.map((c) => c[0]);
    expect(called.sort()).toEqual(
      ['notion:assets', 'notion:movements', 'notion:debts', 'notion:budget', 'notion:strategy', 'notion:plan', 'notion:history'].sort(),
    );
    expect(called).not.toContain('series');
  });
  it("TAGS : valeurs exactes du contrat", () => {
    expect(TAGS).toEqual({
      assets: 'notion:assets', movements: 'notion:movements', debts: 'notion:debts', budget: 'notion:budget',
      strategy: 'notion:strategy', plan: 'notion:plan', history: 'notion:history', series: 'series',
    });
  });
  it('series peut être invalidé explicitement', () => {
    revalidateNotion('series');
    expect(revalidateTag).toHaveBeenCalledWith('series');
  });
});
