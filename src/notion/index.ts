import { unstable_cache } from 'next/cache';
import type { Repo } from './repo';
import { FakeRepo, fixtureSeed } from './fakeRepo';
import { createNotionClient, withRateLimit } from './client';
import { createNotionRepo, retrieveSchema } from './notionRepo';
import { DB } from './schema';

// Un seul FakeRepo par processus : en dev, les écritures persistent d'une requête à l'autre.
let fake: FakeRepo | undefined;
// Un seul Repo Notion par jeu de variables : sa mémoire du schéma des bases (filter_properties) survit entre les requêtes.
let notion: { signature: string; repo: Repo } | undefined;

/** Vrai si l'app tourne sur les données de démonstration : pas de NOTION_TOKEN et WOS_DEMO=1. */
export function isDemo(): boolean {
  return !process.env.NOTION_TOKEN && process.env.WOS_DEMO === '1';
}

/**
 * Repo Notion si NOTION_TOKEN est défini (les ids de sources de données viennent de NOTION_DB_*).
 * Sans NOTION_TOKEN : FakeRepo sur les données des maquettes **uniquement** si WOS_DEMO=1, sinon erreur
 * (une variable oubliée en production ne doit jamais afficher de fausses données).
 */
export function getRepo(): Repo {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    if (isDemo()) return (fake ??= new FakeRepo(fixtureSeed));
    throw new Error(
      'NOTION_TOKEN manquant : renseignez les variables Notion, ou lancez les données de démonstration avec WOS_DEMO=1.',
    );
  }

  const names = (Object.keys(DB) as (keyof typeof DB)[]).map((k) => [k, `NOTION_DB_${k.toUpperCase()}`] as const);
  const missing = names.filter(([, v]) => !process.env[v]).map(([, v]) => v);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement Notion manquantes : ${missing.join(', ')}`);
  }
  const ids = Object.fromEntries(names.map(([k, v]) => [k, process.env[v]!])) as Record<keyof typeof DB, string>;
  const signature = JSON.stringify([token, ids]);
  if (notion?.signature !== signature) {
    const client = createNotionClient(token);
    // Le schéma des bases (nom de colonne -> identifiant) change rarement : un cache partagé entre instances serverless
    // évite qu'une instance froide paie un `retrieve` par base. Un échec n'est jamais mis en cache.
    const schema = unstable_cache(
      (dsId: string) => retrieveSchema(client, dsId, withRateLimit),
      ['notion-schema'],
      { revalidate: 86_400, tags: ['notion-schema'] },
    );
    notion = { signature, repo: createNotionRepo(client, ids, withRateLimit, { schema }) };
  }
  return notion.repo;
}
