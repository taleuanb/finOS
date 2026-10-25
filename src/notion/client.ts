import { Client } from '@notionhq/client';

const WINDOW_MS = 1000;
const MAX_STARTS_PER_WINDOW = 3;
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
/** Un `Retry-After` démesuré ne doit pas bloquer une requête (ni la synchro) au-delà de 10 s. */
const MAX_RETRY_AFTER_MS = 10_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function isRateLimited(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; code?: unknown };
  return e.status === 429 || e.code === 'rate_limited';
}

/** Lit `Retry-After` (en secondes, ou date HTTP) sur une erreur Notion ; `undefined` si absent ou illisible. */
function retryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown }).headers;
  let raw: string | null | undefined;
  if (headers && typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('retry-after');
  } else if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'retry-after');
    const v = key ? (headers as Record<string, unknown>)[key] : undefined;
    raw = typeof v === 'string' ? v : undefined;
  }
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * File d'attente partagée : au plus 3 démarrages par fenêtre glissante de 1 s ; sur un 429, nouvelle tentative
 * après `Retry-After` plafonné à 10 s (sinon 1 s, 2 s, 4 s), 3 nouvelles tentatives au plus. Toute autre erreur est relancée telle quelle.
 */
export function createRateLimiter() {
  const starts: number[] = [];
  let gate: Promise<void> = Promise.resolve();

  function acquire(): Promise<void> {
    const slot = gate.then(async () => {
      for (;;) {
        const now = Date.now();
        while (starts.length > 0 && now - starts[0] >= WINDOW_MS) starts.shift();
        if (starts.length < MAX_STARTS_PER_WINDOW) { starts.push(now); return; }
        await sleep(starts[0] + WINDOW_MS - now);
      }
    });
    gate = slot;
    return slot;
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      try {
        return await fn();
      } catch (error) {
        if (!isRateLimited(error) || attempt >= MAX_RETRIES) throw error;
        const retryAfter = retryAfterMs(error);
        await sleep(retryAfter === undefined ? BACKOFF_MS[attempt] : Math.min(retryAfter, MAX_RETRY_AFTER_MS));
      }
    }
  }

  return { run };
}

const shared = createRateLimiter();

/** Limiteur partagé par tout le processus (Notion : 3 requêtes/s). */
export function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  return shared.run(fn);
}

/**
 * Client Notion officiel. Les nouvelles tentatives internes du SDK sont désactivées : `withRateLimit`
 * est seul responsable des 429 (sinon les délais s'additionneraient). Chaque appel doit passer par `withRateLimit`.
 */
export function createNotionClient(token: string): Client {
  return new Client({ auth: token, retry: false });
}
