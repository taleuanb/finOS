import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DisplayProvider } from '@/ui/display';
import { fixtureDashboard } from '@/lib/fixtures';
import type { Dashboard } from '@/lib/dashboard';
import { MetauxView } from './MetauxView';

function view(data: Dashboard) {
  return render(
    <DisplayProvider fx={data.fx}>
      <MetauxView data={data} />
    </DisplayProvider>,
  );
}
const withMetals = (patch: Partial<Dashboard['metals']>): Dashboard => ({
  ...fixtureDashboard,
  metals: { ...fixtureDashboard.metals, ...patch },
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('MetauxView', () => {
  it('affiche le ratio 64,5 et la zone Neutre', () => {
    view(fixtureDashboard);
    expect(screen.getByText('64,5')).toBeTruthy();
    expect(screen.getByText('Neutre')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ratio 64,5, zone Neutre' })).toBeTruthy();
  });

  it('I10 : avertit quand la grille or/argent de la Stratégie est incomplète', () => {
    view(withMetals({ gridWarning: '⚠ Grille or/argent incomplète dans la Stratégie (zone illisible : Bizarre)' }));
    expect(screen.getByRole('alert')).toHaveTextContent('⚠ Grille or/argent incomplète dans la Stratégie');
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Corriger la grille dans Stratégie' })).toHaveAttribute('href', '/strategie');
  });

  it('sans avertissement de grille : pas d’alerte', () => {
    view(fixtureDashboard);
    expect(screen.queryByText(/Grille or\/argent incomplète/)).toBeNull();
  });

  it('dessine la grille proportionnelle aux zones avec un repère à la position du ratio', () => {
    view(fixtureDashboard);
    const bar = screen.getByRole('img', { name: 'Ratio 64,5, zone Neutre' });
    const widths = [...bar.querySelectorAll<HTMLElement>('[data-seg]')].map((s) => s.style.width);
    expect(widths).toEqual(['45%', '5%', '15%', '15%', '20%']);
    expect(bar.querySelector<HTMLElement>('[data-marker]')!.style.left).toBe('64.51%');
  });

  it('borne le repère à 0–100 %', () => {
    const m = fixtureDashboard.metals;
    view(withMetals({ ratio: 130, zone: m.zone }));
    expect(screen.getByRole('img', { name: /^Ratio 130,0/ }).querySelector<HTMLElement>('[data-marker]')!.style.left).toBe('100%');
  });

  it('affiche la prime 3,27 % sur 20 Francs Suisse', () => {
    view(fixtureDashboard);
    const row = screen.getByText('20 Francs Suisse').closest('li')!;
    expect(within(row).getByText('3,27 %')).toBeTruthy();
    expect(row.textContent).toContain('Pièce · 19/03/2025 · 6,45 g');
  });

  it('signale le poids fin manquant et un « — » à la place de la prime', () => {
    view(fixtureDashboard);
    const row = screen.getByText('Collier').closest('li')!;
    expect(within(row).getByText('Poids fin manquant')).toBeTruthy();
    expect(row.textContent).toContain('prime —');
  });

  it('met en avertissement une prime supérieure à 15 %', () => {
    const base = fixtureDashboard.metals.purchases.find((p) => p.metal === 'silver')!;
    const purchases = [{ ...base, movementId: 'x', label: 'Lingot cher', premium: 0.2874 }, ...fixtureDashboard.metals.purchases];
    view(withMetals({ purchases }));
    const high = within(screen.getByText('Lingot cher').closest('li')!).getByText('28,74 %');
    const low = within(screen.getByText('20 Francs Suisse').closest('li')!).getByText('3,27 %');
    expect(high.className).toContain('text-[#9A4A0E]');
    expect(low.className).not.toContain('text-[#9A4A0E]');
  });

  it("affiche l'alerte de réajustement", () => {
    view(withMetals({ alert: true }));
    expect(screen.getByText('Réajustement conseillé : ratio hors zone neutre depuis 14 jours')).toBeTruthy();
  });

  it("n'affiche pas l'alerte sans alert", () => {
    view(fixtureDashboard);
    expect(screen.queryByText(/Réajustement conseillé/)).toBeNull();
  });

  it('affiche un état vide sans or, sans planter', () => {
    view(withMetals({ gold: null, purchases: fixtureDashboard.metals.purchases.filter((p) => p.metal === 'silver') }));
    expect(screen.getByText("Aucun achat d'or")).toBeTruthy();
    expect(screen.getByText('Argent physique')).toBeTruthy();
  });

  it('survit sans aucun métal ni ratio', () => {
    view(withMetals({ gold: null, silver: null, ratio: null, zone: null, purchases: [], ratioHistory: [], monthSplit: { goldEur: 0, silverEur: 0 } }));
    expect(screen.getByText("Aucun achat d'or")).toBeTruthy();
    expect(screen.getByText("Aucun achat d'argent")).toBeTruthy();
  });

  it("répartit le mois et lie vers /epargne avec le montant en attente (or + argent)", () => {
    view(fixtureDashboard);
    expect(screen.getByText('165 €')).toBeTruthy();
    expect(screen.getByText('135 €')).toBeTruthy();
    const link = screen.getByRole('link', { name: /en attente d'achat/ });
    expect(link.getAttribute('href')).toBe('/epargne');
    expect(link.textContent).toContain('600 €');
  });

  it("masque le lien quand rien n'est en attente", () => {
    const data: Dashboard = {
      ...fixtureDashboard,
      plan: { ...fixtureDashboard.plan, lines: fixtureDashboard.plan.lines.map((l) => ({ ...l, toInvestEur: 0 })) },
    };
    view(data);
    expect(screen.queryByRole('link', { name: /en attente d'achat/ })).toBeNull();
  });

  it('affiche les cours en €/kg', () => {
    view(fixtureDashboard);
    expect(screen.getByText('125 926 € / kg')).toBeTruthy();
    expect(screen.getByText('1 952 € / kg')).toBeTruthy();
  });

  it('affiche la bannière de données anciennes', () => {
    view({ ...fixtureDashboard, stale: true, lastSyncOk: '2026-10-20T05:00:00Z' });
    expect(screen.getByText('Données du 20 octobre 2026')).toBeTruthy(); // M2 : format commun
  });

  it('date la bannière de données anciennes à Paris (23:30 UTC le 31/10 = 01/11)', () => {
    view({ ...fixtureDashboard, stale: true, lastSyncOk: '2026-10-31T23:30:00Z' });
    expect(screen.getByText('Données du 1 novembre 2026')).toBeTruthy();
  });

  it('retombe sur asOf si lastSyncOk est absent ou invalide', () => {
    view({ ...fixtureDashboard, stale: true, lastSyncOk: 'pas une date', asOf: '2026-10-25' });
    expect(screen.getByText('Données du 25 octobre 2026')).toBeTruthy();
  });

  it('une prime négative ou faible n\'est pas en vert', () => {
    const base = fixtureDashboard.metals.purchases.find((p) => p.fineGrams > 0)!;
    view(withMetals({ purchases: [{ ...base, movementId: 'neg', label: 'Achat sous spot', premium: -0.02 }] }));
    const el = within(screen.getByText('Achat sous spot').closest('li')!).getByText('−2,00 %');
    expect(el.className).not.toContain('text-gain');
  });

  it('masque les montants et les poids détenus en mode masqué mais pas les cours', () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    const { container } = view(fixtureDashboard);
    expect(screen.getByText('125 926 € / kg')).toBeTruthy();
    const text = (container.textContent ?? '').replace('Lingot 500 g', 'Lingot'); // le libellé saisi n'est pas un poids affiché
    expect(text).not.toMatch(/\d+(,\d+)? g\b/);
    for (const eur of ['165 €', '135 €', '547 €', '555 €', '600 €', '4 294 €']) expect(text).not.toContain(eur);
    const m = fixtureDashboard.metals;
    expect(text).not.toContain(Math.round(m.gold!.valueEur + m.silver!.valueEur).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' '));
    expect(text).not.toContain(Math.round(m.gold!.costEur).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ') + ' €');
  });

  it('affiche les poids en mode normal', () => {
    view(fixtureDashboard);
    expect(screen.getByText('Pièce · 19/03/2025 · 6,45 g')).toBeTruthy();
  });
});
