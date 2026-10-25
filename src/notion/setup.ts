import { ASSET_CLASSES, DEFAULT_METAL_GRID } from '../domain/types';
import { withRateLimit } from './client';
import { DB, OPT, P, STRATEGY_KEY } from './schema';

/**
 * Sous-ensemble du `Client` de @notionhq/client (API v5 : une base contient des « data sources »).
 * Typage volontairement lâche pour pouvoir passer un faux client dans les tests.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SetupClient {
  pages: { create(args: any): Promise<any> };
  databases: { create(args: any): Promise<any> };
  dataSources: { update(args: any): Promise<any> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Run = <T>(fn: () => Promise<T>) => Promise<T>;
type Props = Record<string, unknown>;

// --- Fabriques de propriétés (format `initial_data_source.properties` / `dataSources.update`) ---
const title = () => ({ title: {} });
const text = () => ({ rich_text: {} });
const num = () => ({ number: {} });
const date = () => ({ date: {} });
const checkbox = () => ({ checkbox: {} });
const select = (options: readonly string[]) => ({ select: { options: options.map(name => ({ name })) } });
const formula = (expression: string) => ({ formula: { expression } });
const singleRelation = (dataSourceId: string) => ({ relation: { data_source_id: dataSourceId, single_property: {} } });
const sumRollup = (relation: string, property: string) => ({
  rollup: { function: 'sum', relation_property_name: relation, rollup_property_name: property },
});

const CURRENCIES = ['EUR', 'MAD', 'USD'] as const;
const INSTITUTIONS = ['Revolut', 'LCL', 'Suravenir', 'Finary', 'Banque Maroc', 'Physique'] as const;
const NATURES = ['Pièce', 'Lingot', 'Bijou', 'Part', 'Token', 'Versement'] as const;
const BUDGET_CATEGORIES = [
  'Activité', 'Revenus locatifs', 'Logement', 'Vie quotidienne', 'Abonnements', 'Dons & famille',
] as const;
const DEBT_TYPES = ['Crédit immobilier', 'Crédit consommation', 'Autre'] as const;

/** Valeurs initiales des cibles par classe, en % (spec §4.5). */
const DEFAULT_TARGETS: [string, number][] = [
  ['Fonds & ETF', 45], ['PER', 20], ['Crypto', 10], ['Métaux précieux', 8], ['Startups', 5],
];

const signed = (field: string) =>
  `if(prop("${P.movements.kind}") == "${OPT.kind.sell}", -prop("${field}"), prop("${field}"))`;

/**
 * Crée la page « Patrimoine » sous `parentPageId` puis les 7 bases (spec §4.1 à 4.7).
 * Renvoie, pour chaque base, l'identifiant de sa **source de données** (v5 : c'est lui que les requêtes
 * `dataSources.query`, `pages.create({ parent: { data_source_id } })` et les relations attendent).
 */
export async function setupNotion(
  client: SetupClient,
  parentPageId: string,
  run: Run = withRateLimit,
): Promise<Record<keyof typeof DB, string>> {
  let rootPageId = '';

  const createDatabase = async (name: string, properties: Props, parent = rootPageId): Promise<string> => {
    const db = await run(() => client.databases.create({
      parent: { type: 'page_id', page_id: parent },
      title: [{ type: 'text', text: { content: name } }],
      initial_data_source: { properties },
    }));
    const dataSourceId = db?.data_sources?.[0]?.id;
    if (!dataSourceId) throw new Error(`Notion n'a renvoyé aucune source de données pour la base « ${name} ».`);
    return dataSourceId as string;
  };
  const addProperties = (dataSourceId: string, properties: Props) =>
    run(() => client.dataSources.update({ data_source_id: dataSourceId, properties }));

  // 1. Page « Patrimoine »
  const page = await run(() => client.pages.create({
    parent: { type: 'page_id', page_id: parentPageId },
    properties: { title: { title: [{ text: { content: 'Patrimoine' } }] } },
  }));
  rootPageId = page.id;

  // 2. Actifs (sans rollups : ils exigent la relation et les formules de Mouvements)
  const a = P.assets;
  const assets = await createDatabase(DB.assets, {
    [a.name]: title(),
    [a.assetClass]: select(ASSET_CLASSES),
    [a.subtype]: text(),
    [a.institution]: select(INSTITUTIONS),
    [a.currency]: select(CURRENCIES),
    [a.mode]: select([OPT.mode.auto, OPT.mode.manual]),
    [a.quoteId]: text(),
    [a.manualValue]: num(),
    [a.manualValueDate]: date(),
    [a.unitPrice]: num(),
    [a.value]: num(),
    [a.valueEur]: num(),
    [a.fixedMonthly]: num(),
    [a.syncStatus]: text(),
    [a.lastUpdate]: date(),
    [a.archived]: checkbox(),
  });

  // 3. Mouvements, avec la relation double vers Actifs (crée la propriété « Mouvements » côté Actifs)
  const m = P.movements;
  const movements = await createDatabase(DB.movements, {
    [m.label]: title(),
    [m.date]: date(),
    [m.asset]: { relation: { data_source_id: assets, dual_property: { synced_property_name: a.movements } } },
    [m.kind]: select([OPT.kind.buy, OPT.kind.sell]),
    [m.nature]: select(NATURES),
    [m.quantity]: num(),
    [m.amount]: num(),
    [m.spotEurPerKg]: num(),
    [m.planMonth]: text(),
  });

  // 4. Formules de Mouvements : valeurs signées + prime (métaux : Montant / (poids fin en kg × spot €/kg) − 1)
  await addProperties(movements, {
    [m.signedQuantity]: formula(signed(m.quantity)),
    [m.signedAmount]: formula(signed(m.amount)),
    [m.premium]: formula(
      `if(prop("${m.spotEurPerKg}") > 0 and prop("${m.quantity}") > 0, ` +
      `format(round((prop("${m.amount}") / (prop("${m.quantity}") / 1000 * prop("${m.spotEurPerKg}")) - 1) * 1000) / 10) + " %", "")`,
    ),
  });

  // 5. Rollups d'Actifs (somme des champs signés), puis plus-value et % qui s'appuient sur eux
  await addProperties(assets, {
    [a.quantity]: sumRollup(a.movements, m.signedQuantity),
    [a.costBasis]: sumRollup(a.movements, m.signedAmount),
  });
  await addProperties(assets, {
    [a.gain]: formula(`prop("${a.value}") - prop("${a.costBasis}")`),
    [a.gainPct]: formula(`if(prop("${a.costBasis}") > 0, prop("${a.gain}") / prop("${a.costBasis}"), 0)`),
  });

  // 6. Dettes, Budget, Stratégie
  const d = P.debts;
  const debts = await createDatabase(DB.debts, {
    [d.name]: title(),
    [d.type]: select(DEBT_TYPES),
    [d.currency]: select(CURRENCIES),
    [d.outstanding]: num(),
    [d.rate]: num(),
    [d.monthly]: num(),
    [d.endDate]: date(),
    [d.financedAsset]: singleRelation(assets),
    [d.valueEur]: num(),
  });

  const b = P.budget;
  const budget = await createDatabase(DB.budget, {
    [b.name]: title(),
    [b.section]: select([OPT.section.revenu, OPT.section.depense]),
    [b.category]: select(BUDGET_CATEGORIES),
    [b.monthlyAmount]: num(),
    [b.currency]: select(CURRENCIES),
    [b.order]: num(),
  });

  const s = P.strategy;
  const strategy = await createDatabase(DB.strategy, {
    [s.key]: title(),
    [s.value]: num(),
    [s.text]: text(),
    [s.asset]: singleRelation(assets),
  });

  const strategyRow = (key: string, value?: number, textValue?: string) => run(() => client.pages.create({
    parent: { type: 'data_source_id', data_source_id: strategy },
    properties: {
      [s.key]: { title: [{ text: { content: key } }] },
      ...(value !== undefined ? { [s.value]: { number: value } } : {}),
      ...(textValue !== undefined ? { [s.text]: { rich_text: [{ text: { content: textValue } }] } } : {}),
    },
  }));
  for (const [assetClass, pct] of DEFAULT_TARGETS) await strategyRow(`${STRATEGY_KEY.targetPrefix}${assetClass}`, pct);
  await strategyRow(STRATEGY_KEY.monthlyInvest, 900);
  for (const zone of DEFAULT_METAL_GRID) {
    const range = `${zone.min}-${Number.isFinite(zone.max) ? zone.max : ''}`;
    await strategyRow(`${STRATEGY_KEY.zonePrefix}${zone.label}`, Math.round(zone.goldShare * 100), range);
  }
  await strategyRow(STRATEGY_KEY.displayCurrency, undefined, 'EUR');

  // 7. Plan mensuel, Historique
  const p = P.plan;
  const plan = await createDatabase(DB.plan, {
    [p.month]: title(),
    [p.asset]: singleRelation(assets),
    [p.amount]: num(),
    [p.origin]: select([OPT.origin.fixe, OPT.origin.cible, OPT.origin.signal]),
  });

  const h = P.history;
  const history = await createDatabase(DB.history, {
    [h.title]: title(),
    [h.date]: date(),
    [h.totalAssetsEur]: num(),
    [h.totalDebtsEur]: num(),
    [h.netEur]: num(),
    ...Object.fromEntries(ASSET_CLASSES.map(c => [h.byClass[c], num()])),
    [h.goldSilverRatio]: num(),
    [h.eurMad]: num(),
    [h.eurUsd]: num(),
    [h.partial]: checkbox(),
  });

  return { assets, movements, debts, budget, strategy, plan, history };
}
