import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncButton } from './SyncButton';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SyncButton', () => {
  it('lance POST /api/sync, se désactive pendant la synchro, annonce le résultat puis rafraîchit', async () => {
    const d = deferred<Response>();
    const fetchMock = vi.fn(() => d.promise);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SyncButton />);
    const button = screen.getByRole('button', { name: 'Synchroniser maintenant' });
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledWith('/api/sync', { method: 'POST' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Synchronisation…');

    d.resolve(json({ date: '2026-10-27', updated: 18, errors: [{ assetId: 'hsbc', message: 'x' }], partial: true }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('18 actifs mis à jour · 1 erreur'));
    expect(button).toBeEnabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sans erreur : « N actifs mis à jour » ; singulier pour 1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ updated: 1, errors: [], partial: false })));
    const user = userEvent.setup();
    render(<SyncButton />);
    await user.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 actif mis à jour$/));
  });

  it('échec du serveur : message d’erreur, pas de rafraîchissement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Notion indisponible' }, 500)));
    const user = userEvent.setup();
    render(<SyncButton />);
    await user.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Échec de la synchronisation : Notion indisponible'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('réseau indisponible : message clair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();
    render(<SyncButton />);
    await user.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Synchronisation impossible. Réessaie.'));
  });
});
