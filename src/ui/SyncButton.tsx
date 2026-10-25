'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Bouton « Synchroniser maintenant » (en-tête de la Synthèse) : lance /api/sync puis rafraîchit l'écran. */
export function SyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  async function sync() {
    setRunning(true);
    setMessage('Synchronisation…');
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as
        | { updated?: number; errors?: unknown[]; error?: string }
        | null;
      if (!res.ok || !body || typeof body.updated !== 'number') {
        setMessage(`Échec de la synchronisation${body?.error ? ` : ${body.error}` : ''}`);
        return;
      }
      const errors = Array.isArray(body.errors) ? body.errors.length : 0;
      setMessage(
        plural(body.updated, 'actif mis à jour', 'actifs mis à jour')
          + (errors > 0 ? ` · ${plural(errors, 'erreur', 'erreurs')}` : ''),
      );
      router.refresh();
    } catch {
      setMessage('Synchronisation impossible. Réessaie.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Synchroniser maintenant"
        disabled={running}
        onClick={sync}
        className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-50"
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={running ? 'animate-spin' : undefined}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
      <p
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute right-0 top-full z-10 mt-1 whitespace-nowrap text-right text-[11px] font-semibold text-muted"
      >
        {message}
      </p>
    </div>
  );
}
