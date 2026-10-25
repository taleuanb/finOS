import { NextResponse } from 'next/server';
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
  try {
    const t0 = Date.now();
    const report = await runSync({
      repo: getRepo(),
      yahoo: createYahooProvider(),
      crypto: createCoinGeckoProvider(),
      fx: createFxProvider(),
      now: new Date(),
    });
    const t1 = Date.now();
    // La synchro n'écrit que les valorisations (actifs), les cours spot (mouvements) et la photo du jour (historique).
    revalidateNotion('assets', 'movements', 'history');
    // Préchauffage : la première visite de la journée trouve des caches pleins. Une erreur ici ne doit rien casser.
    try {
      await getDashboard();
    } catch (e) {
      console.error('Préchauffage du tableau de bord impossible', e);
    }
    const t2 = Date.now();
    console.log(`[perf] sync ${t1 - t0}ms, préchauffage ${t2 - t1}ms`);
    return NextResponse.json(report, { headers: { 'Server-Timing': `sync;dur=${t1 - t0}, warm;dur=${t2 - t1}` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
