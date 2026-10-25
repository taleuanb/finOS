const fmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date du jour à Paris, 'AAAA-MM-JJ'. */
export function parisDate(now: Date): string {
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Mois courant à Paris, 'AAAA-MM'. */
export function parisMonth(now: Date): string {
  return parisDate(now).slice(0, 7);
}

/** Mois de fromMonth à toMonth inclus, en ordre croissant ('AAAA-MM'). Vide si from > to. */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
