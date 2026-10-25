import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayProvider, useDisplay } from './display';
import { Money } from './Money';
import type { FxRates } from '@/domain/types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.85 };

function Controls() {
  const { currency, hidden, setCurrency, toggleHidden } = useDisplay();
  return (
    <div>
      <span data-testid="state">{`${currency}|${hidden}`}</span>
      <button onClick={() => setCurrency('MAD')}>mad</button>
      <button onClick={toggleHidden}>hide</button>
    </div>
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Money', () => {
  it('affiche en EUR par défaut', () => {
    render(
      <DisplayProvider fx={fx}>
        <Money eur={110599.08} />
      </DisplayProvider>,
    );
    expect(screen.getByText('110 599 €')).toBeTruthy();
  });

  it('convertit en MAD', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'MAD', hidden: false }));
    render(
      <DisplayProvider fx={{ ...fx, MAD: 10 }}>
        <Money eur={120000} />
      </DisplayProvider>,
    );
    expect(await screen.findByText('1 200 000 MAD')).toBeTruthy();
  });

  it('masque les montants', async () => {
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'EUR', hidden: true }));
    render(
      <DisplayProvider fx={fx}>
        <Money eur={5000} signed />
      </DisplayProvider>,
    );
    expect(await screen.findByText('•••••••')).toBeTruthy();
    expect(screen.queryByText(/5/)).toBeNull();
  });

  it('signed ajoute « + » ou « − »', () => {
    render(
      <DisplayProvider fx={fx}>
        <Money eur={1234} signed />
        <Money eur={-50} signed />
      </DisplayProvider>,
    );
    expect(screen.getByText('+ 1 234 €')).toBeTruthy();
    expect(screen.getByText('− 50 €')).toBeTruthy();
  });

  it('persiste les préférences dans localStorage[wos.display]', async () => {
    const user = userEvent.setup();
    render(
      <DisplayProvider fx={fx}>
        <Controls />
      </DisplayProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('EUR|false');
    await user.click(screen.getByText('mad'));
    await user.click(screen.getByText('hide'));
    expect(screen.getByTestId('state').textContent).toBe('MAD|true');
    expect(JSON.parse(localStorage.getItem('wos.display')!)).toEqual({ currency: 'MAD', hidden: true });
  });

  it('relit les préférences au montage et ignore un stockage corrompu', async () => {
    localStorage.setItem('wos.display', '{pas du json');
    render(
      <DisplayProvider fx={fx}>
        <Controls />
      </DisplayProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('EUR|false');
    cleanup();
    localStorage.setItem('wos.display', JSON.stringify({ currency: 'MAD', hidden: true }));
    render(
      <DisplayProvider fx={fx}>
        <Controls />
      </DisplayProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('state').textContent).toBe('MAD|true');
  });
});
