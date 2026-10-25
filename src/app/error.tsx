'use client';

import { useEffect } from 'react';

/** Erreur d'un écran (Notion injoignable, configuration manquante…) : message clair et nouvel essai. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-4 px-4 py-8">
      <div role="alert" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-5">
        <h1 className="text-[20px] font-bold text-foreground">Impossible d&apos;afficher les données</h1>
        <p className="text-sm leading-relaxed text-muted">
          Notion ne répond pas ou la configuration est incomplète. Réessaie dans un instant ; si le problème
          persiste, vérifie les variables d&apos;environnement Notion.
        </p>
        {error.digest ? <p className="text-xs text-muted">Référence : {error.digest}</p> : null}
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-11 rounded-full bg-foreground px-4 text-[14px] font-semibold text-white"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
