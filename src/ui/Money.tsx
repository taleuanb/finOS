'use client';

import { formatMoney, fromEur } from '@/domain/money';
import type { Currency, FxRates } from '@/domain/types';
import { HIDDEN_TEXT, useDisplay } from './display';

/** Montant EUR → texte dans la devise d'affichage ; `HIDDEN_TEXT` en mode masqué. */
export function formatDisplayMoney(
  eur: number,
  d: { currency: Currency; hidden: boolean; fx: FxRates },
  opts?: { signed?: boolean; decimals?: number },
): string {
  if (d.hidden) return HIDDEN_TEXT;
  const v = fromEur(eur, d.currency, d.fx);
  const decimals = opts?.decimals ?? 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(v) * factor) / factor;
  if (!opts?.signed) return formatMoney(v, d.currency, { decimals });
  const body = formatMoney(rounded, d.currency, { decimals });
  if (rounded === 0) return body;
  return `${v < 0 ? '−' : '+'} ${body}`;
}

export function Money({
  eur,
  signed,
  decimals,
  className,
}: {
  eur: number;
  signed?: boolean;
  decimals?: number;
  className?: string;
}) {
  const d = useDisplay();
  return <span className={className}>{formatDisplayMoney(eur, d, { signed, decimals })}</span>;
}
