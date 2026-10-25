import type { Repo } from './repo';

/** Méthodes de lecture du dépôt (toutes les autres écrivent dans Notion). */
const isRead = (name: string) => name.startsWith('list') || name.startsWith('get');

/**
 * Enveloppe un dépôt pour savoir si une écriture a été tentée. Sert aux actions à écritures multiples :
 * un échec en cours de route peut laisser des écritures partielles, le cache doit alors être invalidé
 * (comme le `finally` de la synchro) même si l'action renvoie une erreur.
 */
export function trackWrites(repo: Repo): { repo: Repo; attempted: () => boolean } {
  let attempted = false;
  const tracked = new Proxy(repo, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (isRead(prop)) return fn.bind(target);
      return (...args: unknown[]) => {
        attempted = true;
        return fn.apply(target, args);
      };
    },
  });
  return { repo: tracked, attempted: () => attempted };
}
