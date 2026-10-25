import type { Client } from '@notionhq/client';
import type { Asset, BudgetLine, Debt, Movement, PlanLine, Snapshot, Strategy } from '@/domain/types';
import {
  assetInputToProperties, budgetLineToProperties, debtInputToProperties, movementToProperties, pageToAsset, pageToBudgetLine, pageToDebt, pageToMovement,
  pageToPlanLine, pageToSnapshot, pageToStrategyRow, planLineToProperties, rowsToStrategy, snapshotToProperties,
  strategyEntryToProperties, valuationToProperties, type NotionPage, type NotionProps,
} from './mappers';
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
    }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
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

const isPage = (r: unknown): r is NotionPage =>
  typeof r === 'object' && r !== null && typeof (r as NotionPage).id === 'string' && typeof (r as NotionPage).properties === 'object' && (r as NotionPage).properties !== null;

export function createNotionRepo(client: NotionClientLike, ids: Record<keyof typeof DB, string>, limit: Limit = identity): Repo {
  /** Lit toutes les pages d'une base en suivant `has_more` / `next_cursor`. */
  async function queryAll(
    dsId: string,
    opts: { filter?: QueryFilter; sorts?: { property: string; direction: 'ascending' | 'descending' }[] } = {},
  ): Promise<NotionPage[]> {
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
        }),
      );
      pages.push(...res.results.filter(isPage)); // les résultats partiels (sans propriétés) sont écartés
      cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
    } while (cursor);
    return pages;
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
      return (await queryAll(ids.assets)).map(pageToAsset);
    },
    async listMovements(): Promise<Movement[]> {
      return (await queryAll(ids.movements)).map(pageToMovement);
    },
    async listDebts(): Promise<Debt[]> {
      return (await queryAll(ids.debts)).map(pageToDebt);
    },
    async listBudget(): Promise<BudgetLine[]> {
      const lines = (await queryAll(ids.budget)).map(pageToBudgetLine);
      return lines.sort((a, b) => a.order - b.order);
    },
    async getStrategy(): Promise<Strategy> {
      return rowsToStrategy(await queryAll(ids.strategy));
    },
    async listPlan(): Promise<PlanLine[]> {
      return (await queryAll(ids.plan)).map(pageToPlanLine);
    },
    async listSnapshots(sinceDate?: string): Promise<Snapshot[]> {
      const pages = await queryAll(ids.history, {
        ...(sinceDate ? { filter: { property: P.history.date, date: { on_or_after: sinceDate } } } : {}),
        sorts: [{ property: P.history.date, direction: 'ascending' }],
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
