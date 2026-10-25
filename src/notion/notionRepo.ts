import type { Client } from '@notionhq/client';
import type { Asset, BudgetLine, Debt, Movement, PlanLine, Snapshot, Strategy } from '@/domain/types';
import {
  assetInputToProperties, budgetLineToProperties, debtInputToProperties, movementToProperties, pageToAsset, pageToBudgetLine, pageToDebt, pageToMovement,
  pageToPlanLine, pageToSnapshot, pageToStrategyRow, planLineToProperties, rowsToStrategy, snapshotToProperties,
  strategyEntryToProperties, valuationToProperties, type NotionPage, type NotionProps,
} from './mappers';
import { parisDate } from '@/domain/dates';
import type { Repo } from './repo';
import { DB, P } from './schema';

/**
 * Partie du client `@notionhq/client` (v5, API « data sources ») utilisée ici.
 * Le vrai `Client` y est assignable ; les tests passent un faux objet.
 * Les identifiants `NOTION_DB_*` sont des identifiants de data source.
 */
export interface NotionClientLike {
  dataSources: {
    query(args: {
      data_source_id: string;
      start_cursor?: string;
      page_size?: number;
      filter?: QueryFilter;
      sorts?: { property: string; direction: 'ascending' | 'descending' }[];
      /** Identifiants (pas les noms) des propriétés à renvoyer ; absent = toutes. */
      filter_properties?: string[];
    }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    /** Schéma de la base (pour convertir noms de colonnes -> identifiants). Absent : requêtes non filtrées. */
    retrieve?(args: { data_source_id: string }): Promise<{ properties?: Record<string, { id: string; type?: string }> }>;
  };
  pages: {
    create(args: { parent: { type: 'data_source_id'; data_source_id: string }; properties: NotionProps }): Promise<{ id: string }>;
    update(args: { page_id: string; properties?: NotionProps; in_trash?: boolean }): Promise<unknown>;
  };
}

type QueryFilter = NonNullable<Parameters<Client['dataSources']['query']>[0]['filter']>;

/** Limiteur de débit (T10) : toute requête Notion passe par lui. */
export type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

const identity: Limit = (fn) => fn();

/** Profondeur de l'historique lu par défaut (jours) : au-delà, les graphiques n'en ont pas besoin. */
const HISTORY_DAYS = 800;

/** Noms des colonnes d'une base (valeurs de `schema.ts`, y compris imbriquées), sauf les clés de premier niveau listées. */
const columns = (props: object, ...omit: string[]): string[] =>
  Object.entries(props).flatMap(([key, v]) => (omit.includes(key) ? [] : typeof v === 'string' ? [v] : columns(v as object)));

/**
 * Colonnes réellement lues par les mappers (le titre y figure toujours). Les colonnes calculées par Notion
 * (rollups Quantité / Prix de revient / Mouvements, formules Plus-value / % / Quantité signée / Montant signé / Prime %)
 * sont exclues : quantités et prix de revient viennent des mouvements (`positions.ts`).
 */
const ASSET_COLUMNS = columns(P.assets, 'quantity', 'costBasis', 'gain', 'gainPct', 'movements');
const MOVEMENT_COLUMNS = columns(P.movements, 'signedQuantity', 'signedAmount', 'premium');
const DEBT_COLUMNS = columns(P.debts);
const BUDGET_COLUMNS = columns(P.budget);
const STRATEGY_COLUMNS = columns(P.strategy);
const PLAN_COLUMNS = columns(P.plan);
const HISTORY_COLUMNS = columns(P.history); // titre, date, totaux, une colonne par classe, taux, ratio, partiel

const isPage = (r: unknown): r is NotionPage =>
  typeof r === 'object' && r !== null && typeof (r as NotionPage).id === 'string' && typeof (r as NotionPage).properties === 'object' && (r as NotionPage).properties !== null;

/** Schéma d'une base : nom de colonne -> identifiant et type Notion. */
export type DataSourceSchema = Record<string, { id: string; type: string }>;

/** Lit le schéma d'une base (un appel Notion, protégé par `limit`). Lève si Notion ne le donne pas. */
export async function retrieveSchema(client: NotionClientLike, dsId: string, limit: Limit = identity): Promise<DataSourceSchema> {
  const retrieve = client.dataSources.retrieve;
  if (!retrieve) throw new Error('dataSources.retrieve indisponible');
  const ds = await limit(() => retrieve.call(client.dataSources, { data_source_id: dsId }));
  if (!ds.properties) throw new Error('schéma de la base absent de la réponse');
  return Object.fromEntries(Object.entries(ds.properties).map(([name, def]) => [name, { id: def.id, type: def.type ?? '' }]));
}

/** Durée de vie, par instance, du schéma mémorisé (un identifiant de colonne recréée y est repris). */
const SCHEMA_TTL_MS = 3_600_000;

/** Erreur de validation Notion (400) : p. ex. un identifiant de propriété inconnu dans `filter_properties`. */
const isValidationError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && ((e as { status?: unknown }).status === 400 || (e as { code?: unknown }).code === 'validation_error');

/**
 * `opts.schema` : chargeur du schéma d'une base (par défaut, un `retrieve` Notion). Son résultat est mémorisé par
 * instance pendant 1 h (jamais un échec). Une colonne demandée mais absente du schéma mémorisé le fait recharger une fois ;
 * si elle manque toujours, ou si le schéma est illisible, la base est lue sans filtre : l'optimisation ne fait jamais échouer une lecture.
 */
export function createNotionRepo(
  client: NotionClientLike, ids: Record<keyof typeof DB, string>, limit: Limit = identity,
  opts: { schema?: (dsId: string) => Promise<DataSourceSchema> } = {},
): Repo {
  const loader = opts.schema ?? ((dsId: string) => retrieveSchema(client, dsId, limit));
  const canReadSchema = opts.schema !== undefined || client.dataSources.retrieve !== undefined;
  const memo = new Map<string, { at: number; schema: Promise<DataSourceSchema> }>();

  /** Schéma mémorisé de la base ; `fresh` ignore le mémo et le remplace. */
  function schemaOf(dsId: string, fresh = false): Promise<DataSourceSchema> {
    const known = memo.get(dsId);
    if (!fresh && known && Date.now() - known.at < SCHEMA_TTL_MS) return known.schema;
    const schema = loader(dsId);
    memo.set(dsId, { at: Date.now(), schema });
    schema.catch(() => { if (memo.get(dsId)?.schema === schema) memo.delete(dsId); }); // un échec n'est jamais mémorisé
    return schema;
  }

  /** Identifiants des colonnes demandées (+ le titre) ; `undefined` = pas de filtre (schéma illisible ou colonne absente). */
  async function filterPropertyIds(dsId: string, names: readonly string[]): Promise<string[] | undefined> {
    if (!canReadSchema) return undefined;
    try {
      let schema = await schemaOf(dsId);
      if (names.some((n) => !(n in schema))) {
        schema = await schemaOf(dsId, true); // schéma périmé ? un seul rechargement
        const missing = names.filter((n) => !(n in schema));
        if (missing.length > 0) {
          console.error(`Notion : colonnes absentes (${missing.join(', ')}), lecture non filtrée`);
          return undefined;
        }
      }
      const found = new Set<string>();
      for (const [name, def] of Object.entries(schema)) if (def.type === 'title' || names.includes(name)) found.add(def.id);
      return found.size > 0 ? [...found] : undefined;
    } catch (e) {
      console.error('Notion : schéma illisible, lecture non filtrée', e instanceof Error ? e.message : e);
      return undefined;
    }
  }

  /**
   * Lit toutes les pages d'une base en suivant `has_more` / `next_cursor`. `props` : noms des seules colonnes
   * à renvoyer (`filter_properties`) ; une optimisation, jamais une cause d'échec (sans schéma : toutes les colonnes).
   */
  async function queryAll(
    dsId: string,
    opts: {
      filter?: QueryFilter; sorts?: { property: string; direction: 'ascending' | 'descending' }[]; props?: readonly string[];
    } = {},
  ): Promise<NotionPage[]> {
    const run = async (filterProperties: string[] | undefined): Promise<NotionPage[]> => {
      const pages: NotionPage[] = [];
      let cursor: string | undefined;
      do {
        const start = cursor;
        const res = await limit(() =>
          client.dataSources.query({
            data_source_id: dsId,
            page_size: 100,
            ...(start ? { start_cursor: start } : {}),
            ...(opts.filter ? { filter: opts.filter } : {}),
            ...(opts.sorts ? { sorts: opts.sorts } : {}),
            ...(filterProperties ? { filter_properties: filterProperties } : {}),
          }),
        );
        pages.push(...res.results.filter(isPage)); // les résultats partiels (sans propriétés) sont écartés
        cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
      } while (cursor);
      return pages;
    };
    const filterProperties = opts.props ? await filterPropertyIds(dsId, opts.props) : undefined;
    if (!filterProperties) return run(undefined);
    try {
      return await run(filterProperties);
    } catch (e) {
      if (!isValidationError(e)) throw e;
      // Identifiant de propriété périmé (colonne recréée) : on oublie le schéma et on relit sans filtre, une fois.
      console.error('Notion : filter_properties rejeté, lecture non filtrée', e instanceof Error ? e.message : e);
      memo.delete(dsId);
      return run(undefined);
    }
  }

  const create = async (dsId: string, properties: NotionProps): Promise<string> => {
    const res = await limit(() => client.pages.create({ parent: { type: 'data_source_id', data_source_id: dsId }, properties }));
    return res.id;
  };
  const update = async (pageId: string, properties: NotionProps): Promise<void> => {
    if (Object.keys(properties).length === 0) return; // rien à écrire : pas d'appel Notion
    await limit(() => client.pages.update({ page_id: pageId, properties }));
  };

  const trash = async (pageId: string): Promise<void> => {
    await limit(() => client.pages.update({ page_id: pageId, in_trash: true }));
  };
  /** Pages Stratégie dont la clé est exactement `key` (filtre Notion + garde-fou côté client). */
  const strategyPages = async (key: string): Promise<NotionPage[]> =>
    (await queryAll(ids.strategy, { filter: { property: P.strategy.key, title: { equals: key } } }))
      .filter((page) => pageToStrategyRow(page).key === key);

  return {
    async listAssets(): Promise<Asset[]> {
      return (await queryAll(ids.assets, { props: ASSET_COLUMNS })).map(pageToAsset);
    },
    async listMovements(): Promise<Movement[]> {
      return (await queryAll(ids.movements, { props: MOVEMENT_COLUMNS })).map(pageToMovement);
    },
    async listDebts(): Promise<Debt[]> {
      return (await queryAll(ids.debts, { props: DEBT_COLUMNS })).map(pageToDebt);
    },
    async listBudget(): Promise<BudgetLine[]> {
      const lines = (await queryAll(ids.budget, { props: BUDGET_COLUMNS })).map(pageToBudgetLine);
      return lines.sort((a, b) => a.order - b.order);
    },
    async getStrategy(): Promise<Strategy> {
      return rowsToStrategy(await queryAll(ids.strategy, { props: STRATEGY_COLUMNS }));
    },
    async listPlan(): Promise<PlanLine[]> {
      return (await queryAll(ids.plan, { props: PLAN_COLUMNS })).map(pageToPlanLine);
    },
    async listSnapshots(sinceDate?: string): Promise<Snapshot[]> {
      // Sans date : les 800 derniers jours seulement (la première photo n'est pas indispensable).
      const since = sinceDate ?? parisDate(new Date(Date.now() - HISTORY_DAYS * 86_400_000));
      const pages = await queryAll(ids.history, {
        filter: { property: P.history.date, date: { on_or_after: since } },
        sorts: [{ property: P.history.date, direction: 'ascending' }],
        props: HISTORY_COLUMNS,
      });
      return pages.map(pageToSnapshot).sort((a, b) => a.date.localeCompare(b.date));
    },

    async updateAssetValuation(id, patch) {
      await update(id, valuationToProperties(patch));
    },
    async setMovementSpot(id, spotEurPerKg) {
      await update(id, { [P.movements.spotEurPerKg]: { number: spotEurPerKg } });
    },
    async upsertSnapshot(s) {
      // Idempotent : la page dont le titre est cette date est mise à jour, sinon créée.
      const existing = await queryAll(ids.history, { filter: { property: P.history.title, title: { equals: s.date } } });
      const properties = snapshotToProperties(s);
      if (existing.length > 0) await update(existing[0].id, properties);
      else await create(ids.history, properties);
    },
    async createMovement(m) {
      return create(ids.movements, movementToProperties(m));
    },
    async upsertBudgetLine(l) {
      const { id, ...line } = l;
      const properties = budgetLineToProperties(line);
      if (id) {
        await update(id, properties);
        return id;
      }
      return create(ids.budget, properties);
    },
    async deleteBudgetLine(id) {
      await trash(id);
    },
    async createPlanLines(lines) {
      for (const line of lines) await create(ids.plan, planLineToProperties(line));
    },

    async createAsset(a) {
      return create(ids.assets, assetInputToProperties(a));
    },
    async updateAsset(id, patch) {
      await update(id, assetInputToProperties(patch));
    },
    async createDebt(d) {
      return create(ids.debts, debtInputToProperties(d));
    },
    async updateDebt(id, patch) {
      await update(id, debtInputToProperties(patch));
    },
    async deleteDebt(id) {
      await trash(id);
    },
    async setStrategyEntry(entry) {
      const e = { ...entry, key: entry.key.trim() };
      const [existing] = await strategyPages(e.key);
      if (existing) await update(existing.id, strategyEntryToProperties(e, false));
      else await create(ids.strategy, strategyEntryToProperties(e, true));
    },
    async deleteStrategyEntry(key) {
      for (const page of await strategyPages(key.trim())) await trash(page.id);
    },
  };
}
