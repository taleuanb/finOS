import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Vérifie que l'environnement jsdom et les matchers jest-dom sont en place pour les tests *.test.tsx.
describe('environnement de test des composants', () => {
  it('rend un composant dans jsdom', () => {
    render(<p>Wealth OS</p>);
    expect(screen.getByText('Wealth OS')).toBeInTheDocument();
    expect(typeof window).toBe('object');
  });
});
