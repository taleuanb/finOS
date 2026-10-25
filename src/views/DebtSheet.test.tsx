import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';
import { DebtSheet, type DebtSheetActions } from './DebtSheet';

const debt = fixtureDashboard.debts[0]; // Crédit Dar Sakan, MAD
const field = (name: string | RegExp) => screen.getByLabelText(name);

function setup(opts: { debt?: typeof debt; actions?: Partial<DebtSheetActions>; assets?: typeof fixtureDashboard.assets } = {}) {
  const actions: DebtSheetActions = {
    create: vi.fn().mockResolvedValue({ ok: true, id: 'n' }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    ...opts.actions,
  };
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <DisplayProvider fx={fixtureDashboard.fx}>
      <DebtSheet debt={opts.debt} assets={opts.assets ?? fixtureDashboard.assets} actions={actions} onClose={onClose} onDone={onDone} />
    </DisplayProvider>,
  );
  return { actions, onDone, onClose, user: userEvent.setup() };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DebtSheet — création', () => {
  it('est un dialogue « Nouveau crédit », sans bouton Supprimer', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Nouveau crédit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
  });

  it('propose les trois types, les devises et la liste des actifs', () => {
    setup();
    expect(within(field('Type') as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['—', 'Crédit immobilier', 'Crédit consommation', 'Autre'],
    );
    expect(within(field('Devise') as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual(['EUR', 'MAD', 'USD']);
    const financed = field('Actif financé') as HTMLElement;
    expect(within(financed).getByRole('option', { name: 'Aucun' })).toBeInTheDocument();
    expect(within(financed).getByRole('option', { name: 'Dar Sakan' })).toBeInTheDocument();
    expect(within(financed).getAllByRole('option')).toHaveLength(fixtureDashboard.assets.length + 1);
  });

  it('enregistre un crédit complet avec virgule française et se ferme', async () => {
    const { user, actions, onDone } = setup();
    await user.type(field('Nom'), 'Prêt auto');
    await user.selectOptions(field('Type'), 'Crédit consommation');
    await user.type(field('Capital restant dû (EUR)'), '12 000,50');
    await user.type(field('Taux (%)'), '3,9');
    await user.type(field('Mensualité (EUR)'), '250');
    await user.type(field('Date de fin'), '2029-06-30');
    await user.selectOptions(field('Actif financé'), 'lcl');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith({
      name: 'Prêt auto', type: 'Crédit consommation', currency: 'EUR', outstanding: 12_000.5, rate: 3.9, monthly: 250,
      endDate: '2029-06-30', financedAssetId: 'lcl',
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('le minimum : nom et capital', async () => {
    const { user, actions } = setup();
    await user.type(field('Nom'), 'Dette perso');
    await user.type(field(/^Capital restant dû/), '500');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith({ name: 'Dette perso', currency: 'EUR', outstanding: 500 });
  });

  it('valide côté client avec des erreurs liées aux champs', async () => {
    const { user, actions } = setup();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Nom')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(field('Nom').getAttribute('aria-describedby')!)).toHaveTextContent('Nom requis');
    expect(field(/^Capital restant dû/)).toHaveAttribute('aria-invalid', 'true');
    await user.type(field('Nom'), 'X');
    await user.type(field(/^Capital restant dû/), '10');
    await user.type(field('Taux (%)'), '150');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Taux (%)')).toHaveAttribute('aria-invalid', 'true');
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('garde la saisie et affiche l’erreur quand l’action échoue', async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'Enregistrement impossible, réessaie dans un instant.' });
    const { user, onDone } = setup({ actions: { create } });
    await user.type(field('Nom'), 'Prêt');
    await user.type(field(/^Capital restant dû/), '700');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('réessaie');
    expect(field('Nom')).toHaveValue('Prêt');
    expect(field(/^Capital restant dû/)).toHaveValue('700');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('mode masqué : capital, taux et mensualité en type="password"', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    await vi.waitFor(() => expect(field(/^Capital restant dû/)).toHaveAttribute('type', 'password'));
    expect(field(/^Mensualité/)).toHaveAttribute('type', 'password');
    expect(field('Nom')).toHaveAttribute('type', 'text');
  });
});

describe('DebtSheet — édition', () => {
  it('pré-remplit le crédit, dans sa devise', () => {
    setup({ debt });
    expect(screen.getByRole('dialog', { name: 'Modifier le crédit' })).toBeInTheDocument();
    expect(field('Nom')).toHaveValue('Crédit Dar Sakan');
    expect(field('Type')).toHaveValue('Crédit immobilier');
    expect(field('Devise')).toHaveValue('MAD');
    expect(field('Capital restant dû (MAD)')).toHaveValue('600000');
    expect(field('Actif financé')).toHaveValue('dar-sakan');
  });

  it('n’envoie que les champs modifiés', async () => {
    const { user, actions, onDone } = setup({ debt });
    await user.clear(field(/^Capital restant dû/));
    await user.type(field(/^Capital restant dû/), '590000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).toHaveBeenCalledWith('credit-dar-sakan', { outstanding: 590_000 });
    expect(onDone).toHaveBeenCalled();
  });

  it('retirer l’actif financé envoie null', async () => {
    const { user, actions } = setup({ debt });
    await user.selectOptions(field('Actif financé'), '');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).toHaveBeenCalledWith('credit-dar-sakan', { financedAssetId: null });
  });

  it('conserve le lien vers un actif financé archivé (absent de la liste)', async () => {
    const without = fixtureDashboard.assets.filter((a) => a.id !== 'dar-sakan');
    const { user, actions } = setup({ debt, assets: without });
    expect(field('Actif financé')).toHaveValue('dar-sakan');
    await user.clear(field('Nom'));
    await user.type(field('Nom'), 'Crédit renommé');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).toHaveBeenCalledWith('credit-dar-sakan', { name: 'Crédit renommé' });
  });

  it('Supprimer demande confirmation puis supprime', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, actions, onDone } = setup({ debt });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Crédit Dar Sakan'));
    expect(actions.remove).toHaveBeenCalledWith('credit-dar-sakan');
    expect(onDone).toHaveBeenCalled();
  });

  it('Supprimer refusé à la confirmation : rien n’est appelé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, actions, onDone } = setup({ debt });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(actions.remove).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('une suppression en échec reste affichée dans la feuille', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const remove = vi.fn().mockResolvedValue({ ok: false, error: 'Suppression impossible, réessaie dans un instant.' });
    const { user, onDone } = setup({ debt, actions: { remove } });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Suppression impossible');
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DebtSheet — correctifs', () => {
  it('la devise est figée en modification : valeur en lecture seule', () => {
    setup({ debt });
    const currency = field('Devise');
    expect(currency.tagName).toBe('INPUT');
    expect(currency).toHaveAttribute('readonly');
    expect(currency).toHaveValue('MAD');
  });

  it('à la création la devise reste modifiable', () => {
    setup();
    expect(field('Devise').tagName).toBe('SELECT');
  });
});
