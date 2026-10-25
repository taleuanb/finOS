import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureDashboard as d } from './fixtures';
import { getRepo } from '@/notion';

afterEach(() => vi.unstubAllEnvs());

describe('fixtureDashboard', () => {
  it('est cohérent avec les maquettes', () => {
    expect(d.totals.netEur).toBeCloseTo(422000, 0);
    expect(d.totals.grossEur).toBeCloseTo(477300, 0);
    expect(d.totals.debtsEur).toBeCloseTo(55300, 0);
    expect(d.totals.grossEur - d.totals.debtsEur).toBeCloseTo(d.totals.netEur, 6);
    expect(d.assets).toHaveLength(19);
    expect(d.budget.savingsEur).toBeCloseTo(1769.75, 2);
    expect(d.budget.investEur).toBe(900);
    expect(d.plan).toMatchObject({ month: '2026-11', validated: true });
    expect(d.metals.ratio).toBeCloseTo(64.51, 2);
    expect(d.metals.zone?.label).toBe('Neutre');
    expect(d.metals.monthSplit).toEqual({ goldEur: 165, silverEur: 135 });
    expect(d.plan.lines.find((l) => l.assetId === 'syla')!.toInvestEur).toBe(600);
  });
  it('byClass est trié et somme à 100 %', () => {
    expect(d.byClass.every((c, i, a) => i === 0 || a[i - 1].valueEur >= c.valueEur)).toBe(true);
    expect(d.byClass.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(1, 9);
  });
  it('le dernier point d’historique égale le net, et topPerformers a 5 lignes triées', () => {
    expect(d.history[d.history.length - 1].netEur).toBeCloseTo(d.totals.netEur, 6);
    expect(d.topPerformers).toHaveLength(5);
    expect(d.topPerformers[0].id).toBe('ag');
  });
  it('getRepo sert les données des maquettes (mode démo)', async () => {
    vi.stubEnv('NOTION_TOKEN', '');
    vi.stubEnv('WOS_DEMO', '1');
    expect(await getRepo().listAssets()).toHaveLength(19);
  });
});
