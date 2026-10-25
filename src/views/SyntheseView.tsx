'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatPct } from '@/domain/money';
import type { AssetClass, Currency } from '@/domain/types';
import type { Dashboard, Period } from '@/lib/dashboard';
import { StaleBanner } from '@/ui/StaleBanner';
import { Badge } from '@/ui/Badge';
import { useDisplay } from '@/ui/display';
import { Money } from '@/ui/Money';
import { Segmented } from '@/ui/Segmented';
import { AreaChart } from '@/ui/charts/AreaChart';
import { SplitBar } from '@/ui/charts/SplitBar';

const PERIODS: { value: Period; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1A', label: '1A' },
  { value: 'Tout', label: 'Tout' },
];

const PERIOD_CAPTION: Record<Period, string> = {
  '1M': 'sur 1 mois',
  YTD: 'depuis le 1er janvier',
  '1A': 'sur 1 an',
  Tout: 'depuis le début',
};

const CLASS_COLORS: Record<AssetClass, string> = {
  Immobilier: '#6C7CF5',
  'Fonds & ETF': '#3B9EF0',
  Autres: '#9AA3B2',
  PER: '#22B3A0',
  Épargne: '#E0B43A',
  Crypto: '#F2994A',
  'Comptes courants': '#B7BDC7',
  Startups: '#B57BEE',
  'Métaux précieux': '#C99A2E',
  'Noms de domaine': '#EC6FA8',
};

const PLAN_COLORS = { invested: '#137A3A', pending: '#EE8A3C', free: '#E2C7AE' } as const;

const CURRENCIES: Currency[] = ['EUR', 'MAD'];

/** Premier jour de période (inclus) pour filtrer l'historique ; null = tout l'historique. */
export function periodStart(period: Period, asOf: string): string | null {
  const [y, m, day] = asOf.split('-').map(Number);
  if (period === 'Tout') return null;
  if (period === 'YTD') return `${y}-01-01`;
  const back = period === '1M' ? 1 : 12;
  const index = y * 12 + (m - 1) - back;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const dim = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

const SYNC_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** « 25/10 07:00 » à l'heure de Paris ; « jamais » sans synchro réussie (ou date illisible). */
export function lastSyncText(iso: string | null): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return 'jamais';
  const p = Object.fromEntries(SYNC_FMT.formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** « novembre » ou « d'avril » : le « de » s'élide devant une voyelle. */
function ofMonth(month: string): string {
  const name = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return /^[aeiouhéèêàâîôûy]/i.test(name) ? `d'${name}` : `de ${name}`;
}

function pct1(fraction: number): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    .format(fraction * 100)
    .replace(/[  ]/g, ' ')} %`;
}

function initials(name: string): string {
  const words = name.split(/[\s/]+/).filter((w) => /^\p{L}/u.test(w));
  const letters = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? name).slice(0, 2));
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/** Bouton œil : masque / affiche tous les montants (à placer dans les actions de l'en-tête). */
export function EyeButton() {
  const { hidden, toggleHidden } = useDisplay();
  return (
    <button
      type="button"
      aria-label={hidden ? 'Afficher les montants' : 'Masquer les montants'}
      aria-pressed={hidden}
      onClick={toggleHidden}
      className={`flex size-11 items-center justify-center rounded-full border border-border ${
        hidden ? 'bg-foreground text-card' : 'bg-card text-foreground'
      }`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {hidden ? <path d="M3 3l18 18" /> : null}
      </svg>
    </button>
  );
}

function CurrencyToggle() {
  const { currency, setCurrency } = useDisplay();
  return (
    <div role="group" aria-label="Devise d'affichage" className="flex rounded-full bg-[#f0f1f3] p-[3px]">
      {CURRENCIES.map((c) => {
        const on = currency === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => setCurrency(c)}
            className={`min-h-11 min-w-12 rounded-full px-3 text-xs font-bold ${
              on ? 'bg-foreground text-card' : 'text-muted'
            }`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

function VariationBadge({ variation }: { variation: { abs: number; pct: number } | null }) {
  if (!variation) return <Badge tone="neutral">—</Badge>;
  const up = variation.pct >= 0;
  return (
    <Badge tone={up ? 'gain' : 'loss'}>
      {up ? '▲' : '▼'}&nbsp;{formatPct(Math.abs(variation.pct))}
    </Badge>
  );
}

export function SyntheseView({ data: d }: { data: Dashboard }) {
  const [period, setPeriod] = useState<Period>('Tout');

  const chartData = useMemo(() => {
    const start = periodStart(period, d.asOf);
    return d.history
      .filter((h) => (start === null || h.date >= start) && h.date <= d.asOf)
      .map((h) => ({ date: h.date, value: h.netEur }));
  }, [d.history, d.asOf, period]);

  const variation = d.variations[period];
  const plan = d.plan;
  const planMonth = ofMonth(plan.month);

  return (
    <>
      {d.demo ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-3 text-[13px] font-semibold text-muted">
          Données de démonstration : Notion n&apos;est pas connecté (WOS_DEMO=1).
        </p>
      ) : null}
      <StaleBanner data={d} />

      <section
        aria-label="Patrimoine net"
        className="flex flex-col gap-3 rounded-[20px] border border-border bg-card px-[18px] pb-4 pt-5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-muted">Patrimoine net · {shortDate(d.asOf)}</span>
          <CurrencyToggle />
        </div>
        <span className="text-xs text-muted">{`Dernière synchro : ${lastSyncText(d.lastSyncOk)}`}</span>
        <Money eur={d.totals.netEur} className="text-4xl font-extrabold leading-[1.05] tracking-[-0.03em]" />
        <div className="flex flex-wrap items-center gap-2">
          <VariationBadge variation={variation} />
          <span className="text-[13px] text-muted">
            {variation ? (
              <>
                <Money eur={variation.abs} signed /> {PERIOD_CAPTION[period]}
              </>
            ) : (
              `Variation indisponible ${PERIOD_CAPTION[period]}`
            )}
          </span>
        </div>
        <AreaChart data={chartData} height={150} />
        <Segmented options={PERIODS} value={period} onChange={setPeriod} ariaLabel="Période" />
        <div className="grid grid-cols-2 gap-2.5 border-t border-[#EEEFF2] pt-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Actifs bruts</span>
            <Money eur={d.totals.grossEur} className="text-base font-bold" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Passifs</span>
            <span className="text-base font-bold">
              {d.totals.debtsEur > 0 ? '− ' : ''}
              <Money eur={d.totals.debtsEur} />
            </span>
          </div>
        </div>
      </section>

      <Link
        href="/epargne"
        aria-label={`Ouvrir le plan d'épargne ${planMonth}`}
        className="flex flex-col gap-3 rounded-[20px] border border-[#F6D3B5] bg-[#FFF6EE] p-[18px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">Plan {planMonth}</span>
          <span className="text-[13px] font-semibold text-[#9A4A0E]">Voir →</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">Épargne du mois</span>
          <Money eur={d.budget.savingsEur} className="text-[22px] font-extrabold" />
        </div>
        <SplitBar
          label="Plan du mois"
          parts={[
            { value: plan.investedEur, color: PLAN_COLORS.invested, label: 'Investi' },
            { value: plan.pendingEur, color: PLAN_COLORS.pending, label: 'En attente' },
            { value: plan.freeEur, color: PLAN_COLORS.free, label: 'Épargne libre' },
          ]}
        />
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-[#3E4450]">
          {[
            { color: PLAN_COLORS.invested, name: 'Investi', eur: plan.investedEur },
            { color: PLAN_COLORS.pending, name: 'En attente', eur: plan.pendingEur },
            { color: PLAN_COLORS.free, name: 'Épargne libre', eur: plan.freeEur },
          ].map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name} <Money eur={p.eur} />
            </span>
          ))}
        </div>
      </Link>

      <section
        aria-label="Répartition"
        className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card px-[18px] py-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">Répartition</h2>
          <span className="text-xs text-muted">par type d&apos;actif</span>
        </div>
        <SplitBar
          label="Répartition par type d'actif"
          parts={d.byClass.map((c) => ({ value: c.valueEur, color: CLASS_COLORS[c.assetClass], label: c.assetClass }))}
        />
        <ul className="flex flex-col">
          {d.byClass.map((c) => (
            <li key={c.assetClass} className="flex min-h-[30px] items-center gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className="size-2.5 flex-none rounded-full"
                style={{ background: CLASS_COLORS[c.assetClass] }}
              />
              <span className="flex-1 text-[#2A2F3A]">{c.assetClass}</span>
              <span className="w-[54px] text-right text-[13px] text-muted">{pct1(c.pct)}</span>
              <Money eur={c.valueEur} className="w-[100px] text-right font-semibold" />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Ma performance" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">Ma performance</h2>
          <span className="text-[13px] text-muted">Meilleures +/- values</span>
        </div>
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {d.topPerformers.map((a, i) => (
            <li
              key={a.id}
              className="flex w-[200px] flex-none flex-col gap-3 rounded-[18px] border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-[34px] flex-none items-center justify-center rounded-full text-[11px] font-extrabold text-foreground"
                  style={{ background: `${CLASS_COLORS[a.assetClass]}33` }}
                >
                  {initials(a.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{a.name}</span>
                <span className="text-xs text-muted">#{i + 1}</span>
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <Money eur={a.valueEur} className="text-[15px] font-bold" />
                {a.gainPct !== null ? (
                  <Badge tone={a.gainPct >= 0 ? 'gain' : 'loss'} className="px-2 py-[3px] text-xs">
                    {a.gainPct >= 0 ? '▲' : '▼'}&nbsp;{formatPct(Math.abs(a.gainPct))}
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
