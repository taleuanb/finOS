import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getRepo } from '@/notion';
import { createCoinGeckoProvider } from '@/prices/coingecko';
import { createFxProvider } from '@/prices/fx';
import { createYahooProvider } from '@/prices/yahoo';
import { runSync } from '@/sync/run';

export const dynamic = 'force-dynamic';

/** Synchronisation quotidienne. L'authentification (session ou Bearer CRON_SECRET) est faite par le middleware. */
async function handle(): Promise<Response> {
  try {
    const report = await runSync({
      repo: getRepo(),
      yahoo: createYahooProvider(),
      crypto: createCoinGeckoProvider(),
      fx: createFxProvider(),
      now: new Date(),
    });
    revalidateTag('notion');
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
