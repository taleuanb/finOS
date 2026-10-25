import type { Currency, FxRates, QuoteCurrency } from './types';

/** Montant dans une devise de cotation → euros (les taux sont exprimés en unités par €). */
export function toEur(amount: number, cur: QuoteCurrency, fx: FxRates): number {
  return cur === 'EUR' ? amount : amount / fx[cur];
}

export function fromEur(amountEur: number, cur: Currency, fx: FxRates): number {
  return cur === 'EUR' ? amountEur : amountEur * fx[cur];
}

export function convert(amount: number, from: QuoteCurrency, to: Currency, fx: FxRates): number {
  if (from === to) return amount;
  return fromEur(toEur(amount, from, fx), to, fx);
}

const SUFFIX: Record<Currency, string> = { EUR: '€', MAD: 'MAD', USD: '$' };

/** Espaces insécables (fines ou non) → espace ordinaire ; hyphen-minus → moins typographique. */
function normalize(s: string): string {
  return s.replace(/[  ]/g, ' ').replace(/-/g, '−');
}

export function formatMoney(amount: number, cur: Currency, opts?: { decimals?: number }): string {
  const d = opts?.decimals ?? 0;
  const body = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(amount);
  return `${normalize(body)} ${SUFFIX[cur]}`;
}

/** fraction 0.0327 → « 3,27 % » ; signed ajoute « + » aux positifs. */
export function formatPct(fraction: number, opts?: { signed?: boolean }): string {
  const body = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fraction * 100);
  const s = normalize(body);
  return `${opts?.signed && fraction > 0 && !s.startsWith('−') ? '+' : ''}${s} %`;
}
