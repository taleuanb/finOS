import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';

/** Coque d'écran : en-tête, contenu centré (max 480 px), menu du bas fixe et marge basse de 96 px. */
export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-4 pb-24 pt-5">
        <header className="flex min-h-11 items-center justify-between gap-3">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{title}</h1>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
        <main className="flex flex-col gap-4">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
