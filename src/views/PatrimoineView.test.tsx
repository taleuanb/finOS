import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayProvider } from '@/ui/display';
import { fixtureDashboard } from '@/lib/fixtures';
import type { Dashboard } from '@/lib/dashboard';
import { AddAssetLink, PatrimoineView } from './PatrimoineView';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function setup(data: Dashboard = fixtureDashboard) {
  return render(
    <DisplayProvider fx={data.fx}>
      <PatrimoineView data={data} />
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

  it('pas de bandeau quand les données sont fraîches', () => {
    setup();
    expect(screen.queryByText(/Données du/)).toBeNull();
  });
});

describe('AddAssetLink', () => {
  it('ouvre la base Notion dans un nouvel onglet', () => {
    render(<AddAssetLink href="https://www.notion.so/assets" />);
    const link = screen.getByRole('link', { name: /Ajouter/ });
    expect(link).toHaveAttribute('href', 'https://www.notion.so/assets');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
