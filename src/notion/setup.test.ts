import { describe, expect, it } from 'vitest';
import { DB, OPT, P, STRATEGY_KEY } from './schema';
import { setupNotion } from './setup';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeClient() {
  const calls: { op: string; args: any }[] = [];
  let n = 0;
  const client = {
    pages: {
      async create(args: any) { calls.push({ op: 'pages.create', args }); return { id: `page-${++n}` }; },
    },
    databases: {
      async create(args: any) {
        calls.push({ op: 'databases.create', args });
        const i = ++n;
        return { id: `db-${i}`, data_sources: [{ id: `ds-${i}`, name: '' }] };
      },
    },
    dataSources: {
      async update(args: any) { calls.push({ op: 'dataSources.update', args }); return { id: args.data_source_id }; },
      async retrieve(args: any) {
        calls.push({ op: 'dataSources.retrieve', args });
        // Propriété créée côté Actifs par la relation double de Mouvements (ds-3), au nom choisi par Notion.
        const mov = calls.find(c => c.op === 'databases.create' && c.args.initial_data_source.properties[P.movements.asset]);
        const name = relationName;
        return {
          id: args.data_source_id,
          properties: mov && args.data_source_id === 'ds-2'
            ? { [P.assets.name]: { type: 'title', title: {} }, [name]: { type: 'relation', relation: { data_source_id: 'ds-3', type: 'dual_property' } } }
            : {},
        };
      },
    },
  };
  let relationName: string = P.assets.movements;
  return { client, calls, renameRelation: (n: string) => { relationName = n; } };
}

const identity = <T>(fn: () => Promise<T>) => fn();
const titleOf = (args: any) => args.title?.[0]?.text?.content as string | undefined;

describe('setupNotion', () => {
  it('renvoie les 7 identifiants (sources de données) des bases', async () => {
    const { client } = fakeClient();
    const ids = await setupNotion(client, 'parent-1', identity);
    expect(Object.keys(ids).sort()).toEqual(Object.keys(DB).sort());
    expect(new Set(Object.values(ids)).size).toBe(7);
    expect(ids.assets).toMatch(/^ds-/);
  });

  it('crée dans l’ordre : page, Actifs, Mouvements, formules, rollups, puis les autres bases', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const steps = calls.map(c => {
      if (c.op === 'pages.create') {
        return c.args.parent.page_id === 'parent-1' ? 'page:Patrimoine' : `row:${c.args.properties[P.strategy.key].title[0].text.content}`;
      }
      if (c.op === 'databases.create') return `db:${titleOf(c.args)}`;
      if (c.op === 'dataSources.retrieve') return `retrieve:${c.args.data_source_id}`;
      return `update:${c.args.data_source_id}:${Object.keys(c.args.properties).join('+')}`;
    });
    const dbOrder = steps.filter(s => s.startsWith('db:'));
    expect(steps[0]).toBe('page:Patrimoine');
    expect(dbOrder).toEqual([DB.assets, DB.movements, DB.debts, DB.budget, DB.strategy, DB.plan, DB.history].map(t => `db:${t}`));
    const idx = (s: string) => steps.findIndex(x => x.startsWith(s));
    const iMov = idx(`db:${DB.movements}`);
    const iFormulas = idx(`update:ds-3:${P.movements.signedQuantity}`);
    const iRollups = idx(`update:ds-2:${P.assets.quantity}`);
    const iDebts = idx(`db:${DB.debts}`);
    expect(idx(`db:${DB.assets}`)).toBeLessThan(iMov);
    expect(iMov).toBeLessThan(iFormulas);
    expect(iFormulas).toBeLessThan(iRollups);
    expect(iRollups).toBeLessThan(iDebts);
    // les lignes par défaut de la Stratégie viennent après la création de la base
    expect(idx('row:')).toBeGreaterThan(idx(`db:${DB.strategy}`));
    expect(idx('row:')).toBeLessThan(idx(`db:${DB.plan}`));
  });

  it('crée la page « Patrimoine » sous la page parente et les bases sous cette page', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const page = calls[0];
    expect(page.args.parent).toEqual({ type: 'page_id', page_id: 'parent-1' });
    expect(page.args.properties.title.title[0].text.content).toBe('Patrimoine');
    for (const c of calls.filter(c => c.op === 'databases.create')) {
      expect(c.args.parent).toEqual({ type: 'page_id', page_id: 'page-1' });
    }
  });

  it('Mouvements : relation double vers Actifs, qui crée la propriété « Mouvements » côté Actifs', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const assets = calls.find(c => titleOf(c.args) === DB.assets)!;
    const mov = calls.find(c => titleOf(c.args) === DB.movements)!;
    const rel = mov.args.initial_data_source.properties[P.movements.asset].relation;
    expect(rel.data_source_id).toBe('ds-2');
    expect(rel.dual_property.synced_property_name).toBe(P.assets.movements);
    expect(assets.args.initial_data_source.properties[P.assets.movements]).toBeUndefined();
    const classes = assets.args.initial_data_source.properties[P.assets.assetClass].select.options.map((o: any) => o.name);
    expect(classes).toHaveLength(10);
  });

  it('formules signées sur Mouvements et rollups (somme) sur Actifs', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const f = calls.find(c => c.op === 'dataSources.update' && c.args.data_source_id === 'ds-3')!.args.properties;
    expect(f[P.movements.signedQuantity].formula.expression)
      .toBe(`if(prop("${P.movements.kind}") == "${OPT.kind.sell}", -prop("${P.movements.quantity}"), prop("${P.movements.quantity}"))`);
    expect(f[P.movements.signedAmount].formula.expression)
      .toBe(`if(prop("${P.movements.kind}") == "${OPT.kind.sell}", -prop("${P.movements.amount}"), prop("${P.movements.amount}"))`);
    expect(f[P.movements.premium].formula.expression).toContain(P.movements.spotEurPerKg);
    const updates = calls.filter(c => c.op === 'dataSources.update' && c.args.data_source_id === 'ds-2');
    const props = Object.assign({}, ...updates.map(u => u.args.properties));
    expect(props[P.assets.quantity].rollup).toEqual({
      function: 'sum', relation_property_name: P.assets.movements, rollup_property_name: P.movements.signedQuantity,
    });
    expect(props[P.assets.costBasis].rollup).toEqual({
      function: 'sum', relation_property_name: P.assets.movements, rollup_property_name: P.movements.signedAmount,
    });
    expect(props[P.assets.gain].formula.expression).toContain(P.assets.costBasis);
    // I6 : « % » ne référence pas « Plus-value », créée dans la même requête : formule développée.
    expect(props[P.assets.gainPct].formula.expression).toBe(
      `if(prop("${P.assets.costBasis}") > 0, (prop("${P.assets.value}") - prop("${P.assets.costBasis}")) / prop("${P.assets.costBasis}"), 0)`,
    );
    expect(props[P.assets.gainPct].formula.expression).not.toContain(`prop("${P.assets.gain}")`);
  });

  it('Stratégie : lignes par défaut (cibles, 5 zones, investissement 900, devise EUR)', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const rows = calls
      .filter(c => c.op === 'pages.create' && c.args.parent.data_source_id === 'ds-6')
      .map(c => c.args.properties);
    const get = (key: string) => rows.find(r => r[P.strategy.key].title[0].text.content === key);
    expect(rows.filter(r => r[P.strategy.key].title[0].text.content.startsWith(STRATEGY_KEY.zonePrefix))).toHaveLength(5);
    expect(get(STRATEGY_KEY.monthlyInvest)[P.strategy.value].number).toBe(900);
    expect(get(STRATEGY_KEY.displayCurrency)[P.strategy.text].rich_text[0].text.content).toBe('EUR');
    expect(get('zone:Neutre')[P.strategy.value].number).toBe(55);
    expect(get('zone:Neutre')[P.strategy.text].rich_text[0].text.content).toBe('50-65');
    expect(get('zone:Argent bon marché')[P.strategy.text].rich_text[0].text.content).toBe('80-');
    expect(get('zone:Argent bon marché')[P.strategy.value].number).toBe(20);
    expect(get(`${STRATEGY_KEY.targetPrefix}Fonds & ETF`)[P.strategy.value].number).toBe(45);
    expect(get(`${STRATEGY_KEY.targetPrefix}Métaux précieux`)[P.strategy.value].number).toBe(8);
  });

  it('Stratégie, Plan et Dettes : relations simples vers Actifs ; Historique : une colonne € par classe', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const byTitle = (t: string) => calls.find(c => titleOf(c.args) === t)!.args.initial_data_source.properties;
    expect(byTitle(DB.strategy)[P.strategy.asset].relation.data_source_id).toBe('ds-2');
    expect(byTitle(DB.strategy)[P.strategy.asset].relation.single_property).toEqual({});
    expect(byTitle(DB.plan)[P.plan.asset].relation.single_property).toEqual({});
    expect(byTitle(DB.debts)[P.debts.financedAsset].relation.single_property).toEqual({});
    const hist = byTitle(DB.history);
    for (const col of Object.values(P.history.byClass)) expect(hist[col].number).toBeDefined();
    expect(hist[P.history.partial].checkbox).toEqual({});
    expect(hist[P.history.date].date).toEqual({});
    for (const t of Object.values(DB)) expect(Object.values(byTitle(t)).filter((p: any) => p.title).length).toBe(1);
  });

  it('I6 : rollups sur le vrai nom de la relation renvoyé par Notion', async () => {
    const { client, calls, renameRelation } = fakeClient();
    renameRelation('Mouvements 1');
    await setupNotion(client, 'parent-1', identity);
    expect(calls.some(c => c.op === 'dataSources.retrieve' && c.args.data_source_id === 'ds-2')).toBe(true);
    const props = Object.assign({}, ...calls.filter(c => c.op === 'dataSources.update' && c.args.data_source_id === 'ds-2').map(u => u.args.properties));
    expect(props[P.assets.quantity].rollup.relation_property_name).toBe('Mouvements 1');
    expect(props[P.assets.costBasis].rollup.relation_property_name).toBe('Mouvements 1');
  });

  it('I6 : chaque identifiant est signalé dès la création de sa base', async () => {
    const { client, calls } = fakeClient();
    const seen: { key: string; id: string; callsSoFar: number }[] = [];
    await setupNotion(client, 'parent-1', identity, (key, id) => seen.push({ key, id, callsSoFar: calls.length }));
    expect(seen.map(x => x.key)).toEqual(['assets', 'movements', 'debts', 'budget', 'strategy', 'plan', 'history']);
    expect(seen[0]).toMatchObject({ id: 'ds-2', callsSoFar: 2 }); // juste après la page et la base Actifs
  });

  it('I6 : en cas d’échec, les bases déjà créées ont été signalées', async () => {
    const { client } = fakeClient();
    let n = 0;
    const failing = { ...client, databases: { async create(args: any) { if (++n === 3) throw new Error('Notion 500'); return client.databases.create(args); } } };
    const seen: string[] = [];
    await expect(setupNotion(failing, 'parent-1', identity, (key) => seen.push(key))).rejects.toThrow('Notion 500');
    expect(seen).toEqual(['assets', 'movements']);
  });

  it('I7 : Stratégie contient les lignes actif:or, actif:argent et actif:epargne (relation vide)', async () => {
    const { client, calls } = fakeClient();
    await setupNotion(client, 'parent-1', identity);
    const keys = calls
      .filter(c => c.op === 'pages.create' && c.args.parent.data_source_id === 'ds-6')
      .map(c => c.args.properties[P.strategy.key].title[0].text.content);
    expect(keys).toEqual(expect.arrayContaining([STRATEGY_KEY.gold, STRATEGY_KEY.silver, STRATEGY_KEY.savings]));
  });
});

