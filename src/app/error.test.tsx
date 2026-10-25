import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorPage from './error';

afterEach(cleanup);

describe('error.tsx', () => {
  it('affiche un message en français et « Réessayer » appelle reset()', async () => {
    const reset = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorPage error={new Error('NOTION_TOKEN manquant')} reset={reset} />);
    expect(screen.getByRole('heading', { name: /Impossible d.afficher les données/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
