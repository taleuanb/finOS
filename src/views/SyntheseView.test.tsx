import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayProvider } from '@/ui/display';
import { formatDisplayMoney } from '@/ui/Money';
import { fixtureDashboard } from '@/lib/fixtures';
import type { Dashboard } from '@/lib/dashboard';
import { EyeButton, SyntheseView } from './SyntheseView';

beforeAll(() => {
  // Recharts (ResponsiveContainer) a besoin de ResizeObserver, absent de jsdom.
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const contentRect = { width: 400, height: 150 } as DOMRectReadOnly;
      this.cb([{ target, contentRect } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function renderView(d: Dashboard = fixtureDashboard) {
  return render(
    <DisplayProvider fx={d.fx}>
      <EyeButton />
      <SyntheseView data={d} />
    </DisplayProvider>,
  );
}

const netText = formatDisplayMoney(fixtureDashboard.totals.netEur, {
  currency: 'EUR',
  hidden: false,
  fx: fixtureDashboard.fx,
});

const withVariations: Dashboard = {
  ...fixtureDashboard,
  variations: {
    '1M': { abs: 1000, pct: 0.0123 },
    YTD: { abs: 20000, pct: 0.0456 },
    '1A': { abs: 31710, pct: 0.081 },
    Tout: { abs: 99000, pct: 0.3 },
  },
};

describe('SyntheseView', () => {
  it('affiche le patrimoine net de la fixture', () => {
    renderView();
    expect(netText).toMatch(/€$/);
    expect(screen.getByLabelText('Patrimoine net')).toHaveTextContent(netText);
  });

  it('bascule en MAD : les montants sont suffixés « MAD »', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'MAD' }));
    const card = screen.getByLabelText('Patrimoine net');
    expect(card.textContent).toMatch(/\d MAD/);
    expect(card.textContent).not.toContain('€');
  });

  it('le bouton œil masque tous les montants, puis les réaffiche', async () => {
    const { container } = renderView();
    expect(container.textContent).toContain('€');
    await userEvent.click(screen.getByRole('button', { name: 'Masquer les montants' }));
    expect(container.textContent).not.toContain('€');
    // hors date et pourcentages, plus aucun nombre à 3 chiffres ou plus : aucun montant chiffré
    const rest = container.textContent!.replace(/\d+ oct\. \d{4}/, '').replace(/[\d,]+ %/g, '');
    expect(rest).not.toMatch(/\d{3,}/);
    expect(container.innerHTML).not.toMatch(/aria-label="[^"]*\d{3,}/);
    await userEvent.click(screen.getByRole('button', { name: 'Afficher les montants' }));
    expect(container.textContent).toContain(netText);
  });

  it('« 1A » change la variation affichée', async () => {
    renderView(withVariations);
    const card = screen.getByLabelText('Patrimoine net');
    expect(card).toHaveTextContent('30,00 %'); // Tout par défaut
    await userEvent.click(screen.getByRole('button', { name: '1A' }));
    expect(card).toHaveTextContent('8,10 %');
    expect(card).not.toHaveTextContent('30,00 %');
    expect(screen.getByRole('button', { name: '1A' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('affiche « — » quand la variation de la période est nulle', async () => {
    renderView({ ...withVariations, variations: { ...withVariations.variations, '1M': null } });
    await userEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(screen.getByLabelText('Patrimoine net')).toHaveTextContent('—');
  });

  it('la carte Plan de novembre pointe vers /epargne', () => {
    renderView();
    const link = screen.getByRole('link', { name: /plan d'épargne de novembre/i });
    expect(link).toHaveAttribute('href', '/epargne');
    expect(within(link).getByText('Plan de novembre')).toBeInTheDocument();
  });

  it('liste la répartition par classe et les meilleures performances', () => {
    renderView();
    const rep = screen.getByLabelText('Répartition');
    expect(within(rep).getByText(fixtureDashboard.byClass[0].assetClass)).toBeInTheDocument();
    const perf = screen.getByLabelText('Ma performance');
    expect(within(perf).getByText(fixtureDashboard.topPerformers[0].name)).toBeInTheDocument();
    expect(within(perf).getAllByRole('listitem')).toHaveLength(fixtureDashboard.topPerformers.length);
  });

  it('affiche le bandeau de données anciennes quand stale', () => {
    renderView({ ...fixtureDashboard, stale: true });
    expect(screen.getByRole('status')).toHaveTextContent('Données du 25 octobre 2026');
  });
});
