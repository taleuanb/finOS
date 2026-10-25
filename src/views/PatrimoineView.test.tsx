import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayProvider } from '@/ui/display';
import { fixtureDashboard } from '@/lib/fixtures';
import type { Dashboard } from '@/lib/dashboard';
import { PatrimoineView, type PatrimoineActions } from './PatrimoineView';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const ok = () => vi.fn().mockResolvedValue({ ok: true });
let actions: PatrimoineActions;

beforeEach(() => {
  localStorage.clear();
  refresh.mockClear();
  actions = {
    createAsset: ok(), updateAsset: ok(), archiveAsset: ok(), addMovement: ok(),
    createDebt: ok(), updateDebt: ok(), deleteDebt: ok(),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(data: Dashboard = fixtureDashboard) {
  return render(
    <DisplayProvider fx={data.fx}>
      <PatrimoineView data={data} actions={actions} />
    </DisplayProvider>,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

async function applyFilter(user: ReturnType<typeof userEvent.setup>, chip: RegExp, option: string) {
  await user.click(screen.getByRole('button', { name: chip }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('checkbox', { name: option }));
  await user.click(within(dialog).getByRole('button', { name: 'Appliquer' }));
}

describe('PatrimoineView', () => {
  it('liste 19 actifs répartis en 10 groupes', () => {
    setup();
    expect(screen.getAllByRole('region')).toHaveLength(10);
    expect(screen.getByText('19 actifs')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(19);
  });

  it("affiche Dar Sakan en euros et son montant d'origine en MAD", () => {
    setup();
    const row = rowOf('Dar Sakan');
    expect(within(row).getByText('110 599 €')).toBeInTheDocument();
    expect(within(row).getByText('1 200 000 MAD')).toBeInTheDocument();
    expect(within(row).getByText('DS')).toBeInTheDocument();
    expect(within(row).getByText('Résidence secondaire · Maroc')).toBeInTheDocument();
    expect(within(row).getByText(/8,30 %/)).toBeInTheDocument();
  });

  it("n'affiche pas de montant d'origine pour un actif en EUR", () => {
    setup();
    const row = rowOf('ETF Revolut');
    expect(within(row).queryByText(/MAD|\$/)).toBeNull();
    expect(within(row).getByText('Revolut')).toBeInTheDocument();
  });

  it("masque aussi le montant d'origine en mode masqué", async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    const row = rowOf('Dar Sakan');
    expect(await within(row).findAllByText('•••••••')).toHaveLength(2);
    expect(within(row).queryByText(/MAD/)).toBeNull();
  });

  it('le filtre Devise = MAD ne laisse que des actifs en MAD', async () => {
    const user = userEvent.setup();
    setup();
    await applyFilter(user, /^\+ Devise/, 'MAD');
    const mad = fixtureDashboard.assets.filter((a) => a.currency === 'MAD');
    expect(screen.getAllByRole('listitem')).toHaveLength(mad.length);
    for (const a of mad) expect(screen.getByText(a.name)).toBeInTheDocument();
    expect(screen.queryByText('ETF Revolut')).toBeNull();
    expect(screen.getByText(`${mad.length} actifs`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devise · 1' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('le filtre Type et le filtre Établissement se combinent', async () => {
    const user = userEvent.setup();
    setup();
    await applyFilter(user, /^\+ Type/, 'Comptes courants');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await applyFilter(user, /^\+ Établissement/, 'LCL');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Compte de dépôts (LCL)')).toBeInTheDocument();
  });

  it('Réinitialiser retire le filtre', async () => {
    const user = userEvent.setup();
    setup();
    await applyFilter(user, /^\+ Devise/, 'MAD');
    await user.click(screen.getByRole('button', { name: 'Devise · 1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Réinitialiser' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(19);
    expect(screen.getByRole('button', { name: '+ Devise' })).toBeInTheDocument();
  });

  it('la feuille de filtre est une boîte de dialogue modale', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '+ Type' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rend le focus à la puce après Échap, Appliquer, Réinitialiser et clic sur le fond', async () => {
    const user = userEvent.setup();
    setup();
    const chip = () => screen.getByRole('button', { name: /^(\+ )?Type/ });

    await user.click(chip());
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(chip()).toHaveFocus();

    await user.click(chip());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    expect(chip()).toHaveFocus();

    await user.click(chip());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Réinitialiser' }));
    expect(chip()).toHaveFocus();

    await user.click(chip());
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
  });

  it('garde la tabulation dans la feuille (Tab et Maj+Tab bouclent)', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '+ Devise' }));
    const dialog = screen.getByRole('dialog');
    const apply = within(dialog).getByRole('button', { name: 'Appliquer' });
    const first = within(dialog).getAllByRole('checkbox')[0];
    apply.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(apply).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('ne vole pas le focus de la case cochée quand le parent est re-rendu', async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    await user.click(screen.getByRole('button', { name: '+ Devise' }));
    const box = within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'MAD' });
    await user.click(box);
    expect(box).toHaveFocus();
    rerender(
      <DisplayProvider fx={fixtureDashboard.fx}>
        <PatrimoineView data={{ ...fixtureDashboard }} actions={actions} />
      </DisplayProvider>,
    );
    expect(box).toHaveFocus();
  });

  it("l'onglet Passifs affiche le Crédit Dar Sakan sans les filtres", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Passifs' }));
    expect(screen.getByRole('tab', { name: 'Passifs' })).toHaveAttribute('aria-selected', 'true');
    const row = rowOf('Crédit Dar Sakan');
    expect(within(row).getByText('55 300 €')).toBeInTheDocument();
    expect(within(row).getByText('600 000 MAD')).toBeInTheDocument();
    expect(screen.getByText('1 passif')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Type/ })).toBeNull();
    expect(screen.queryByText('Dar Sakan')).toBeNull();
  });

  it('M4 : un statut de synchro déjà préfixé par ⚠ n’est pas doublé', () => {
    const assets = fixtureDashboard.assets.map((a) =>
      a.id === 'hsbc' ? { ...a, stale: true, syncStatus: '⚠ délai dépassé (8 s) : Yahoo' } : a,
    );
    setup({ ...fixtureDashboard, assets });
    expect(within(rowOf('HSBC Islamic Global Equity')).getByText('⚠ délai dépassé (8 s) : Yahoo')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/⚠\s*⚠/);
  });

  it("affiche le statut d'un actif périmé", () => {
    const assets = fixtureDashboard.assets.map((a) =>
      a.id === 'hsbc' ? { ...a, stale: true, syncStatus: 'prix indisponible' } : a,
    );
    setup({ ...fixtureDashboard, assets });
    expect(within(rowOf('HSBC Islamic Global Equity')).getByText('⚠ prix indisponible')).toBeInTheDocument();
    expect(within(rowOf('ETF Revolut')).queryByText(/⚠/)).toBeNull();
  });

  it('affiche le bandeau « Données du … » si le tableau de bord est périmé', () => {
    setup({ ...fixtureDashboard, stale: true });
    expect(screen.getByText(/Données du 25 octobre 2026/)).toBeInTheDocument();
  });

  it('date le bandeau au jour de Paris (23:30 UTC = lendemain)', () => {
    setup({ ...fixtureDashboard, stale: true, lastSyncOk: '2026-10-24T23:30:00.000Z' });
    expect(screen.getByText(/Données du 25 octobre 2026/)).toBeInTheDocument();
  });

  it('pas de bandeau quand les données sont fraîches', () => {
    setup();
    expect(screen.queryByText(/Données du/)).toBeNull();
  });
});

describe('PatrimoineView — écriture', () => {
  it('Ajouter ouvre la feuille de création d’un actif (plus de lien vers Notion)', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('link')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByRole('dialog', { name: 'Nouvel actif' })).toBeInTheDocument();
  });

  it('un clic sur une ligne d’actif ouvre l’édition pré-remplie', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(rowOf('Dar Sakan')).getByRole('button', { name: 'Modifier Dar Sakan' }));
    const dialog = screen.getByRole('dialog', { name: 'Modifier l’actif' });
    expect(within(dialog).getByLabelText('Nom')).toHaveValue('Dar Sakan');
  });

  it('les lignes d’actif sont des boutons tactiles dont le nom ne contient aucun montant (mode masqué)', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    const buttons = screen.getAllByRole('button', { name: /^Modifier / });
    expect(buttons).toHaveLength(19);
    for (const b of buttons) {
      expect(b.className).toContain('min-h-11');
      expect(b.getAttribute('aria-label')).not.toMatch(/€|MAD|\$|%/);
    }
    const row = rowOf('Dar Sakan');
    await vi.waitFor(() => expect(within(row).queryByText('110 599 €')).toBeNull());
  });

  it('un enregistrement réussi ferme la feuille, rafraîchit la route et rend le focus à la ligne', async () => {
    const user = userEvent.setup();
    setup();
    const rowButton = within(rowOf('Revolut Current')).getByRole('button', { name: 'Modifier Revolut Current' });
    await user.click(rowButton);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Nom'));
    await user.type(within(dialog).getByLabelText('Nom'), 'Revolut perso');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(actions.updateAsset).toHaveBeenCalledWith('revolut', { name: 'Revolut perso' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rowButton).toHaveFocus();
  });

  it('un échec garde la feuille ouverte avec la saisie et l’erreur, sans rafraîchir', async () => {
    actions.updateAsset = vi.fn().mockResolvedValue({ ok: false, error: 'Enregistrement impossible, réessaie dans un instant.' });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Modifier Revolut Current' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Nom'));
    await user.type(within(dialog).getByLabelText('Nom'), 'Autre nom');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('réessaie');
    expect(within(dialog).getByLabelText('Nom')).toHaveValue('Autre nom');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Ajouter un mouvement depuis l’édition ouvre la saisie de mouvement de cet actif', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Modifier Or physique' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un mouvement' }));
    const dialog = screen.getByRole('dialog', { name: 'Mouvement · Or physique' });
    expect(within(dialog).getByLabelText('Poids fin (g)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Poids fin (g)'), '3,11');
    await user.type(within(dialog).getByLabelText('Montant (EUR)'), '400');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(actions.addMovement).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'or', kind: 'buy', quantity: 3.11, amount: 400 }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('Archiver depuis la feuille appelle l’action d’archivage', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Modifier Revolut Current' }));
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(actions.archiveAsset).toHaveBeenCalledWith('revolut', true);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('l’onglet Passifs propose « Ajouter un crédit » et masque « Ajouter » d’actif', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Passifs' }));
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ajouter un crédit' }));
    expect(screen.getByRole('dialog', { name: 'Nouveau crédit' })).toBeInTheDocument();
  });

  it('un clic sur un crédit ouvre son édition ; Supprimer appelle l’action', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Passifs' }));
    await user.click(screen.getByRole('button', { name: 'Modifier Crédit Dar Sakan' }));
    const dialog = screen.getByRole('dialog', { name: 'Modifier le crédit' });
    expect(within(dialog).getByLabelText('Nom')).toHaveValue('Crédit Dar Sakan');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(actions.deleteDebt).toHaveBeenCalledWith('credit-dar-sakan');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('crée un crédit depuis l’onglet Passifs', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Passifs' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un crédit' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'Prêt auto');
    await user.type(within(dialog).getByLabelText(/^Capital restant dû/), '8000');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(actions.createDebt).toHaveBeenCalledWith({ name: 'Prêt auto', currency: 'EUR', outstanding: 8000 });
  });
});
