import { revalidateTag } from 'next/cache';

/** Tags de cache des lectures Notion (une par base) et des séries de cours. */
export const TAGS = {
  assets: 'notion:assets', movements: 'notion:movements', debts: 'notion:debts', budget: 'notion:budget',
  strategy: 'notion:strategy', plan: 'notion:plan', history: 'notion:history', series: 'series',
} as const;

export type CacheKey = keyof typeof TAGS;

const NOTION_KEYS = (Object.keys(TAGS) as CacheKey[]).filter((k) => k !== 'series');

/**
 * Invalide les caches des bases données (`revalidateTag` pour chaque tag, une fois chacun).
 * Sans argument : toutes les bases Notion (pas `series`).
 */
export function revalidateNotion(...keys: CacheKey[]): void {
  const targets = keys.length > 0 ? keys : NOTION_KEYS;
  for (const key of new Set(targets)) revalidateTag(TAGS[key]);
}
