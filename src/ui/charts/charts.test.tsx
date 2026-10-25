import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FxRates } from '@/domain/types';
import { DEFAULT_METAL_GRID } from '@/domain/types';
import { DisplayProvider } from '../display';
import { AreaChart } from './AreaChart';
import { SankeyChart } from './SankeyChart';
import { StackedBars } from './StackedBars';
import { RatioChart } from './RatioChart';
import { Sparkline } from './Sparkline';
import { SplitBar } from './SplitBar';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.85 };
const SIZE = { width: 400, height: 200 };

const area = [
  { date: '2026-01-01', value: 100000 },
  { date: '2026-04-01', value: 120000 },
  { date: '2026-07-01', value: 150000 },
  { date: '2026-10-01', value: 170000 },
];
const sankey = {
  nodes: [{ name: 'Salaire' }, { name: 'Budget' }, { name: 'Loyer' }, { name: 'Épargne libre' }],
  links: [
    { source: 0, target: 1, value: 3000 },
    { source: 1, target: 2, value: 1200 },
    { source: 1, target: 3, value: 1800 },
  ],
};
const bars = [
  { label: 'Mai', parts: [{ key: 'saved', value: 800, color: '#F4B183' }, { key: 'invested', value: 500, color: '#EE8A3C' }] },
  { label: 'Juin', parts: [{ key: 'saved', value: 900, color: '#F4B183' }, { key: 'invested', value: 600, color: '#EE8A3C' }] },
];
const ratio = [
  { date: '2022-01-01', ratio: 78 },
  { date: '2024-01-01', ratio: 85 },
  { date: '2026-01-01', ratio: 62 },
];

function withDisplay(ui: ReactNode, hidden: boolean) {
  localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden }));
  return render(<DisplayProvider fx={fx}>{ui}</DisplayProvider>);
}

const everything = (
  <>
    <AreaChart data={area} {...SIZE} />
    <SankeyChart data={sankey} {...SIZE} />
    <StackedBars data={bars} {...SIZE} />
    <Sparkline values={[1, 3, 2, 5, 4]} {...SIZE} />
    <SplitBar parts={[{ value: 60, color: '#EE8A3C', label: 'Investi' }, { value: 40, color: '#F4B183', label: 'Libre' }]} />
  </>
);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('graphiques — montants masqués (Review Focus 5)', () => {
  it('n’affiche aucun chiffre : ni ticks, ni étiquettes, ni aria-label, ni infobulle', async () => {
    const { container, findAllByRole } = withDisplay(everything, true);
    await findAllByRole('img');
    for (const t of Array.from(container.querySelectorAll('svg text, svg tspan'))) {
      expect(t.textContent ?? '').not.toMatch(/\d/);
    }
    for (const el of Array.from(container.querySelectorAll('[aria-label], [aria-valuetext], title'))) {
      const v = el.getAttribute('aria-label') ?? el.getAttribute('aria-valuetext') ?? el.textContent ?? '';
      expect(v).not.toMatch(/\d/);
    }
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('libellé explicite quand masqué', async () => {
    const { findByLabelText } = withDisplay(<AreaChart data={area} {...SIZE} />, true);
    expect(await findByLabelText('Évolution du patrimoine (montants masqués)')).toBeTruthy();
  });
});

describe('graphiques — montants visibles', () => {
  it('AreaChart affiche des ticks chiffrés et une infobulle', async () => {
    const { container } = withDisplay(<AreaChart data={area} {...SIZE} />, false);
    const texts = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent ?? '');
    expect(texts.some((t) => /\d/.test(t))).toBe(true);
    expect(container.querySelector('.recharts-tooltip-wrapper')).not.toBeNull();
  });

  it('SankeyChart affiche les noms des nœuds', () => {
    const { container } = withDisplay(<SankeyChart data={sankey} {...SIZE} />, false);
    const texts = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(texts).toContain('Loyer');
    expect(texts).toContain('Épargne libre');
  });

  it('StackedBars rend une série par clé de part', () => {
    const { container } = withDisplay(<StackedBars data={bars} {...SIZE} />, false);
    expect(container.querySelectorAll('.recharts-bar').length).toBe(2);
  });

  it('RatioChart rend une bande par zone', () => {
    const { container } = withDisplay(<RatioChart data={ratio} grid={DEFAULT_METAL_GRID} {...SIZE} />, false);
    expect(container.querySelectorAll('.recharts-reference-area').length).toBe(DEFAULT_METAL_GRID.length);
  });

  it('SplitBar répartit les largeurs proportionnellement', () => {
    const { container } = withDisplay(
      <SplitBar parts={[{ value: 30, color: '#111', label: 'A' }, { value: 10, color: '#222', label: 'B' }]} />,
      false,
    );
    const segs = Array.from(container.querySelectorAll<HTMLElement>('[data-seg]'));
    expect(segs.map((s) => s.style.width)).toEqual(['75%', '25%']);
  });

  it('SplitBar : parts nulles ignorées, sans plantage', () => {
    const { container } = withDisplay(<SplitBar parts={[{ value: 0, color: '#111', label: 'A' }]} />, false);
    expect(container.querySelectorAll('[data-seg]').length).toBe(0);
  });

  it('Sparkline sans valeurs ne plante pas', () => {
    const { container } = withDisplay(<Sparkline values={[]} {...SIZE} />, false);
    expect(container).toBeTruthy();
  });
});
