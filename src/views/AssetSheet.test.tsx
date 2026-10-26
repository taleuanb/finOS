import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parisDate } from '@/domain/dates';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';
import { AssetSheet, type AssetSheetActions } from './AssetSheet';

const asset = (id: string) => fixtureDashboard.assets.find((a) => a.id === id)!;

function setup(opts: { asset?: ReturnType<typeof asset>; actions?: Partial<AssetSheetActions>; onAddMovement?: () => void } = {}) {
  const actions: AssetSheetActions = {
    create: vi.fn().mockResolvedValue({ ok: true, id: 'new' }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    archive: vi.fn().mockResolvedValue({ ok: true }),
    ...opts.actions,
  };
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <DisplayProvider fx={fixtureDashboard.fx}>
      <AssetSheet asset={opts.asset} actions={actions} onClose={onClose} onDone={onDone} onAddMovement={opts.onAddMovement} />
    </DisplayProvider>,
  );
  return { actions, onClose, onDone, user: userEvent.setup() };
}

const field = (name: string | RegExp) => screen.getByLabelText(name);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AssetSheet — création', () => {
  it('est une boîte de dialogue « Nouvel actif » sans boutons d’édition', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Nouvel actif' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archiver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter un mouvement' })).toBeNull();
  });

  it('affiche les champs selon le mode : Manuelle (valeur + date) ou Auto (identifiant de cotation)', async () => {
    const { user } = setup();
    expect(screen.getByRole('button', { name: 'Manuelle', pressed: true })).toBeInTheDocument();
    expect(field(/^Valeur manuelle/)).toBeInTheDocument();
    expect(field('Date de la valeur')).toBeInTheDocument();
    expect(screen.queryByLabelText('Identifiant de cotation')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Auto' }));
    expect(field('Identifiant de cotation')).toBeInTheDocument();
    expect(screen.getByText(/IWDA\.AS/)).toBeInTheDocument();
    expect(screen.getByText(/XAU/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Valeur manuelle/)).toBeNull();
    expect(screen.queryByLabelText('Date de la valeur')).toBeNull();
  });

  it('chaque champ a un libellé et les listes proposent les choix connus', () => {
    setup();
    const cls = field('Classe') as HTMLSelectElement;
    expect(within(cls).getAllByRole('option')).toHaveLength(10);
    expect(within(field('Devise') as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual(['EUR', 'MAD', 'USD']);
    expect(within(field('Établissement') as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['—', 'Revolut', 'LCL', 'Suravenir', 'Finary', 'Banque Maroc', 'Physique', 'Autre…'],
    );
    for (const l of ['Nom', 'Sous-type', 'Versement fixe mensuel (EUR)']) expect(field(l)).toBeInTheDocument();
  });

  it('crée un actif manuel avec la virgule française, dans la devise saisie, et se ferme', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const actions = { create: vi.fn().mockResolvedValue({ ok: true, id: 'n' }), update: vi.fn(), archive: vi.fn() };
    const onDone = vi.fn();
    render(
      <DisplayProvider fx={fixtureDashboard.fx}>
        <AssetSheet actions={actions} onClose={vi.fn()} onDone={onDone} />
      </DisplayProvider>,
    );
    await user.type(field('Nom'), '  Riad Fès ');
    await user.selectOptions(field('Classe'), 'Immobilier');
    await user.selectOptions(field('Devise'), 'MAD');
    await user.type(field('Valeur manuelle (MAD)'), '1 250 000,5');
    await user.type(field(/^Versement fixe mensuel/), '200');
    await user.selectOptions(field('Établissement'), 'Banque Maroc');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith({
      name: 'Riad Fès', assetClass: 'Immobilier', currency: 'MAD', mode: 'manual', institution: 'Banque Maroc',
      manualValue: 1_250_000.5, manualValueDate: '2026-11-05', fixedMonthly: 200,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('crée un actif Auto avec son identifiant (sans valeur manuelle)', async () => {
    const { user, actions, onDone } = setup();
    await user.type(field('Nom'), 'Apple');
    await user.selectOptions(field('Classe'), 'Fonds & ETF');
    await user.selectOptions(field('Devise'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Auto' }));
    await user.type(field('Identifiant de cotation'), 'AAPL');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith({ name: 'Apple', assetClass: 'Fonds & ETF', currency: 'USD', mode: 'auto', quoteId: 'AAPL' });
    expect(onDone).toHaveBeenCalled();
  });

  it('« Autre… » permet un établissement libre', async () => {
    const { user, actions } = setup();
    await user.type(field('Nom'), 'Compte HSBC');
    await user.type(field(/^Valeur manuelle/), '10');
    await user.selectOptions(field('Établissement'), 'Autre…');
    await user.type(field('Autre établissement'), 'HSBC');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ institution: 'HSBC' }));
  });

  it('valide la saisie côté client : erreurs liées aux champs (aria-describedby), aucune action appelée', async () => {
    const { user, actions } = setup();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const name = field('Nom');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    const errId = name.getAttribute('aria-describedby')!;
    expect(document.getElementById(errId)).toHaveTextContent('Nom requis');
    expect(field(/^Valeur manuelle/)).toHaveAttribute('aria-invalid', 'true');
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('refuse un métal en Auto dont l’identifiant n’est ni XAU ni XAG', async () => {
    const { user, actions } = setup();
    await user.type(field('Nom'), 'Or');
    await user.selectOptions(field('Classe'), 'Métaux précieux');
    await user.click(screen.getByRole('button', { name: 'Auto' }));
    await user.type(field('Identifiant de cotation'), 'bitcoin');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Identifiant de cotation')).toHaveAttribute('aria-invalid', 'true');
    expect(actions.create).not.toHaveBeenCalled();
    await user.clear(field('Identifiant de cotation'));
    await user.type(field('Identifiant de cotation'), 'XAG');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ quoteId: 'XAG' }));
  });

  it('refuse une valeur illisible', async () => {
    const { user, actions } = setup();
    await user.type(field('Nom'), 'X');
    await user.type(field(/^Valeur manuelle/), 'douze');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field(/^Valeur manuelle/)).toHaveAttribute('aria-invalid', 'true');
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('garde la saisie, affiche l’erreur et ne se ferme pas quand l’action échoue', async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'Enregistrement impossible, réessaie dans un instant.' });
    const { user, onDone, onClose } = setup({ actions: { create } });
    await user.type(field('Nom'), 'Mon actif');
    await user.type(field(/^Valeur manuelle/), '123');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enregistrement impossible, réessaie dans un instant.');
    expect(field('Nom')).toHaveValue('Mon actif');
    expect(field(/^Valeur manuelle/)).toHaveValue('123');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('garde aussi la saisie quand l’appel de l’action lève une exception', async () => {
    const create = vi.fn().mockRejectedValue(new Error('réseau'));
    const { user, onDone } = setup({ actions: { create } });
    await user.type(field('Nom'), 'Mon actif');
    await user.type(field(/^Valeur manuelle/), '5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/réessaie/);
    expect(field('Nom')).toHaveValue('Mon actif');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('désactive Enregistrer pendant l’envoi et ignore un second clic', async () => {
    let resolve!: (v: { ok: true }) => void;
    const create = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const { user, onDone } = setup({ actions: { create } });
    await user.type(field('Nom'), 'Mon actif');
    await user.type(field(/^Valeur manuelle/), '5');
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    await user.click(save);
    expect(screen.getByRole('button', { name: /Enregistrement/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Enregistrement/ }));
    expect(create).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('mode masqué : valeur manuelle et versement fixe en type="password"', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    await vi.waitFor(() => expect(field(/^Valeur manuelle/)).toHaveAttribute('type', 'password'));
    expect(field(/^Versement fixe mensuel/)).toHaveAttribute('type', 'password');
    expect(field('Nom')).toHaveAttribute('type', 'text');
  });

  it('mode visible : champs montant en texte', () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: false }));
    setup();
    return vi.waitFor(() => expect(field(/^Valeur manuelle/)).toHaveAttribute('type', 'text'));
  });

  it('le suffixe de devise suit la devise choisie', async () => {
    const { user } = setup();
    expect(field(/^Valeur manuelle/)).toHaveAccessibleName('Valeur manuelle (EUR)');
    await user.selectOptions(field('Devise'), 'MAD');
    expect(field(/^Valeur manuelle/)).toHaveAccessibleName('Valeur manuelle (MAD)');
  });
});

describe('AssetSheet — édition', () => {
  it('pré-remplit les champs de l’actif', () => {
    setup({ asset: asset('dar-sakan') });
    expect(screen.getByRole('dialog', { name: 'Modifier l’actif' })).toBeInTheDocument();
    expect(field('Nom')).toHaveValue('Dar Sakan');
    expect(field('Classe')).toHaveValue('Immobilier');
    expect(field('Devise')).toHaveValue('MAD');
    expect(field('Sous-type')).toHaveValue('Résidence secondaire · Maroc');
    expect(field(/^Valeur manuelle/)).toHaveValue('1200000');
  });

  it('un établissement hors liste apparaît sous « Autre… »', () => {
    const data = { ...asset('lcl'), institution: 'HSBC' };
    setup({ asset: data });
    expect(field('Établissement')).toHaveValue('__autre');
    expect(field('Autre établissement')).toHaveValue('HSBC');
  });

  it('n’envoie que les champs modifiés', async () => {
    const { user, actions, onDone } = setup({ asset: asset('lcl') });
    await user.clear(field('Nom'));
    await user.type(field('Nom'), 'LCL principal');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).toHaveBeenCalledWith('lcl', { name: 'LCL principal' });
    expect(onDone).toHaveBeenCalled();
  });

  it('efface un champ optionnel vidé avec null', async () => {
    const { user, actions } = setup({ asset: asset('per') });
    await user.clear(field(/^Versement fixe mensuel/));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).toHaveBeenCalledWith('per', { fixedMonthly: null });
  });

  it('une valeur modifiée sans toucher à la date reçoit la date du jour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const update = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DisplayProvider fx={fixtureDashboard.fx}>
        <AssetSheet asset={asset('lcl')} actions={{ create: vi.fn(), update, archive: vi.fn() }} onClose={vi.fn()} onDone={vi.fn()} />
      </DisplayProvider>,
    );
    await user.clear(field(/^Valeur manuelle/));
    await user.type(field(/^Valeur manuelle/), '4500,5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(update).toHaveBeenCalledWith('lcl', { manualValue: 4500.5, manualValueDate: parisDate(new Date()) });
  });

  it('sans modification, ferme la feuille sans appeler le serveur', async () => {
    const { user, actions, onClose } = setup({ asset: asset('lcl') });
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(actions.update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Archiver demande confirmation puis archive', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, actions, onDone } = setup({ asset: asset('lcl') });
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Compte de dépôts (LCL)'));
    expect(actions.archive).toHaveBeenCalledWith('lcl', true);
    expect(onDone).toHaveBeenCalled();
  });

  it('Archiver refusé à la confirmation : rien n’est appelé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, actions, onDone } = setup({ asset: asset('lcl') });
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(actions.archive).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('une erreur d’archivage reste affichée dans la feuille', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const archive = vi.fn().mockResolvedValue({ ok: false, error: 'Actif introuvable' });
    const { user, onDone } = setup({ asset: asset('lcl'), actions: { archive } });
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Actif introuvable');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('« Ajouter un mouvement » ouvre la saisie de mouvement pour cet actif', async () => {
    const onAddMovement = vi.fn();
    const { user } = setup({ asset: asset('etf-revolut'), onAddMovement });
    await user.click(screen.getByRole('button', { name: 'Ajouter un mouvement' }));
    expect(onAddMovement).toHaveBeenCalledTimes(1);
  });

  it('un actif Auto affiche son identifiant de cotation', () => {
    setup({ asset: asset('etf-revolut') });
    expect(field('Identifiant de cotation')).toHaveValue('IWDA.AS');
    expect(screen.getByRole('button', { name: 'Auto', pressed: true })).toBeInTheDocument();
  });
});

describe('AssetSheet — correctifs', () => {
  it('la devise est figée en modification : valeur en lecture seule, plus de liste', () => {
    setup({ asset: asset('dar-sakan') });
    const currency = field('Devise');
    expect(currency.tagName).toBe('INPUT');
    expect(currency).toHaveAttribute('readonly');
    expect(currency).toHaveValue('MAD');
    expect(screen.getByText(/ne peut plus être modifiée/)).toBeInTheDocument();
  });

  it('à la création la devise reste modifiable', () => {
    setup();
    expect(field('Devise').tagName).toBe('SELECT');
  });

  it('« Ajouter un mouvement » est désactivé tant que le formulaire a des modifications non enregistrées', async () => {
    const onAddMovement = vi.fn();
    const { user } = setup({ asset: asset('lcl'), onAddMovement });
    const add = screen.getByRole('button', { name: 'Ajouter un mouvement' });
    expect(add).toBeEnabled();
    expect(screen.queryByText('Enregistre d’abord tes modifications')).toBeNull();

    await user.type(field('Sous-type'), 'x');
    expect(add).toBeDisabled();
    expect(screen.getByText('Enregistre d’abord tes modifications')).toBeInTheDocument();
    expect(add).toHaveAccessibleDescription('Enregistre d’abord tes modifications');
    await user.click(add);
    expect(onAddMovement).not.toHaveBeenCalled();

    await user.clear(field('Sous-type'));
    expect(add).toBeEnabled();
  });
});
