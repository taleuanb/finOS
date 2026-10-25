import { parisDate } from '@/domain/dates';
import type { Dashboard } from '@/lib/dashboard';

/** Jour (Paris) de la dernière synchro réussie ; `asOf` si elle est absente ou illisible. */
export function staleDay(d: Pick<Dashboard, 'lastSyncOk' | 'asOf'>): string {
  if (d.lastSyncOk) {
    const t = new Date(d.lastSyncOk);
    if (!Number.isNaN(t.getTime())) return parisDate(t);
  }
  return d.asOf;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** Bandeau « Données du 25 octobre 2026 », commun aux 5 écrans, affiché quand les données sont périmées. */
export function StaleBanner({ data }: { data: Pick<Dashboard, 'stale' | 'lastSyncOk' | 'asOf'> }) {
  if (!data.stale) return null;
  return (
    <p
      role="status"
      className="rounded-2xl border border-[#F6D3B5] bg-[#FFF6EE] px-4 py-3 text-[13px] font-semibold text-[#9A4A0E]"
    >
      {`Données du ${longDate(staleDay(data))}`}
    </p>
  );
}
