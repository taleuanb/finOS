'use client';

import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        body: new FormData(event.currentTarget),
        redirect: 'manual',
      });
      // Succès : l'API répond 303 vers « / » (réponse opaque avec redirect: 'manual').
      if (response.type === 'opaqueredirect' || response.ok) {
        window.location.assign('/');
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? 'Mot de passe incorrect');
    } catch {
      setError('Connexion impossible. Réessaie.');
    }
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-4 py-8">
      <h1 className="mb-6 text-center text-2xl font-semibold text-foreground">Wealth OS</h1>
      <form
        action="/api/login"
        method="post"
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
      >
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
          className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground outline-none focus:border-curve focus:ring-2 focus:ring-accent"
        />
        {error ? (
          <p id="login-error" role="alert" className="text-sm text-loss">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-foreground disabled:opacity-60"
        >
          Se connecter
        </button>
      </form>
    </main>
  );
}
