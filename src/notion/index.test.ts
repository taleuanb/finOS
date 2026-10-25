import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRepo } from './fakeRepo';
import { getRepo, isDemo } from './index';

const DB_VARS = [
  'NOTION_DB_ASSETS', 'NOTION_DB_MOVEMENTS', 'NOTION_DB_DEBTS', 'NOTION_DB_BUDGET',
  'NOTION_DB_STRATEGY', 'NOTION_DB_PLAN', 'NOTION_DB_HISTORY',
];

afterEach(() => vi.unstubAllEnvs());

describe('getRepo', () => {
  it('I9 : sans NOTION_TOKEN et sans WOS_DEMO=1 : erreur en français (pas de données factices)', () => {
    vi.stubEnv('NOTION_TOKEN', '');
    vi.stubEnv('WOS_DEMO', '');
    expect(() => getRepo()).toThrow(/NOTION_TOKEN.*WOS_DEMO=1/);
    expect(isDemo()).toBe(false);
  });

  it('sans NOTION_TOKEN avec WOS_DEMO=1 : un seul FakeRepo par processus, les écritures persistent', async () => {
    vi.stubEnv('NOTION_TOKEN', '');
    vi.stubEnv('WOS_DEMO', '1');
    expect(isDemo()).toBe(true);
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

  it('avec NOTION_TOKEN et toutes les variables : renvoie le Repo Notion (pas le FakeRepo), même avec WOS_DEMO=1', () => {
    vi.stubEnv('NOTION_TOKEN', 'secret_test');
    vi.stubEnv('WOS_DEMO', '1');
    expect(isDemo()).toBe(false);
    for (const v of DB_VARS) vi.stubEnv(v, `ds-${v}`);
    const repo = getRepo();
    expect(repo).not.toBeInstanceOf(FakeRepo);
    expect(typeof repo.listAssets).toBe('function');
  });
});
