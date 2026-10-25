import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dashboard } from '@/lib/dashboard';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';
import type { SankeyData } from '@/ui/charts/SankeyChart';

const exportPng = vi.fn();
vi.mock('./exportPng', () => ({ exportSankeyPng: (...a: unknown[]) => exportPng(...a) }));

let lastSankey: SankeyData | null = null;
vi.mock('@/ui/charts/SankeyChart', () => ({
  SankeyChart: ({ data }: { data: SankeyData }) => {
    lastSankey = data;
    return <svg data-testid="sankey" />;
  },
}));

import { BudgetView, type BudgetActions } from './BudgetView';

type Mocked = { [K in keyof BudgetActions]: Mock<BudgetActions[K]> };

function makeActions(over: Partial<BudgetActions> = {}): Mocked {
  return {
    save: vi.fn<BudgetActions['save']>(over.save ?? (async () => ({ ok: true, id: 'notion-1' }))),
    remove: vi.fn<BudgetActions['remove']>(over.remove ?? (async () => ({ ok: true }))),
    reorder: vi.fn<BudgetActions['reorder']>(over.reorder ?? (async () => ({ ok: true }))),
  };
}

function setup(over: Partial<BudgetActions> = {}, data: Dashboard = fixtureDashboard) {
  const actions = makeActions(over);
  const user = userEvent.setup();
  render(
    <DisplayProvider fx={data.fx}>
      <BudgetView data={data} actions={actions} />
    </DisplayProvider>,
  );
  return { actions, user };
}

const summary = () => within(screen.getByRole('region', { name: 'Résumé' }));
const amountInput = (name: string) => screen.getByLabelText(`Montant ${name}`) as HTMLInputElement;

async function setAmount(user: ReturnType<typeof userEvent.setup>, name: string, value: string) {
  const input = amountInput(name);
  await user.clear(input);
  await user.type(input, value);
}

beforeEach(() => {
  localStorage.clear();
  exportPng.mockReset();
  lastSankey = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BudgetView — résumé', () => {
  it("affiche le taux d'épargne de la fixture : 49 %", () => {
    setup();
    expect(summary().getByText('49 %')).toBeInTheDocument();
    expect(summary().getByText('3 615 €')).toBeInTheDocument();
    expect(summary().getByText('1 845 €')).toBeInTheDocument();
  });

  it('met Courses à 600 : dépenses 2 045 € avant tout enregistrement, Sankey recalculé', async () => {
    const { actions, user } = setup();
    await setAmount(user, 'Courses', '600');
    expect(summary().getByText('2 045 €')).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
    const vie = lastSankey!.nodes.findIndex((n) => n.name === 'Vie quotidienne');
    expect(lastSankey!.links.find((l) => l.target === vie)?.value).toBe(820);
  });

  it('accepte la virgule française', async () => {
    const { user } = setup();
    await setAmount(user, 'Courses', '600,5');
    expect(summary().getByText('2 046 €')).toBeInTheDocument();
  });

  it('propose de répartir le montant investi vers /epargne', () => {
    setup();
    const link = screen.getByRole('link', { name: /Répartir mes 900 €/ });
    expect(link).toHaveAttribute('href', '/epargne');
  });

  it('affiche la bannière quand les données sont périmées', () => {
    setup({}, { ...fixtureDashboard, stale: true, asOf: '2026-10-20' });
    expect(screen.getByText('Données du 20/10/2026')).toBeInTheDocument();
  });
});

describe('BudgetView — Sankey', () => {
  const orphans = (d: SankeyData) => d.nodes.filter((_, i) => !d.links.some((l) => l.source === i || l.target === i));

  it('sans ligne : message à la place du graphique', () => {
    setup({}, { ...fixtureDashboard, budget: { ...fixtureDashboard.budget, lines: [] } });
    expect(screen.getByText(/Ajoute des revenus et des dépenses/)).toBeInTheDocument();
    expect(screen.queryByTestId('sankey')).not.toBeInTheDocument();
  });

  it('déficit : phrase dédiée et aucun nœud orphelin', async () => {
    const { user } = setup();
    await setAmount(user, 'Loyer', '5000');
    expect(screen.getByText(/Tes dépenses dépassent tes revenus de/)).toBeInTheDocument();
    expect(screen.getByTestId('sankey')).toBeInTheDocument();
    const names = lastSankey!.nodes.map((n) => n.name);
    expect(names).not.toContain('Investissements');
    expect(names).not.toContain('Épargne libre');
    expect(orphans(lastSankey!)).toEqual([]);
    for (const l of lastSankey!.links) {
      expect(lastSankey!.nodes[l.source]).toBeDefined();
      expect(lastSankey!.nodes[l.target]).toBeDefined();
    }
  });

  it('investissement nul : pas de nœud Investissements', () => {
    setup({}, { ...fixtureDashboard, strategy: { ...fixtureDashboard.strategy, monthlyInvest: 0 } });
    expect(lastSankey!.nodes.map((n) => n.name)).not.toContain('Investissements');
    expect(orphans(lastSankey!)).toEqual([]);
  });
});

describe('BudgetView — validation', () => {
  // le résumé garde la dernière valeur valide saisie (« 12x » : 12 était valide avant le « x »)
  it.each([['-5', '1 845 €'], ['abc', '1 845 €'], ['12x', '1 457 €']])('refuse « %s » avec « Montant invalide » sans enregistrer', async (bad, expenses) => {
    const { actions, user } = setup();
    await setAmount(user, 'Courses', bad);
    await user.tab();
    expect(screen.getByText('Montant invalide')).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
    expect(summary().getByText(expenses)).toBeInTheDocument();
  });

  it('un champ vidé puis quitté est refusé', async () => {
    const { actions, user } = setup();
    await user.clear(amountInput('Courses'));
    await user.tab();
    expect(screen.getByText('Montant invalide')).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
  });
});

describe('BudgetView — enregistrement', () => {
  it('enregistre au blur et indique « Enregistré »', async () => {
    const { actions, user } = setup();
    await setAmount(user, 'Courses', '600');
    await user.tab();
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b-courses', name: 'Courses', monthlyAmount: 600, currency: 'EUR', section: 'depense', category: 'Vie quotidienne' }),
    );
    const card = within(screen.getByRole('region', { name: 'Vie quotidienne' }));
    expect(await card.findByText('Enregistré')).toBeInTheDocument();
  });

  it("n'enregistre pas si rien n'a changé", async () => {
    const { actions, user } = setup();
    await user.click(amountInput('Courses'));
    await user.tab();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("si l'action renvoie une erreur, la saisie est conservée et l'erreur affichée", async () => {
    const { actions, user } = setup({ save: vi.fn(async () => ({ ok: false as const, error: 'Notion indisponible' })) });
    await setAmount(user, 'Courses', '600');
    await user.tab();
    const card = within(screen.getByRole('region', { name: 'Vie quotidienne' }));
    expect(await card.findByText('Notion indisponible')).toBeInTheDocument();
    expect(amountInput('Courses').value).toBe('600');
    expect(summary().getByText('2 045 €')).toBeInTheDocument();
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("si l'action lève une exception, la saisie est conservée", async () => {
    const { user } = setup({ save: vi.fn(async () => { throw new Error('réseau'); }) });
    await setAmount(user, 'Courses', '600');
    await user.tab();
    expect(await screen.findByText(/Enregistrement impossible/)).toBeInTheDocument();
    expect(amountInput('Courses').value).toBe('600');
  });

  it('enregistre un changement de devise', async () => {
    const { actions, user } = setup();
    await user.selectOptions(screen.getByLabelText('Devise Courses'), 'USD');
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-courses', currency: 'USD' })));
  });

  it('crée une ligne vide localement, puis la persiste au premier blur valide, puis la met à jour', async () => {
    const { actions, user } = setup();
    const card = within(screen.getByRole('region', { name: 'Abonnements' }));
    await user.click(card.getByRole('button', { name: '+ Ajouter une dépense' }));
    expect(actions.save).not.toHaveBeenCalled();

    const name = card.getByLabelText('Nom de la nouvelle ligne');
    await user.type(name, 'Cinéma');
    await user.tab(); // quitte le nom : montant 0 valide → enregistrement
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ id: expect.anything() }),
    );
    expect(actions.save.mock.calls[0][0]).toMatchObject({ name: 'Cinéma', monthlyAmount: 0, section: 'depense', category: 'Abonnements', currency: 'EUR' });

    await setAmount(user, 'Cinéma', '12,5');
    await user.tab();
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2));
    expect(actions.save.mock.calls[1][0]).toMatchObject({ id: 'notion-1', name: 'Cinéma', monthlyAmount: 12.5 });
  });

  it("n'enregistre pas une nouvelle ligne sans nom", async () => {
    const { actions, user } = setup();
    const card = within(screen.getByRole('region', { name: 'Abonnements' }));
    await user.click(card.getByRole('button', { name: '+ Ajouter une dépense' }));
    await user.tab();
    await user.tab();
    expect(actions.save).not.toHaveBeenCalled();
  });
});

describe('BudgetView — suppression', () => {
  it("ne supprime rien si l'utilisateur refuse la confirmation", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { actions, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Supprimer Courses' }));
    expect(actions.remove).not.toHaveBeenCalled();
    expect(amountInput('Courses')).toBeInTheDocument();
  });

  it('supprime après confirmation et recalcule le résumé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { actions, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Supprimer Courses' }));
    expect(actions.remove).toHaveBeenCalledWith('b-courses');
    await waitFor(() => expect(screen.queryByLabelText('Montant Courses')).not.toBeInTheDocument());
    expect(summary().getByText('1 445 €')).toBeInTheDocument();
  });

  it("garde la ligne et affiche l'erreur si la suppression échoue", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = setup({ remove: vi.fn(async () => ({ ok: false as const, error: 'Suppression impossible' })) });
    await user.click(screen.getByRole('button', { name: 'Supprimer Courses' }));
    expect(await screen.findByText('Suppression impossible')).toBeInTheDocument();
    expect(amountInput('Courses')).toBeInTheDocument();
  });
});

describe('BudgetView — ordre', () => {
  it("monte et descend une ligne et enregistre l'ordre", async () => {
    const { actions, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Descendre Loyer' }));
    await waitFor(() => expect(actions.reorder).toHaveBeenCalledTimes(1));
    const ids = actions.reorder.mock.calls[0][0] as string[];
    expect(ids.indexOf('b-charges')).toBeLessThan(ids.indexOf('b-loyer'));
    expect(ids).toHaveLength(10);
    const logement = within(screen.getByRole('region', { name: 'Logement' }));
    const amounts = logement.getAllByLabelText(/^Montant /).map((i) => i.getAttribute('aria-label'));
    expect(amounts).toEqual(['Montant Charges', 'Montant Loyer']);
  });

  it('désactive Monter sur la première ligne et Descendre sur la dernière', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Monter Loyer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre Charges' })).toBeDisabled();
  });
});

describe('BudgetView — catégories et onglets', () => {
  it('ajoute une catégorie puis une ligne dedans', async () => {
    const { actions, user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Ajouter une catégorie' }));
    await user.type(screen.getByLabelText('Nom de la catégorie'), 'Loisirs');
    await user.click(screen.getByRole('button', { name: 'Créer la catégorie' }));
    const card = within(screen.getByRole('region', { name: 'Loisirs' }));
    await user.click(card.getByRole('button', { name: '+ Ajouter une dépense' }));
    await user.type(card.getByLabelText('Nom de la nouvelle ligne'), 'Cinéma');
    await user.tab();
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ category: 'Loisirs', name: 'Cinéma' })));
  });

  it('refuse une catégorie déjà existante', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Ajouter une catégorie' }));
    await user.type(screen.getByLabelText('Nom de la catégorie'), 'Logement');
    await user.click(screen.getByRole('button', { name: 'Créer la catégorie' }));
    expect(screen.getByText('Cette catégorie existe déjà')).toBeInTheDocument();
  });

  it('affiche les revenus (dont MAD) dans leur onglet', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Revenus' }));
    expect(screen.getByRole('region', { name: 'Revenus locatifs' })).toBeInTheDocument();
    expect(amountInput('Loyer LCD Kesh').value).toBe('4500');
    expect(screen.getByLabelText('Devise Loyer LCD Kesh')).toHaveValue('MAD');
    expect(screen.queryByLabelText('Montant Courses')).not.toBeInTheDocument();
  });

  it('Investissements : lecture seule, affiche le plan validé', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Investissements' }));
    expect(screen.getByText('HSBC Islamic Global Equity')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Ajouter/ })).not.toBeInTheDocument();
  });

  it('Investissements : les reliquats (prévu 0 €) ne sont pas listés dans le plan du mois', async () => {
    const carried = {
      assetId: 'kunto', assetName: 'kunto', plannedEur: 0, origin: 'cible' as const,
      reason: 'Reliquat des mois précédents', toInvestEur: 50, monthsAccrued: 0, status: 'pending' as const,
    };
    const data: Dashboard = { ...fixtureDashboard, plan: { ...fixtureDashboard.plan, lines: [...fixtureDashboard.plan.lines, carried] } };
    const { user } = setup({}, data);
    await user.click(screen.getByRole('tab', { name: 'Investissements' }));
    expect(screen.getByText('HSBC Islamic Global Equity')).toBeInTheDocument();
    expect(screen.queryByText('kunto')).not.toBeInTheDocument();
  });

  it('Investissements : propose la répartition quand le plan n’est pas validé', async () => {
    const data: Dashboard = {
      ...fixtureDashboard,
      plan: { ...fixtureDashboard.plan, validated: false, lines: [], proposal: [{ assetId: 'hsbc', amount: 450, origin: 'cible', reason: 'x' }] },
    };
    const { user } = setup({}, data);
    await user.click(screen.getByRole('tab', { name: 'Investissements' }));
    expect(screen.getByText('HSBC Islamic Global Equity')).toBeInTheDocument();
    expect(screen.getByText('450 €')).toBeInTheDocument();
  });

  it("Investissements : affiche l'erreur d'allocation à défaut", async () => {
    const data: Dashboard = {
      ...fixtureDashboard,
      plan: { ...fixtureDashboard.plan, validated: false, lines: [], proposal: null, allocationError: 'Aucun actif principal pour la classe Crypto' },
    };
    const { user } = setup({}, data);
    await user.click(screen.getByRole('tab', { name: 'Investissements' }));
    expect(screen.getByText('Aucun actif principal pour la classe Crypto')).toBeInTheDocument();
  });
});

describe('BudgetView — export et masquage', () => {
  it('« Exporter le graphique » appelle la fonction d’export', async () => {
    exportPng.mockResolvedValue(true);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Exporter le graphique' }));
    expect(exportPng).toHaveBeenCalledTimes(1);
  });

  it("signale un export impossible", async () => {
    exportPng.mockResolvedValue(false);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Exporter le graphique' }));
    expect(await screen.findByText(/Export impossible/)).toBeInTheDocument();
  });

  it('mode masqué : aucun montant visible ni saisi en clair', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    setup();
    await waitFor(() => expect(screen.queryByText('1 845 €')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/\d\s?\d{3}\s€/);
    expect(amountInput('Courses').type).toBe('password');
  });
});
