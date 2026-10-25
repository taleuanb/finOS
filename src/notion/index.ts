import type { Repo } from './repo';
import { FakeRepo, fixtureSeed } from './fakeRepo';
import { createNotionClient, withRateLimit } from './client';
import { createNotionRepo } from './notionRepo';
import { DB } from './schema';

// Un seul FakeRepo par processus : en dev, les écritures persistent d'une requête à l'autre.
let fake: FakeRepo | undefined;

/**
 * Repo Notion si NOTION_TOKEN est défini (les ids de sources de données viennent de NOTION_DB_*),
 * sinon FakeRepo sur les données des maquettes.
 */
export function getRepo(): Repo {
  const token = process.env.NOTION_TOKEN;
  if (!token) return (fake ??= new FakeRepo(fixtureSeed));

  const names = (Object.keys(DB) as (keyof typeof DB)[]).map((k) => [k, `NOTION_DB_${k.toUpperCase()}`] as const);
  const missing = names.filter(([, v]) => !process.env[v]).map(([, v]) => v);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement Notion manquantes : ${missing.join(', ')}`);
  }
  const ids = Object.fromEntries(names.map(([k, v]) => [k, process.env[v]!])) as Record<keyof typeof DB, string>;
  return createNotionRepo(createNotionClient(token), ids, withRateLimit);
}
