import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';
import { MovementSheet } from './MovementSheet';

const asset = (id: string) => fixtureDashboard.assets.find((a) => a.id === id)!;
const field = (name: string | RegExp) => screen.getByLabelText(name);

function setup(id: string, add = vi.fn().mockResolvedValue({ ok: true })) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <DisplayProvider fx={fixtureDashboard.fx}>
      <MovementSheet asset={asset(id)} actions={{ add }} onClose={onClose} onDone={onDone} />
    </DisplayProvider>,
  );
  return { add, onDone, onClose, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T23:30:00Z')); // Paris : déjà le 6 novembre
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MovementSheet', () => {
  it('est un dialogue au nom de l’actif, avec la date du jour à Paris par défaut', () => {
    setup('etf-revolut');
    expect(screen.getByRole('dialog', { name: 'Mouvement · ETF Revolut' })).toBeInTheDocument();
    expect(field('Date')).toHaveValue('2026-11-06');
    expect(screen.getByRole('button', { name: 'Achat', pressed: true })).toBeInTheDocument();
  });

  it('affiche la devise de l’actif sur le montant (MAD)', () => {
    setup('dar-sakan');
    expect(field('Montant (MAD)')).toBeInTheDocument();
    expect(screen.getAllByText('MAD').length).toBeGreaterThan(0);
  });

  it('montant en euros pour un actif en EUR', () => {
    setup('etf-revolut');
    expect(field('Montant (EUR)')).toBeInTheDocument();
  });

  it('libelle la quantité « Poids fin (g) » pour un métal précieux', () => {
    setup('or');
    expect(field('Poids fin (g)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Quantité/)).toBeNull();
  });

  it('libelle la quantité « Quantité (parts / unités) » pour les autres actifs', () => {
    setup('etf-revolut');
    expect(field('Quantité (parts / unités)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Poids fin (g)')).toBeNull();
  });

  it('enregistre un achat avec virgule française et se ferme', async () => {
    const { user, add, onDone } = setup('etf-revolut');
    await user.type(field('Quantité (parts / unités)'), '2,5');
    await user.type(field('Montant (EUR)'), '250,75');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).toHaveBeenCalledWith({ assetId: 'etf-revolut', kind: 'buy', date: '2026-11-06', quantity: 2.5, amount: 250.75 });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('enregistre une vente avec date et libellé choisis', async () => {
    const { user, add } = setup('etf-revolut');
    await user.click(screen.getByRole('button', { name: 'Vente' }));
    await user.clear(field('Date'));
    await user.type(field('Date'), '2026-10-30');
    await user.type(field('Montant (EUR)'), '100');
    await user.type(field('Libellé (facultatif)'), ' Prise de bénéfice ');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).toHaveBeenCalledWith({
      assetId: 'etf-revolut', kind: 'sell', date: '2026-10-30', quantity: 0, amount: 100, label: 'Prise de bénéfice',
    });
  });

  it('un métal sans poids fin est refusé avant tout appel', async () => {
    const { user, add } = setup('or');
    await user.type(field('Montant (EUR)'), '500');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Poids fin (g)')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(field('Poids fin (g)').getAttribute('aria-describedby')!)).toHaveTextContent(/Poids fin/);
    expect(add).not.toHaveBeenCalled();
    await user.type(field('Poids fin (g)'), '3,11');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'or', quantity: 3.11, amount: 500 }));
  });

  it('refuse un montant nul ou illisible', async () => {
    const { user, add } = setup('etf-revolut');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Montant (EUR)')).toHaveAttribute('aria-invalid', 'true');
    await user.type(field('Montant (EUR)'), '0');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).not.toHaveBeenCalled();
  });

  it('garde la saisie et affiche l’erreur quand l’action échoue', async () => {
    const add = vi.fn().mockResolvedValue({ ok: false, error: 'Enregistrement impossible, réessaie dans un instant.' });
    const { user, onDone } = setup('etf-revolut', add);
    await user.type(field('Montant (EUR)'), '80');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('réessaie');
    expect(field('Montant (EUR)')).toHaveValue('80');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('mode masqué : montant et quantité en type="password"', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup('or');
    await vi.waitFor(() => expect(field('Montant (EUR)')).toHaveAttribute('type', 'password'));
    expect(field('Poids fin (g)')).toHaveAttribute('type', 'password');
  });
});

describe('MovementSheet — quantités décimales', () => {
  it('envoie 0,00012 (crypto) sans arrondi', async () => {
    const { user, add } = setup('crypto');
    await user.type(field('Quantité (parts / unités)'), '0,00012');
    await user.type(field('Montant (EUR)'), '5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'crypto', quantity: 0.00012, amount: 5 }));
  });

  it('envoie un poids fin à trois décimales (3,125 g)', async () => {
    const { user, add } = setup('or');
    await user.type(field('Poids fin (g)'), '3,125');
    await user.type(field('Montant (EUR)'), '400');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'or', quantity: 3.125 }));
  });

  it('la quantité utilise le clavier décimal', () => {
    setup('crypto');
    expect(field('Quantité (parts / unités)')).toHaveAttribute('inputmode', 'decimal');
  });
});
