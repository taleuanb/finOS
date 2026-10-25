import type { Period } from '@/lib/dashboard';
import { toEur } from './money';
import { ASSET_CLASSES } from './types';
import type { Asset, AssetClass, Debt, FxRates, Snapshot } from './types';

/** Construit l'instantané du jour : ignore les actifs archivés (valueEur déjà calculé). */
export function buildSnapshot(
  date: string,
  assets: Asset[],
  debts: Debt[],
  fx: FxRates,
  ratio: number | null,
  partial: boolean,
): Snapshot {
  const byClass = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>;
  let totalAssetsEur = 0;
  for (const a of assets) {
    if (a.archived) continue;
    const v = a.valueEur ?? 0;
    byClass[a.assetClass] += v;
    totalAssetsEur += v;
  }
  const totalDebtsEur = debts.reduce((sum, d) => sum + (d.valueEur ?? toEur(d.outstanding, d.currency, fx)), 0);
  return {
    date, totalAssetsEur, totalDebtsEur, netEur: totalAssetsEur - totalDebtsEur,
    byClass, goldSilverRatio: ratio, eurMad: fx.MAD, eurUsd: fx.USD, partial,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO yyyy-mm-dd moins `months` mois, jour ramené à la fin du mois si besoin (31 mars − 1 mois → 28 février). */
function minusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay))}`;
}

function referenceDate(period: Period, today: string): string | null {
  switch (period) {
    case '1M': return minusMonths(today, 1);
    case '1A': return minusMonths(today, 12);
    case 'YTD': return `${Number(today.slice(0, 4)) - 1}-12-31`;
    case 'Tout': return null;
  }
}

/**
 * Variation du patrimoine net entre le dernier instantané et la référence de la période
 * (dernier instantané ≤ date de référence, sinon le premier disponible ; « Tout » : le premier).
 * `null` s'il y a moins de 2 instantanés.
 */
export function variation(snaps: Snapshot[], period: Period, today: string): { abs: number; pct: number } | null {
  if (snaps.length < 2) return null;
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const refDate = referenceDate(period, today);
  let ref = first;
  if (refDate !== null) {
    for (const s of sorted) if (s.date <= refDate) ref = s;
  }
  const abs = last.netEur - ref.netEur;
  return { abs, pct: ref.netEur === 0 ? 0 : abs / ref.netEur };
}
