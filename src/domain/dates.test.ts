import { describe, expect, it } from 'vitest';
import { monthsBetween, parisDate, parisMonth } from './dates';

describe('dates', () => {
  it('parisDate passe au jour suivant après minuit à Paris (heure d’hiver)', () => {
    expect(parisDate(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });
  it('parisMonth suit le mois de Paris', () => {
    expect(parisMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });
  it('parisDate tient compte de l’heure d’été', () => {
    expect(parisDate(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
    expect(parisDate(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
  it('monthsBetween est inclusif et croissant, à cheval sur deux années', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-10', '2026-10')).toEqual(['2026-10']);
    expect(monthsBetween('2026-11', '2026-10')).toEqual([]);
  });
});
