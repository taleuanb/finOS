import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let pathname = '/budget';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { BottomNav } from './BottomNav';

afterEach(cleanup);

describe('BottomNav', () => {
  it('marque « Budget » comme page courante sur /budget', () => {
    pathname = '/budget';
    render(<BottomNav />);
    expect(screen.getByRole('link', { name: 'Budget' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Métaux' }).getAttribute('aria-current')).toBeNull();
  });

  it('pointe vers les 5 routes', () => {
    pathname = '/budget';
    render(<BottomNav />);
    const links = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Synthèse', '/'],
      ['Patrimoine', '/patrimoine'],
      ['Budget', '/budget'],
      ['Épargne', '/epargne'],
      ['Métaux', '/metaux'],
    ]);
  });

  it('« Synthèse » n’est active que sur /, et les sous-routes activent leur onglet', () => {
    pathname = '/';
    const { unmount } = render(<BottomNav />);
    expect(screen.getByRole('link', { name: 'Synthèse' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Budget' }).getAttribute('aria-current')).toBeNull();
    unmount();
    pathname = '/patrimoine/abc';
    render(<BottomNav />);
    expect(screen.getByRole('link', { name: 'Patrimoine' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Synthèse' }).getAttribute('aria-current')).toBeNull();
  });
});
