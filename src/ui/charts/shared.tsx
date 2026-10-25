'use client';

import { cloneElement, type ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';
import type { Currency, FxRates } from '@/domain/types';
import { fromEur } from '@/domain/money';

export const COLORS = {
  curve: '#EE8A3C',
  accent: '#F4B183',
  grid: '#EEEFF2',
  axis: '#6B7280',
  text: '#111318',
} as const;

export const AXIS_TICK = { fontSize: 11, fill: COLORS.axis } as const;

const SYMBOL: Record<Currency, string> = { EUR: '€', MAD: 'MAD', USD: '$' };

/** « 170 k€ », « 1,2 M€ » : ticks d'axe courts, dans la devise d'affichage. */
export function formatCompactMoney(eur: number, cur: Currency, fx: FxRates): string {
  const v = fromEur(eur, cur, fx);
  const abs = Math.abs(v);
  const fmt = (n: number) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
      .format(n)
      .replace(/[  ]/g, ' ')
      .replace(/-/g, '−');
  const sym = SYMBOL[cur];
  const sep = cur === 'MAD' ? ' ' : '';
  if (abs >= 1_000_000) return `${fmt(v / 1_000_000)} M${sep}${sym}`;
  if (abs >= 1_000) return `${fmt(v / 1_000)} k${sep}${sym}`;
  return `${fmt(v)}${sep}${sym}`;
}

/** 'AAAA-MM-JJ' → 'JJ/MM/AAAA' */
export function formatDateFr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** 'AAAA-MM-JJ' → 'MM/AAAA' */
export function formatMonthYear(iso: string): string {
  const [y, m] = iso.slice(0, 10).split('-');
  return m && y ? `${m}/${y}` : iso;
}

/** Libellé d'accessibilité : jamais de montant ; mention explicite en mode masqué. */
export function chartLabel(base: string, hidden: boolean): string {
  return hidden ? `${base} (montants masqués)` : base;
}

export interface ChartSizeProps {
  /** Dimensions fixes (tests, jsdom) ; sans `width`, le graphique occupe la largeur de son parent. */
  width?: number;
  height?: number;
}

/**
 * Cadre commun : `role="img"` + libellé, et taille responsive (ou fixe si `width` est fourni).
 * L'enfant doit être un composant de graphique Recharts de premier niveau.
 */
export function ChartFrame({
  label,
  width,
  height = 180,
  className,
  children,
}: ChartSizeProps & { label: string; className?: string; children: ReactElement<{ width?: number; height?: number }> }) {
  const fixed = width !== undefined;
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{ width: fixed ? width : '100%', height }}
    >
      {fixed ? (
        cloneElement(children, { width, height })
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
