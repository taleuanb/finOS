import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dashboard } from '@/lib/dashboard';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/strategie', useRouter: () => ({ refresh }) }));

import { StrategieView, type StrategieActions } from './StrategieView';

type Mocked = { [K in keyof StrategieActions]: Mock<StrategieActions[K]> };

const OK = { ok: true } as const;

function makeActions(over: Partial<StrategieActions> = {}): Mocked {
  return {
    saveMonthlyInvest: vi.fn<StrategieActions['saveMonthlyInvest']>(over.saveMonthlyInvest ?? (async () => OK)),
    saveTarget: vi.fn<StrategieActions['saveTarget']>(over.saveTarget ?? (async () => OK)),
    saveSpecialAssets: vi.fn<StrategieActions['saveSpecialAssets']>(over.saveSpecialAssets ?? (async () => OK)),
    saveMetalGrid: vi.fn<StrategieActions['saveMetalGrid']>(over.saveMetalGrid ?? (async () => OK)),
  };
}

function setup(over: Partial<StrategieActions> = {}, data: Dashboard = fixtureDashboard) {
  const actions = makeActions(over);
  const user = userEvent.setup();
  render(
    <DisplayProvider fx={data.fx}>
      <StrategieView data={data} actions={actions} />
    </DisplayProvider>,
  );
  return { actions, user };
}

const section = (name: string) => within(screen.getByRole('region', { name }));
const save = (name: string) => section(name).getByRole('button', { name: 'Enregistrer' });

async function type(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, value: string) {
  await user.clear(el);
  await user.type(el, value);
}

beforeEach(() => {
  localStorage.clear();
  refresh.mockClear();
});
afterEach(cleanup);

describe('StrategieView — structure', () => {
  it('affiche les quatre sections et le lien de retour vers Épargne', () => {
    setup();
    for (const name of ['Investissement mensuel', 'Cibles par classe', 'Actifs spéciaux', 'Grille or / argent']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Épargne/ })).toHaveAttribute('href', '/epargne');
  });

  it('une ligne par classe pilotable, aucune pour les classes non investissables', () => {
    setup();
    const items = section('Cibles par classe').getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    expect(items).toEqual(['Fonds & ETF', 'PER', 'Crypto', 'Startups', 'Métaux précieux', 'Noms de domaine']);
  });

  it('préremplit les cibles et les actifs principaux depuis la Stratégie', () => {
    setup();
    expect(screen.getByLabelText('Cible Fonds & ETF (%)')).toHaveValue('45');
    expect(screen.getByLabelText('Cible Noms de domaine (%)')).toHaveValue('');
    expect(screen.getByLabelText('Actif principal Fonds & ETF')).toHaveValue('hsbc');
    expect(screen.getByLabelText('Actif principal Noms de domaine')).toHaveValue('');
    expect(screen.getByLabelText('Montant mensuel à investir')).toHaveValue('900');
  });

  it("ne propose, pour l'actif principal, que les actifs de la classe", () => {
    setup();
    const options = within(screen.getByLabelText('Actif principal Fonds & ETF')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Aucun', 'HSBC Islamic Global Equity', 'ETF Revolut']);
  });

  it("pas d'actif principal pour les métaux précieux", () => {
    setup();
    expect(screen.getByLabelText('Cible Métaux précieux (%)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Actif principal Métaux précieux')).not.toBeInTheDocument();
  });
});

describe('StrategieView — investissement mensuel', () => {
  it('enregistre le montant saisi (virgule acceptée) puis affiche « Enregistré »', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Montant mensuel à investir'), '1250,5');
    await user.click(save('Investissement mensuel'));
    expect(actions.saveMonthlyInvest).toHaveBeenCalledWith(1250.5);
    expect(await section('Investissement mensuel').findByText('Enregistré')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('refuse un montant illisible sans appeler le serveur', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Montant mensuel à investir'), 'abc');
    await user.click(save('Investissement mensuel'));
    expect(actions.saveMonthlyInvest).not.toHaveBeenCalled();
    expect(section('Investissement mensuel').getByText('Montant invalide')).toBeInTheDocument();
  });

  it('conserve la saisie et affiche l’erreur quand l’enregistrement échoue', async () => {
    const { user } = setup({ saveMonthlyInvest: async () => ({ ok: false, error: "L'enregistrement a échoué. Réessaie dans un instant." }) });
    const input = screen.getByLabelText('Montant mensuel à investir');
    await type(user, input, '777');
    await user.click(save('Investissement mensuel'));
    expect(await section('Investissement mensuel').findByText("L'enregistrement a échoué. Réessaie dans un instant.")).toBeInTheDocument();
    expect(input).toHaveValue('777');
    expect(section('Investissement mensuel').queryByText('Enregistré')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('une action qui lève une exception affiche un message générique', async () => {
    const { user } = setup({ saveMonthlyInvest: async () => { throw new Error('réseau'); } });
    await user.click(save('Investissement mensuel'));
    expect(await section('Investissement mensuel').findByText("L'enregistrement a échoué. Réessaie dans un instant.")).toBeInTheDocument();
  });

  it('modifier la saisie efface « Enregistré »', async () => {
    const { user } = setup();
    await user.click(save('Investissement mensuel'));
    expect(await section('Investissement mensuel').findByText('Enregistré')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Montant mensuel à investir'), '1');
    expect(section('Investissement mensuel').queryByText('Enregistré')).not.toBeInTheDocument();
  });

  it('masque le champ montant (type password) en mode masqué, sans montant en clair', () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    expect(screen.getByLabelText('Montant mensuel à investir')).toHaveAttribute('type', 'password');
    expect(document.body.textContent).not.toMatch(/900/);
  });

  it('affiche le champ montant en clair quand les montants sont visibles', async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText('Montant mensuel à investir')).toHaveAttribute('type', 'text'));
  });
});

describe('StrategieView — cibles par classe', () => {
  it('signale un total différent de 100 %', () => {
    setup();
    const s = section('Cibles par classe');
    expect(s.getByText('Total des cibles : 88 %')).toBeInTheDocument();
    expect(s.getByText('Il manque 12 % pour atteindre 100 %')).toBeInTheDocument();
  });

  it('plus d’avertissement quand le total fait 100 %', async () => {
    const { user } = setup();
    await type(user, screen.getByLabelText('Cible Noms de domaine (%)'), '12');
    const s = section('Cibles par classe');
    expect(s.getByText('Total des cibles : 100 %')).toBeInTheDocument();
    expect(s.queryByText(/Il manque|dépasse/)).not.toBeInTheDocument();
  });

  it('signale un dépassement', async () => {
    const { user } = setup();
    await type(user, screen.getByLabelText('Cible Noms de domaine (%)'), '20');
    expect(section('Cibles par classe').getByText('Le total dépasse 100 % de 8 %')).toBeInTheDocument();
  });

  it("n'enregistre que les lignes modifiées, avec les bons arguments", async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Cible Crypto (%)'), '12,5');
    await user.selectOptions(screen.getByLabelText('Actif principal Fonds & ETF'), 'etf-revolut');
    await user.click(save('Cibles par classe'));
    await waitFor(() => expect(actions.saveTarget).toHaveBeenCalledTimes(2));
    expect(actions.saveTarget).toHaveBeenCalledWith('Crypto', 12.5, 'crypto');
    expect(actions.saveTarget).toHaveBeenCalledWith('Fonds & ETF', 45, 'etf-revolut');
    expect(await section('Cibles par classe').findByText('Enregistré')).toBeInTheDocument();
  });

  it('vider le pourcentage supprime la cible (null, null)', async () => {
    const { actions, user } = setup();
    await user.clear(screen.getByLabelText('Cible Startups (%)'));
    await user.click(save('Cibles par classe'));
    await waitFor(() => expect(actions.saveTarget).toHaveBeenCalledTimes(1));
    expect(actions.saveTarget).toHaveBeenCalledWith('Startups', null, null);
  });

  it('une cible sur les métaux est envoyée sans actif principal', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Cible Métaux précieux (%)'), '6');
    await user.click(save('Cibles par classe'));
    await waitFor(() => expect(actions.saveTarget).toHaveBeenCalledWith('Métaux précieux', 6, null));
  });

  it('enregistre les baisses avant les hausses (la somme reste ≤ 100 % à chaque étape)', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Cible Noms de domaine (%)'), '12');
    await type(user, screen.getByLabelText('Cible Fonds & ETF (%)'), '33');
    await user.click(save('Cibles par classe'));
    await waitFor(() => expect(actions.saveTarget).toHaveBeenCalledTimes(2));
    expect(actions.saveTarget.mock.calls.map((c) => c[0])).toEqual(['Fonds & ETF', 'Noms de domaine']);
  });

  it('refuse localement un total > 100 % sans rien envoyer', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Cible Noms de domaine (%)'), '20');
    await user.click(save('Cibles par classe'));
    expect(actions.saveTarget).not.toHaveBeenCalled();
    expect(await section('Cibles par classe').findByText(/corrige avant d’enregistrer/)).toBeInTheDocument();
  });

  it('refuse un pourcentage illisible', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Cible Crypto (%)'), 'beaucoup');
    await user.click(save('Cibles par classe'));
    expect(actions.saveTarget).not.toHaveBeenCalled();
    expect(section('Cibles par classe').getByText('Pourcentage invalide pour Crypto')).toBeInTheDocument();
  });

  it('erreur du serveur : saisies conservées, message affiché, pas de « Enregistré »', async () => {
    const { user } = setup({ saveTarget: async () => ({ ok: false, error: 'La somme des cibles dépasse 100 %' }) });
    const input = screen.getByLabelText('Cible Crypto (%)');
    await type(user, input, '15');
    await user.click(save('Cibles par classe'));
    expect(await section('Cibles par classe').findByText('La somme des cibles dépasse 100 %')).toBeInTheDocument();
    expect(input).toHaveValue('15');
    expect(section('Cibles par classe').queryByText('Enregistré')).not.toBeInTheDocument();
  });

  it('indique une cible sans actif principal', async () => {
    const { user } = setup();
    await type(user, screen.getByLabelText('Cible Noms de domaine (%)'), '3');
    expect(within(screen.getByRole('listitem', { name: 'Noms de domaine' })).getByText('Choisis un actif principal')).toBeInTheDocument();
  });
});

describe('StrategieView — actifs spéciaux', () => {
  it('préremplit or / argent / épargne et limite les choix à la bonne classe', () => {
    setup();
    expect(screen.getByLabelText('Actif or')).toHaveValue('or');
    expect(screen.getByLabelText('Actif argent')).toHaveValue('ag');
    expect(screen.getByLabelText('Actif épargne')).toHaveValue('epargne');
    expect(within(screen.getByLabelText('Actif or')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Aucun', 'Or physique', 'Argent physique',
    ]);
    expect(within(screen.getByLabelText('Actif épargne')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Aucun', 'Épargne (Banque Maroc)',
    ]);
  });

  it('enregistre les trois réglages ; « Aucun » envoie null', async () => {
    const { actions, user } = setup();
    await user.selectOptions(screen.getByLabelText('Actif argent'), '');
    await user.click(save('Actifs spéciaux'));
    expect(actions.saveSpecialAssets).toHaveBeenCalledWith({ goldAssetId: 'or', silverAssetId: null, savingsAssetId: 'epargne' });
    expect(await section('Actifs spéciaux').findByText('Enregistré')).toBeInTheDocument();
  });

  it('erreur : message affiché, sélection conservée', async () => {
    const { user } = setup({ saveSpecialAssets: async () => ({ ok: false, error: 'Actif or invalide' }) });
    await user.selectOptions(screen.getByLabelText('Actif or'), 'ag');
    await user.click(save('Actifs spéciaux'));
    expect(await section('Actifs spéciaux').findByText('Actif or invalide')).toBeInTheDocument();
    expect(screen.getByLabelText('Actif or')).toHaveValue('ag');
  });
});

describe('StrategieView — grille or / argent', () => {
  const lastSent = (actions: Mocked) => actions.saveMetalGrid.mock.calls.at(-1)![0];

  it('affiche les zones de la Stratégie avec seuils et part d’or', () => {
    setup();
    expect(screen.getByLabelText('Libellé zone 1')).toHaveValue('Or bon marché');
    expect(screen.getByLabelText('Maximum zone 1')).toHaveValue('45');
    expect(screen.getByLabelText('Part d’or zone 1 (%)')).toHaveValue('80');
    expect(screen.getByLabelText('Libellé zone 5')).toHaveValue('Argent bon marché');
    expect(screen.queryByLabelText('Maximum zone 5')).not.toBeInTheDocument();
  });

  it('enregistre la grille telle quelle (dernière zone sans maximum)', async () => {
    const { actions, user } = setup();
    await user.click(save('Grille or / argent'));
    expect(actions.saveMetalGrid).toHaveBeenCalledTimes(1);
    expect(lastSent(actions)).toEqual([
      { label: 'Or bon marché', min: 0, max: 45, goldPercent: 80 },
      { label: 'Penche or', min: 45, max: 50, goldPercent: 65 },
      { label: 'Neutre', min: 50, max: 65, goldPercent: 55 },
      { label: 'Penche argent', min: 65, max: 80, goldPercent: 40 },
      { label: 'Argent bon marché', min: 80, max: null, goldPercent: 20 },
    ]);
  });

  it('modifier un seuil décale le début de la zone suivante', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Maximum zone 3'), '60');
    await type(user, screen.getByLabelText('Part d’or zone 3 (%)'), '50');
    await user.click(save('Grille or / argent'));
    const sent = lastSent(actions);
    expect(sent[2]).toEqual({ label: 'Neutre', min: 50, max: 60, goldPercent: 50 });
    expect(sent[3]).toEqual({ label: 'Penche argent', min: 60, max: 80, goldPercent: 40 });
  });

  it('ajoute et retire une zone', async () => {
    const { actions, user } = setup();
    await user.click(section('Grille or / argent').getByRole('button', { name: 'Ajouter une zone' }));
    expect(screen.getByLabelText('Libellé zone 6')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retirer la zone 2' }));
    expect(screen.queryByLabelText('Libellé zone 6')).not.toBeInTheDocument();
    await user.click(save('Grille or / argent'));
    const sent = lastSent(actions);
    expect(sent).toHaveLength(5);
    expect(sent.map((z) => z.label)).not.toContain('Penche or');
    expect(sent[0].max).toBe(45);
    expect(sent[1].min).toBe(45);
  });

  it('refuse localement un seuil illisible ou non croissant', async () => {
    const { actions, user } = setup();
    await type(user, screen.getByLabelText('Maximum zone 2'), '40');
    await user.click(save('Grille or / argent'));
    expect(actions.saveMetalGrid).not.toHaveBeenCalled();
    expect(section('Grille or / argent').getByText('Chaque seuil doit être supérieur au précédent')).toBeInTheDocument();
  });

  it('erreur du serveur : saisies conservées', async () => {
    const { user } = setup({ saveMetalGrid: async () => ({ ok: false, error: 'Libellé de zone invalide' }) });
    await type(user, screen.getByLabelText('Libellé zone 1'), 'Nouvelle');
    await user.click(save('Grille or / argent'));
    expect(await section('Grille or / argent').findByText('Libellé de zone invalide')).toBeInTheDocument();
    expect(screen.getByLabelText('Libellé zone 1')).toHaveValue('Nouvelle');
  });

  it('signale les lignes de zone illisibles dans Notion', () => {
    const data: Dashboard = { ...fixtureDashboard, strategy: { ...fixtureDashboard.strategy, gridWarnings: ['Zone cassée'] } };
    setup({}, data);
    expect(section('Grille or / argent').getByText(/Zone cassée/)).toBeInTheDocument();
  });
});
