import { NextResponse, after } from 'next/server';
import { revalidateNotion } from '@/lib/cacheTags';
import { getDashboard } from '@/lib/load';
import { getRepo } from '@/notion';
import { createCoinGeckoProvider } from '@/prices/coingecko';
import { createFxProvider } from '@/prices/fx';
import { createYahooProvider } from '@/prices/yahoo';
import { runSync } from '@/sync/run';

export const dynamic = 'force-dynamic';
/** Vercel Hobby : jusqu'à 60 s (au lieu de 10 s par défaut) pour les cours et les écritures Notion. */
export const maxDuration = 60;

/** Synchronisation quotidienne. L'authentification (session ou Bearer CRON_SECRET) est faite par le middleware. */
async function handle(): Promise<Response> {
  const t0 = Date.now();
  let report: Awaited<ReturnType<typeof runSync>>;
  try {
    report = await runSync({
      repo: getRepo(),
      yahoo: createYahooProvider(),
      crypto: createCoinGeckoProvider(),
      fx: createFxProvider(),
      now: new Date(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    // Invalidation même si la synchro échoue tard (des actifs ont pu être écrits). Elle n'écrit que les valorisations
    // (actifs), les cours spot (mouvements) et la photo du jour (historique).
    revalidateNotion('assets', 'movements', 'history');
  }
  const syncMs = Date.now() - t0;
  console.log(`[perf] sync ${syncMs}ms`);
  // Préchauffage une fois la réponse envoyée : la première visite de la journée trouve des caches pleins,
  // sans que la réponse (et la durée max de 60 s) en dépende. Une erreur ici ne doit rien casser.
  after(async () => {
    const t1 = Date.now();
    try {
      await getDashboard();
      console.log(`[perf] préchauffage ${Date.now() - t1}ms`);
    } catch (e) {
      console.error('Préchauffage du tableau de bord impossible', e);
    }
  });
  return NextResponse.json(report, { headers: { 'Server-Timing': `sync;dur=${syncMs}` } });
}

export const GET = handle;
export const POST = handle;
