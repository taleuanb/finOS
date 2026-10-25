import { describe, expect, it } from 'vitest';
import { FakeRepo, fixtureSeed } from './fakeRepo';
import { STRATEGY_KEY } from './schema';
import { trackWrites } from './trackWrites';

describe('trackWrites', () => {
  it('les lectures ne comptent pas, une écriture (même en échec) oui', async () => {
    const t = trackWrites(new FakeRepo(structuredClone(fixtureSeed)));
    await t.repo.listAssets();
    await t.repo.getStrategy();
    expect(t.attempted()).toBe(false);
    await t.repo.deleteStrategyEntry('inconnue');
    expect(t.attempted()).toBe(true);
  });

  it('délègue au dépôt réel', async () => {
    const repo = new FakeRepo(structuredClone(fixtureSeed));
    const t = trackWrites(repo);
    await t.repo.setStrategyEntry({ key: STRATEGY_KEY.monthlyInvest, value: 1234 });
    expect((await repo.getStrategy()).monthlyInvest).toBe(1234);
  });
});
