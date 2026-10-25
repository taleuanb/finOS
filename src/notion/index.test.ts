import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo } from './fakeRepo';
import { getRepo } from './index';

const DB_VARS = [
  'NOTION_DB_ASSETS', 'NOTION_DB_MOVEMENTS', 'NOTION_DB_DEBTS', 'NOTION_DB_BUDGET',
  'NOTION_DB_STRATEGY', 'NOTION_DB_PLAN', 'NOTION_DB_HISTORY',
];

afterEach(() => vi.unstubAllEnvs());

describe('getRepo', () => {
  it('sans NOTION_TOKEN : un seul FakeRepo par processus, les écritures persistent', async () => {
    vi.stubEnv('NOTION_TOKEN', '');
    const a = getRepo();
    expect(a).toBeInstanceOf(FakeRepo);
    expect(getRepo()).toBe(a);

    const before = (await a.listBudget()).length;
    await a.upsertBudgetLine({ name: 'Test', section: 'depense', category: 'Divers', monthlyAmount: 1, currency: 'EUR', order: 99 });
    expect(await getRepo().listBudget()).toHaveLength(before + 1);
  });

  it('avec NOTION_TOKEN : liste en français les variables NOTION_DB_* manquantes', () => {
    vi.stubEnv('NOTION_TOKEN', 'secret_test');
    for (const v of DB_VARS) vi.stubEnv(v, '');
    vi.stubEnv('NOTION_DB_ASSETS', 'ds-assets');
    expect(() => getRepo()).toThrow(/NOTION_DB_MOVEMENTS.*NOTION_DB_HISTORY/);
    expect(() => getRepo()).not.toThrow(/NOTION_DB_ASSETS/);
  });

  it('avec NOTION_TOKEN et toutes les variables : renvoie le Repo Notion (pas le FakeRepo)', () => {
    vi.stubEnv('NOTION_TOKEN', 'secret_test');
    for (const v of DB_VARS) vi.stubEnv(v, `ds-${v}`);
    const repo = getRepo();
    expect(repo).not.toBeInstanceOf(FakeRepo);
    expect(typeof repo.listAssets).toBe('function');
  });
});
