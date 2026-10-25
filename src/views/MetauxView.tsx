'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { parisDate } from '@/domain/dates';
import { formatMoney, formatPct } from '@/domain/money';
import { neutralZone } from '@/domain/zones';
import type { MetalZone } from '@/domain/types';
import type { Dashboard, MetalPosition, MetalPurchaseView } from '@/lib/dashboard';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { HIDDEN_TEXT, useDisplay } from '@/ui/display';
import { Money } from '@/ui/Money';
import { RatioChart } from '@/ui/charts/RatioChart';
import { formatDateFr } from '@/ui/charts/shared';

/** Orange foncé : 6,2:1 sur blanc, 5,4:1 sur la carte pêche. */
const WARNING = 'text-[#9A4A0E]';
const PREMIUM_WARNING_THRESHOLD = 0.15;

const num = (n: number, min: number, max = min) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max })
    .format(n)
    .replace(/[  ]/g, ' ')
    .replace(/-/g, '−');
const ratioText = (r: number) => num(r, 1);

/** Poids fin : une position détenue (poids × cours public = valeur), donc masqué en mode masqué. */
function useGramsText(): (g: number) => string {
  const { hidden } = useDisplay();
  return (g) => (hidden ? HIDDEN_TEXT : `${num(g, 0, 2)} g`);
}

/** Date de fraîcheur des données, au jour de Paris ; retombe sur `asOf` si `lastSyncOk` est absent ou invalide. */
function staleDay(data: Dashboard): string {
  if (data.lastSyncOk) {
    const t = new Date(data.lastSyncOk);
    if (!Number.isNaN(t.getTime())) return parisDate(t);
  }
  return data.asOf;
}
const pricePerKg = (eur: number) => `${formatMoney(eur, 'EUR')} / kg`;

function segmentColor(goldShare: number): string {
  if (goldShare > 0.7) return '#C99A2E';
  if (goldShare > 0.6) return '#E6C77A';
  if (goldShare > 0.5) return '#D7DBE3';
  if (goldShare > 0.35) return '#AFC0D6';
  return '#6F8BAD';
}

/** Largeur de chaque zone sur l'échelle 0–100 ; la dernière zone (ouverte) est plafonnée à 100. */
function segmentWidths(grid: MetalZone[]): number[] {
  return grid.map((z) => Math.max(0, Math.min(z.max, 100) - Math.min(z.min, 100)));
}

function MetalChip({ metal }: { metal: 'gold' | 'silver' }) {
  const gold = metal === 'gold';
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 flex-none items-center justify-center rounded-full text-[13px] font-extrabold ${
        gold ? 'bg-[#FBF1D9] text-[#7A5A0E]' : 'bg-[#EEF0F3] text-[#3E4450]'
      }`}
    >
      {gold ? 'Au' : 'Ag'}
    </span>
  );
}

function GainBadge({ pct, small }: { pct: number; small?: boolean }) {
  return (
    <Badge tone={pct < 0 ? 'loss' : 'gain'} className={small ? '!px-2 !py-0.5 !text-[11px]' : ''}>
      {pct < 0 ? '▼' : '▲'} {formatPct(Math.abs(pct))}
    </Badge>
  );
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-bold">{children}</span>
    </div>
  );
}

function MetalCard({ metal, name, position }: { metal: 'gold' | 'silver'; name: string; position: MetalPosition | null }) {
  const gramsText = useGramsText();
  return (
    <Card aria-label={name} role="region" className="flex flex-col gap-3.5 !p-[18px]">
      <div className="flex items-center gap-3">
        <MetalChip metal={metal} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{name}</span>
          <span className="text-xs text-muted">{position ? `${gramsText(position.grams)} fin` : '—'}</span>
        </div>
        {position ? (
          <div className="flex flex-col items-end gap-1">
            <Money eur={position.valueEur} className="text-[17px] font-extrabold" />
            <GainBadge pct={position.gainPct} small />
          </div>
        ) : null}
      </div>
      {position ? (
        <div className="grid grid-cols-2 gap-3 border-t border-[#F1F2F4] pt-3">
          <Kpi label="Cours actuel">{pricePerKg(position.spotEurPerKg)}</Kpi>
          <Kpi label="Cours d'achat pondéré">{pricePerKg(position.avgCostPerKg)}</Kpi>
          <Kpi label="Investi">
            <Money eur={position.costEur} />
          </Kpi>
          <Kpi label="Prime moyenne">{position.avgPremium === null ? '—' : formatPct(position.avgPremium)}</Kpi>
        </div>
      ) : (
        <p className="border-t border-[#F1F2F4] pt-3 text-sm text-muted">
          {metal === 'gold' ? "Aucun achat d'or" : "Aucun achat d'argent"}
        </p>
      )}
    </Card>
  );
}

function SignalCard({ data }: { data: Dashboard }) {
  const { metals, strategy, plan } = data;
  const { ratio, zone } = metals;
  const grid = strategy.metalGrid;
  const widths = segmentWidths(grid);
  const neutral = neutralZone(grid);
  const pending = plan.lines
    .filter((l) => l.assetId === strategy.goldAssetId || l.assetId === strategy.silverAssetId)
    .reduce((s, l) => s + l.toInvestEur, 0);
  const marker = ratio === null ? 0 : Math.max(0, Math.min(100, ratio));
  const goldPct = zone ? Math.round(zone.goldShare * 100) : null;

  return (
    <section
      aria-label="Signal or argent"
      className="flex flex-col gap-3.5 rounded-[20px] border border-[#F6D3B5] bg-[#FFF6EE] p-[18px]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Signal or / argent</h2>
        {zone ? (
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-bold uppercase">{zone.label}</span>
        ) : null}
      </div>
      <span className="text-[40px] font-extrabold leading-none">{ratio === null ? '—' : ratioText(ratio)}</span>

      {ratio !== null && zone ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={`Ratio ${ratioText(ratio)}, zone ${zone.label}`}
            className="relative"
          >
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
              {grid.map((z, i) => (
                <div key={z.label} data-seg style={{ width: `${widths[i]}%`, background: segmentColor(z.goldShare) }} />
              ))}
            </div>
            <div className="relative h-3">
              <div
                data-marker
                className="absolute top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm bg-foreground"
                style={{ left: `${marker}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-muted" aria-hidden="true">
            <span>Or ← {grid[0].max}</span>
            <span>
              {neutral.min}–{neutral.max}
            </span>
            <span>{grid[grid.length - 1].min} → Argent</span>
          </div>
        </div>
      ) : null}

      {goldPct !== null ? (
        <p className="text-[13px] leading-relaxed text-[#3E4450]">
          Répartition conseillée : <strong className="text-foreground">{goldPct} % or · {100 - goldPct} % argent</strong>.
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-[#3E4450]">Ratio indisponible pour le moment.</p>
      )}

      <div className="flex gap-2.5">
        <div className="flex flex-1 flex-col gap-1 rounded-[14px] border border-[#F0E2D3] bg-card p-3">
          <span className="text-xs text-muted">Or ce mois</span>
          <Money eur={metals.monthSplit.goldEur} className="text-[17px] font-extrabold" />
        </div>
        <div className="flex flex-1 flex-col gap-1 rounded-[14px] border border-[#F0E2D3] bg-card p-3">
          <span className="text-xs text-muted">Argent ce mois</span>
          <Money eur={metals.monthSplit.silverEur} className="text-[17px] font-extrabold" />
        </div>
      </div>

      {pending > 0 ? (
        <Link href="/epargne" className="flex min-h-11 items-center text-[13px] font-semibold text-[#A24E0E]">
          <span>
            <Money eur={pending} /> en attente d&apos;achat sur ton Épargne →
          </span>
        </Link>
      ) : null}
    </section>
  );
}

function PurchaseRow({ p }: { p: MetalPurchaseView }) {
  const gramsText = useGramsText();
  const missing = p.fineGrams === 0;
  const meta = [p.nature, formatDateFr(p.date), missing ? null : gramsText(p.fineGrams)].filter(Boolean).join(' · ');
  const highPremium = p.premium !== null && p.premium > PREMIUM_WARNING_THRESHOLD;
  return (
    <li className="flex items-center gap-3 border-t border-[#F1F2F4] px-4 py-3">
      <MetalChip metal={p.metal} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-bold">{p.label}</span>
        <span className="text-xs text-muted">
          {meta}
          {missing ? (
            <>
              {meta ? ' · ' : ''}
              <span className={`font-semibold ${WARNING}`}>Poids fin manquant</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <Money eur={p.amountEur} className="text-sm font-bold" />
        <span className="text-xs font-semibold text-muted">
          prime{' '}
          {p.premium === null || missing ? (
            '—'
          ) : (
            <span className={highPremium ? WARNING : 'text-muted'}>{formatPct(p.premium)}</span>
          )}
        </span>
      </div>
    </li>
  );
}

export function MetauxView({ data }: { data: Dashboard }) {
  const { metals, strategy } = data;
  const positions = [metals.gold, metals.silver].filter((p): p is MetalPosition => p !== null);
  const valueEur = positions.reduce((s, p) => s + p.valueEur, 0);
  const costEur = positions.reduce((s, p) => s + p.costEur, 0);
  const gainEur = valueEur - costEur;
  const gainPct = costEur > 0 ? gainEur / costEur : null;

  return (
    <div className="flex flex-col gap-4">
      {data.stale ? (
        <p role="status" className="rounded-2xl border border-[#F6D3B5] bg-[#FFF6EE] px-4 py-3 text-[13px] font-semibold text-[#9A4A0E]">
          Données du {formatDateFr(staleDay(data))}
        </p>
      ) : null}

      {metals.alert ? (
        <p role="alert" className="rounded-2xl border border-[#F6D3B5] bg-[#FFF6EE] px-4 py-3 text-[13px] font-semibold text-[#9A4A0E]">
          Réajustement conseillé : ratio hors zone neutre depuis 14 jours
        </p>
      ) : null}

      <section aria-label="Total métaux" className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card px-[18px] py-5">
        <span className="text-sm text-muted">Valeur totale</span>
        <Money eur={valueEur} className="text-4xl font-extrabold leading-none tracking-[-0.03em]" />
        {positions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {gainPct !== null ? <GainBadge pct={gainPct} /> : null}
            <span className="text-[13px] text-muted">
              <Money eur={gainEur} signed /> sur <Money eur={costEur} /> investis
            </span>
          </div>
        ) : null}
      </section>

      <MetalCard metal="gold" name="Or physique" position={metals.gold} />
      <MetalCard metal="silver" name="Argent physique" position={metals.silver} />

      <SignalCard data={data} />

      <section aria-label="Ratio sur cinq ans" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-[18px]">
        <h2 className="text-base font-bold">Ratio or / argent · 5 ans</h2>
        {metals.ratioHistory.length > 1 ? (
          <RatioChart data={metals.ratioHistory} grid={strategy.metalGrid} />
        ) : (
          <p className="text-sm text-muted">Historique du ratio indisponible.</p>
        )}
      </section>

      <section aria-label="Achats" className="overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h2 className="text-base font-bold">Achats</h2>
          <span className="text-xs text-muted">
            {metals.purchases.length} {metals.purchases.length > 1 ? 'lignes' : 'ligne'}
          </span>
        </div>
        {metals.purchases.length > 0 ? (
          <ul>
            {metals.purchases.map((p) => (
              <PurchaseRow key={p.movementId} p={p} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-[#F1F2F4] px-4 py-4 text-sm text-muted">Aucun achat enregistré.</p>
        )}
      </section>
    </div>
  );
}
