import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { allocate } from '@/domain/allocation';
import type { AllocationLine } from '@/domain/types';
import type { Dashboard } from '@/lib/dashboard';
import { fixtureDashboard } from '@/lib/fixtures';
import { DisplayProvider } from '@/ui/display';
import { EpargneView, MonthPill } from './EpargneView';

vi.mock('next/navigation', () => ({ usePathname: () => '/epargne', useRouter: () => ({ refresh: vi.fn() }) }));

const OK = { ok: true } as const;
const validatePlan = vi.fn(async (..._a: unknown[]) => OK as { ok: true } | { ok: false; error: string });
const declarePurchase = vi.fn(async (..._a: unknown[]) => OK as { ok: true } | { ok: false; error: string });

const proposal: AllocationLine[] = [
  { assetId: 'per', amount: 100, origin: 'fixe', reason: 'Versement fixe programmé' },
  { assetId: 'hsbc', amount: 500, origin: 'cible', reason: 'Classe Fonds & ETF en retard sur sa cible' },
  { assetId: 'or', amount: 200, origin: 'signal', reason: 'Ratio 64,51 · zone Neutre (55 % or)' },
  { assetId: 'syla', amount: 100, origin: 'cible', reason: 'Classe Startups en retard sur sa cible' },
];

function unvalidated(over: Partial<Dashboard['plan']> = {}): Dashboard {
  return {
    ...fixtureDashboard,
    plan: { ...fixtureDashboard.plan, validated: false, proposal, lines: [], investedEur: 0, pendingEur: 0, ...over },
  };
}

function renderView(data: Dashboard) {
  return render(
    <DisplayProvider fx={data.fx}>
      <EpargneView data={data} validatePlan={validatePlan} declarePurchase={declarePurchase} />
    </DisplayProvider>,
  );
}

const rowOf = (name: RegExp) => screen.getByRole('listitem', { name });

beforeEach(() => {
  validatePlan.mockClear();
  declarePurchase.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('EpargneView — plan validé', () => {
  it('affiche Or avec 330 € à investir, 2 mois cumulés et le statut En attente', () => {
    renderView(fixtureDashboard);
    const row = rowOf(/Or physique/);
    expect(within(row).getByText('330 €')).toBeInTheDocument();
    expect(within(row).getByText(/2 mois cumulés/)).toBeInTheDocument();
    expect(within(row).getByText('En attente')).toBeInTheDocument();
    expect(within(row).getByText(/Prévu/)).toHaveTextContent('Prévu 165 €');
    expect(within(row).getByRole('button', { name: /Déclarer l'achat/ })).toBeInTheDocument();
  });

  it("n'affiche pas « À investir » pour une ligne déjà déclarée", () => {
    renderView(fixtureDashboard);
    const row = rowOf(/HSBC/);
    expect(within(row).getByText(/Déclaré/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Déclarer l'achat/ })).not.toBeInTheDocument();
    expect(within(row).queryByText(/À investir/)).not.toBeInTheDocument();
  });

  it("n'affiche ni proposition ni bouton « Valider le plan »", () => {
    renderView(fixtureDashboard);
    expect(screen.queryByRole('button', { name: 'Valider le plan' })).not.toBeInTheDocument();
  });

  it("affiche l'épargne du mois, la carte Épargne et sa phrase explicative", () => {
    renderView(fixtureDashboard);
    const month = screen.getByRole('region', { name: 'Épargne du mois' });
    expect(within(month).getByText('1 770 €')).toBeInTheDocument();
    expect(within(month).getByText('Investi')).toBeInTheDocument();
    expect(within(month).getByText('En attente')).toBeInTheDocument();
    expect(within(month).getByText('Épargne libre')).toBeInTheDocument();
    const savings = screen.getByRole('region', { name: 'Compte Épargne' });
    expect(within(savings).getByText(/Réservé au plan/)).toBeInTheDocument();
    expect(within(savings).getByText(/Libre/)).toBeInTheDocument();
    expect(within(savings).getByText(/s'ajoute au mois suivant/)).toBeInTheDocument();
  });

  it('masque les montants en mode masqué', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    renderView(fixtureDashboard);
    await waitFor(() => expect(screen.queryByText('330 €')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/\d\s?€/);
  });

  it('affiche la bannière de données anciennes', () => {
    // M2 : bandeau commun (StaleBanner) : date de la dernière synchro à Paris, format long.
    renderView({ ...fixtureDashboard, stale: true, asOf: '2026-10-27', lastSyncOk: '2026-10-20T05:00:00Z' });
    expect(screen.getByText('Données du 20 octobre 2026')).toBeInTheDocument();
  });
});

describe('EpargneView — déclarer l’achat', () => {
  it('ouvre une feuille préremplie et déclare un actif non métal', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).queryByLabelText(/Poids fin/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Montant/)).toHaveValue('600');
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(declarePurchase).toHaveBeenCalledTimes(1));
    const args = declarePurchase.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(['syla', '2026-11', 600]);
    expect(args[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args).toHaveLength(4);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('exige le poids fin pour un métal et le transmet', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Or physique/)).getByRole('button', { name: /Déclarer l'achat/ }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmer' });

    await user.click(confirm);
    expect(declarePurchase).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/poids fin/i);

    await user.type(within(dialog).getByLabelText(/Poids fin/), '2,5');
    await user.click(confirm);
    await waitFor(() => expect(declarePurchase).toHaveBeenCalledTimes(1));
    expect(declarePurchase.mock.calls[0].slice(0, 3)).toEqual(['or', '2026-11', 330]);
    expect(declarePurchase.mock.calls[0][4]).toBe(2.5);
  });

  it("refuse un montant nul et affiche l'erreur renvoyée par l'action", async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    const dialog = screen.getByRole('dialog');
    const amount = within(dialog).getByLabelText(/Montant/);
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(declarePurchase).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();

    declarePurchase.mockResolvedValueOnce({ ok: false, error: 'Notion indisponible' });
    await user.clear(amount);
    await user.type(amount, '50');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await within(dialog).findByText('Notion indisponible')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Annuler ferme la feuille sans appeler l’action', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(declarePurchase).not.toHaveBeenCalled();
  });
});

describe('EpargneView — proposition à valider', () => {
  it('« Valider le plan » appelle validatePlan avec les lignes proposées', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    const button = screen.getByRole('button', { name: 'Valider le plan' });
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(() => expect(validatePlan).toHaveBeenCalledTimes(1));
    expect(validatePlan).toHaveBeenCalledWith('2026-11', proposal);
  });

  it('modifier une ligne pour que le total ne fasse plus 900 € désactive le bouton', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    const input = screen.getByLabelText(/Pertinence Retraite/);
    await user.clear(input);
    await user.type(input, '150');
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeDisabled();
    expect(screen.getByText('Total ≠ 900 €')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/HSBC/));
    await user.type(screen.getByLabelText(/HSBC/), '450');
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeEnabled();
    expect(screen.queryByText('Total ≠ 900 €')).not.toBeInTheDocument();
  });

  it('accepte la virgule française et transmet les montants modifiés', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    const per = screen.getByLabelText(/Pertinence Retraite/);
    const hsbc = screen.getByLabelText(/HSBC/);
    await user.clear(per);
    await user.type(per, '100,5');
    await user.clear(hsbc);
    await user.type(hsbc, '499,5');
    await user.click(screen.getByRole('button', { name: 'Valider le plan' }));
    await waitFor(() => expect(validatePlan).toHaveBeenCalledTimes(1));
    const sent = validatePlan.mock.calls[0][1] as AllocationLine[];
    expect(sent.map((l) => l.amount)).toEqual([100.5, 499.5, 200, 100]);
    expect(sent[0]).toMatchObject({ assetId: 'per', origin: 'fixe' });
  });

  it('un champ vide ou illisible désactive le bouton', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    await user.clear(screen.getByLabelText(/Pertinence Retraite/));
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeDisabled();
  });

  it("affiche l'erreur renvoyée par validatePlan", async () => {
    validatePlan.mockResolvedValueOnce({ ok: false, error: 'Plan déjà validé pour 2026-11' });
    const user = userEvent.setup();
    renderView(unvalidated());
    await user.click(screen.getByRole('button', { name: 'Valider le plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan déjà validé pour 2026-11');
  });
});

describe('EpargneView — erreur d’allocation', () => {
  const failing = () => unvalidated({ proposal: null, allocationError: 'Aucun actif principal pour la classe Crypto' });

  it("affiche le bandeau d'erreur et pas de bouton de validation", () => {
    renderView(failing());
    expect(screen.getByRole('alert')).toHaveTextContent('Aucun actif principal pour la classe Crypto');
    expect(screen.queryByRole('button', { name: 'Valider le plan' })).not.toBeInTheDocument();
  });

  it("propose le lien « Régler la stratégie » dans le bandeau d'erreur", () => {
    renderView(failing());
    const link = within(screen.getByRole('alert')).getByRole('link', { name: 'Régler la stratégie' });
    expect(link).toHaveAttribute('href', '/strategie');
    expect(screen.getAllByRole('link', { name: 'Régler la stratégie' })).toHaveLength(1);
  });
});

describe('EpargneView — accès à la Stratégie', () => {
  it("affiche le lien « Régler la stratégie » vers /strategie, une seule fois, sans lien Notion", () => {
    renderView(fixtureDashboard);
    expect(screen.getByRole('link', { name: 'Régler la stratégie' })).toHaveAttribute('href', '/strategie');
    expect(screen.getAllByRole('link', { name: 'Régler la stratégie' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Notion/ })).not.toBeInTheDocument();
  });
});

describe('EpargneView — simulateur', () => {
  const sim = () => screen.getByRole('region', { name: 'Simulateur' });
  const amountsOf = (root: HTMLElement) =>
    within(root).getAllByRole('listitem').map((li) => ({
      text: li.textContent ?? '',
      amount: Number(((li.querySelector('[data-amount]') as HTMLElement).textContent ?? '').replace(/[^\d]/g, '')),
    }));

  it('calcule en Mensuel avec le montant à investir par défaut', () => {
    renderView(fixtureDashboard);
    expect(within(sim()).getByLabelText('Montant à investir')).toHaveValue('900');
    const lines = amountsOf(sim());
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(900);
  });

  it('Annuel avec 8 400 € affiche une ligne PER d’au moins 1 200 € et somme exacte 8 400 €', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(sim()).getByRole('button', { name: 'Annuel' }));
    const input = within(sim()).getByLabelText('Montant à investir');
    expect(input).toHaveValue('10800');
    await user.clear(input);
    await user.type(input, '8400');

    const lines = amountsOf(sim());
    const per = lines.find((l) => /Pertinence Retraite/.test(l.text));
    expect(per).toBeDefined();
    expect(per!.amount).toBeGreaterThanOrEqual(1200);
    expect(lines.some((l) => l.text.includes('Versement fixe programmé'))).toBe(true);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(8400);
  });

  it("affiche le message d'une AllocationError au lieu de planter", async () => {
    const user = userEvent.setup();
    const data: Dashboard = {
      ...fixtureDashboard,
      strategy: { ...fixtureDashboard.strategy, goldAssetId: undefined },
    };
    renderView(data);
    const input = within(sim()).getByLabelText('Montant à investir');
    await user.clear(input);
    await user.type(input, '1000');
    expect(within(sim()).getByRole('alert')).toHaveTextContent('Aucun actif principal pour la classe Métaux précieux');
  });

  it("n'affiche aucune ligne pour un montant vide ou nul", async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.clear(within(sim()).getByLabelText('Montant à investir'));
    expect(within(sim()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(sim()).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EpargneView — mode masqué (fuites)', () => {
  const hide = () => localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
  const amountInputs = (root: ParentNode = document) =>
    [...root.querySelectorAll('input')].filter((i) => i.type !== 'date' && /\d/.test(i.value));

  it('le simulateur Annuel ne laisse fuiter ni montant dans les justifications ni dans le champ', async () => {
    hide();
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await waitFor(() => expect(screen.queryByText('330 €')).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('region', { name: 'Simulateur' })).getByRole('button', { name: 'Annuel' }));
    expect(screen.getByRole('region', { name: 'Simulateur' }).textContent).toMatch(/Sous la cible de/);
    expect(document.body.textContent).not.toMatch(/\d\s?€/);
    const inputs = amountInputs();
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i.type).toBe('password');
  });

  it('la proposition masque les montants (champs et justifications)', async () => {
    hide();
    renderView(unvalidated({ proposal: proposal.map((l) => (l.assetId === 'hsbc' ? { ...l, reason: 'Sous la cible de 1 841 €' } : l)) }));
    await waitFor(() => expect(screen.queryByText(/900 €/)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/\d\s?€/);
    const inputs = amountInputs();
    expect(inputs.length).toBeGreaterThanOrEqual(proposal.length);
    for (const i of inputs) expect(i.type).toBe('password');
  });

  it('la feuille de déclaration masque le montant prérempli', async () => {
    hide();
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await waitFor(() => expect(screen.queryByText('330 €')).not.toBeInTheDocument());
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    expect(within(screen.getByRole('dialog')).getByLabelText(/Montant/)).toHaveAttribute('type', 'password');
  });

  it("affiche les montants des justifications dans la devise d'affichage", async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'MAD', hidden: false }));
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await waitFor(() => expect(screen.queryByText('330 €')).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('region', { name: 'Simulateur' })).getByRole('button', { name: 'Annuel' }));
    const text = screen.getByRole('region', { name: 'Simulateur' }).textContent ?? '';
    expect(text).toMatch(/Sous la cible de [\d ]+ MAD/);
    expect(text).not.toMatch(/Sous la cible de [\d ]+ €/);
  });
});

describe('EpargneView — feuille : devise de l’actif', () => {
  const madData = (): Dashboard => ({
    ...fixtureDashboard,
    assets: fixtureDashboard.assets.map((a) => (a.id === 'syla' ? { ...a, currency: 'MAD' as const } : a)),
  });

  it("préremplit et édite le montant dans la devise de l'actif (converti depuis l'€)", async () => {
    const user = userEvent.setup();
    renderView(madData());
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    const dialog = screen.getByRole('dialog');
    // 600 € × 10,85 = 6 510 MAD
    expect(within(dialog).getByLabelText('Montant (MAD)')).toHaveValue('6510');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(declarePurchase).toHaveBeenCalledTimes(1));
    expect(declarePurchase.mock.calls[0].slice(0, 3)).toEqual(['syla', '2026-11', 6510]);
  });

  it('garde le libellé en € pour un actif en euros', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Montant (€)')).toHaveValue('600');
  });
});

describe('EpargneView — feuille : focus', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    const trigger = within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ });
    await user.click(trigger);
    return trigger;
  };

  it("place le focus dans la feuille à l'ouverture", async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await open(user);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('rend le focus au bouton déclencheur après Annuler', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    const trigger = await open(user);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(trigger).toHaveFocus();
  });

  it('rend le focus au déclencheur après Échap (écouteur sur le document)', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    const trigger = await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Échap fonctionne même si le focus est sorti de la feuille', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await open(user);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rend le focus au déclencheur après le clic sur le fond', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    const trigger = await open(user);
    await user.click(document.querySelector('[data-backdrop]') as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('piège Tab et Maj+Tab dans la feuille', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await open(user);
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmer' });
    const first = within(dialog).getByLabelText(/Montant/);

    confirm.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});

describe('EpargneView — proposition : cas limites', () => {
  it('écarte les lignes à 0 du plan envoyé', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    const per = screen.getByLabelText(/Pertinence Retraite/);
    await user.clear(per);
    await user.type(per, '0');
    const hsbc = screen.getByLabelText(/HSBC/);
    await user.clear(hsbc);
    await user.type(hsbc, '600');
    await user.click(screen.getByRole('button', { name: 'Valider le plan' }));
    await waitFor(() => expect(validatePlan).toHaveBeenCalledTimes(1));
    const sent = validatePlan.mock.calls[0][1] as AllocationLine[];
    expect(sent.map((l) => l.assetId)).toEqual(['hsbc', 'or', 'syla']);
  });

  it('exige le total au centime près', async () => {
    const user = userEvent.setup();
    renderView(unvalidated());
    const per = screen.getByLabelText(/Pertinence Retraite/);
    await user.clear(per);
    await user.type(per, '100,5');
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeDisabled();
    expect(screen.getByText('Total ≠ 900 €')).toBeInTheDocument();
  });
});

describe('EpargneView — proposition non modifiée avec des centimes (I1)', () => {
  it.each([769.75, 900])('M = %s € : la proposition brute de allocate() est validable telle quelle', (m) => {
    const assets = fixtureDashboard.assets.map((a) => (a.id === 'per' && m === 900 ? { ...a, fixedMonthly: 100.5 } : a));
    const lines = allocate({ amount: m, assets, strategy: fixtureDashboard.strategy, ratio: fixtureDashboard.metals.ratio });
    renderView({
      ...unvalidated({ proposal: lines }), assets,
      budget: { ...fixtureDashboard.budget, investEur: m },
    });
    expect(screen.queryByText(/Total ≠/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeEnabled();
  });
});

describe('EpargneView — reliquats des mois précédents (I4)', () => {
  const carried = {
    assetId: 'syla', assetName: 'Syla Invest', plannedEur: 0, origin: 'cible' as const,
    reason: 'Reliquat des mois précédents', toInvestEur: 500, monthsAccrued: 0, status: 'pending' as const,
  };

  it('mois non validé : la proposition ET les reliquats déclarables sont affichés', async () => {
    const user = userEvent.setup();
    renderView(unvalidated({ lines: [carried], pendingEur: 500 }));
    expect(screen.getByRole('button', { name: 'Valider le plan' })).toBeInTheDocument();
    const row = rowOf(/Syla Invest/);
    expect(within(row).getByText('Reliquat des mois précédents')).toBeInTheDocument();
    expect(within(row).queryByText(/Prévu/)).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /Déclarer l'achat/ }));
    expect(within(screen.getByRole('dialog')).getByLabelText(/Montant/)).toHaveValue('500');
  });

  it('mois validé : la ligne de reliquat a son bouton « Déclarer l’achat »', () => {
    const data = { ...fixtureDashboard, plan: { ...fixtureDashboard.plan, lines: [...fixtureDashboard.plan.lines.filter((l) => l.assetId !== 'syla'), carried] } };
    renderView(data);
    const row = rowOf(/Syla Invest/);
    expect(within(row).getByText('Reliquat des mois précédents')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Déclarer l'achat/ })).toBeInTheDocument();
  });
});

describe('EpargneView — quantité pour un actif coté (I11)', () => {
  const pendingHsbc = (): Dashboard => ({
    ...fixtureDashboard,
    plan: {
      ...fixtureDashboard.plan,
      lines: fixtureDashboard.plan.lines.map((l) => (l.assetId === 'hsbc' ? { ...l, status: 'pending' as const, toInvestEur: 300 } : l)),
    },
  });

  it('actif auto : champ facultatif « Quantité (parts / tokens) » transmis à l’action', async () => {
    const user = userEvent.setup();
    renderView(pendingHsbc());
    await user.click(within(rowOf(/HSBC/)).getByRole('button', { name: /Déclarer l'achat/ }));
    const dialog = screen.getByRole('dialog');
    const qty = within(dialog).getByLabelText(/Quantité \(parts \/ tokens\)/);
    expect(within(dialog).getByText('Quantité à compléter dans Notion')).toBeInTheDocument();
    await user.type(qty, '8,13');
    expect(within(dialog).queryByText('Quantité à compléter dans Notion')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(declarePurchase).toHaveBeenCalledTimes(1));
    expect(declarePurchase.mock.calls[0][0]).toBe('hsbc');
    expect(declarePurchase.mock.calls[0][4]).toBe(8.13);
  });

  it('actif auto : quantité vide acceptée (à compléter dans Notion)', async () => {
    const user = userEvent.setup();
    renderView(pendingHsbc());
    await user.click(within(rowOf(/HSBC/)).getByRole('button', { name: /Déclarer l'achat/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(declarePurchase).toHaveBeenCalledTimes(1));
    expect(declarePurchase.mock.calls[0]).toHaveLength(4);
  });

  it('actif manuel : pas de champ quantité', async () => {
    const user = userEvent.setup();
    renderView(fixtureDashboard);
    await user.click(within(rowOf(/Syla/)).getByRole('button', { name: /Déclarer l'achat/ }));
    expect(within(screen.getByRole('dialog')).queryByLabelText(/Quantité/)).not.toBeInTheDocument();
  });
});

describe('MonthPill', () => {
  it('affiche le mois en français', () => {
    render(<MonthPill month="2026-11" />);
    expect(screen.getByText('Novembre 2026')).toBeInTheDocument();
  });
});
