import { describe, expect, it } from 'vitest';
import { fixtureSeed } from '@/notion/fakeRepo';
import type { BudgetLine, FxRates } from './types';
import { budgetSankey, summarizeBudget } from './budget';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84 };

const line = (id: string, section: BudgetLine['section'], category: string, monthlyAmount: number, currency: BudgetLine['currency'] = 'EUR'): BudgetLine =>
  ({ id, name: id, section, category, monthlyAmount, currency, order: 0 });

describe('summarizeBudget', () => {
  it('calcule le budget type de la maquette', () => {
    const s = summarizeBudget(fixtureSeed.budget, fx, 900);
    expect(s.incomeEur).toBeCloseTo(3614.75, 2);
    expect(s.expensesEur).toBe(1845);
    expect(s.savingsEur).toBeCloseTo(1769.75, 2);
    expect(s.savingsRate).toBeCloseTo(0.4896, 4);
    expect(s.investEur).toBe(900);
    expect(s.freeEur).toBeCloseTo(869.75, 2);
  });

  it("regroupe par catégorie dans l'ordre d'apparition", () => {
    const s = summarizeBudget(fixtureSeed.budget, fx, 900);
    const dep = s.byCategory.filter((c) => c.section === 'depense');
    expect(dep.map((c) => c.category)).toEqual(['Logement', 'Vie quotidienne', 'Abonnements', 'Dons & famille']);
    expect(dep.map((c) => c.totalEur)).toEqual([1050, 620, 75, 100]);
    const rev = s.byCategory.filter((c) => c.section === 'revenu');
    expect(rev.map((c) => c.category)).toEqual(['Activité', 'Revenus locatifs']);
    expect(rev[1].totalEur).toBeCloseTo(4500 / 10.85, 6);
  });

  it('dépenses > revenus : épargne négative, rien investi, épargne libre = épargne', () => {
    const lines = [line('r', 'revenu', 'A', 1000), line('d', 'depense', 'B', 1500)];
    const s = summarizeBudget(lines, fx, 900);
    expect(s.savingsEur).toBe(-500);
    expect(s.savingsRate).toBeCloseTo(-0.5, 6);
    expect(s.investEur).toBe(0);
    expect(s.freeEur).toBe(-500);
  });

  it("plafonne le montant investi à l'épargne", () => {
    const lines = [line('r', 'revenu', 'A', 1000), line('d', 'depense', 'B', 700)];
    const s = summarizeBudget(lines, fx, 900);
    expect(s.investEur).toBe(300);
    expect(s.freeEur).toBe(0);
  });

  it("sans revenu : taux d'épargne 0 (pas de division par zéro)", () => {
    const s = summarizeBudget([line('d', 'depense', 'B', 100)], fx, 50);
    expect(s.savingsRate).toBe(0);
    expect(s.investEur).toBe(0);
  });

  it('convertit les devises en EUR', () => {
    const s = summarizeBudget([line('r', 'revenu', 'A', 1085, 'MAD'), line('d', 'depense', 'B', 108, 'USD')], fx, 0);
    expect(s.incomeEur).toBeCloseTo(100, 6);
    expect(s.expensesEur).toBeCloseTo(100, 6);
  });
});

describe('budgetSankey', () => {
  const s = summarizeBudget(fixtureSeed.budget, fx, 900);
  const k = budgetSankey(fixtureSeed.budget, s, fx);
  const idx = (name: string) => k.nodes.findIndex((n) => n.name === name);

  it("liste les nœuds dans l'ordre attendu", () => {
    expect(k.nodes.map((n) => n.name)).toEqual([
      'Salaire', 'Loyer LCD Kesh', 'Budget', 'Investissements',
      'Logement', 'Vie quotidienne', 'Abonnements', 'Dons & famille', 'Épargne libre',
    ]);
  });

  it('Σ des liens sortant de Budget = revenus ; Σ entrant = revenus', () => {
    const b = idx('Budget');
    const out = k.links.filter((l) => l.source === b).reduce((a, l) => a + l.value, 0);
    const inn = k.links.filter((l) => l.target === b).reduce((a, l) => a + l.value, 0);
    expect(out).toBeCloseTo(s.incomeEur, 6);
    expect(inn).toBeCloseTo(s.incomeEur, 6);
  });

  it('relie revenus → Budget → destinations avec les bons montants', () => {
    const b = idx('Budget');
    const val = (src: number, tgt: number) => k.links.find((l) => l.source === src && l.target === tgt)?.value;
    expect(val(idx('Salaire'), b)).toBe(3200);
    expect(val(idx('Loyer LCD Kesh'), b)).toBeCloseTo(4500 / 10.85, 6);
    expect(val(b, idx('Investissements'))).toBe(900);
    expect(val(b, idx('Logement'))).toBe(1050);
    expect(val(b, idx('Épargne libre'))).toBeCloseTo(869.75, 2);
  });

  it('aucun lien de valeur ≤ 0 ; omet Investissements et Épargne libre à 0', () => {
    expect(k.links.every((l) => l.value > 0)).toBe(true);
    const lines = [line('r', 'revenu', 'A', 1000), line('d', 'depense', 'B', 1500)];
    const s2 = summarizeBudget(lines, fx, 900);
    const k2 = budgetSankey(lines, s2, fx);
    expect(k2.links.every((l) => l.value > 0)).toBe(true);
    const names = (i: number) => k2.nodes[i].name;
    expect(k2.links.some((l) => names(l.target) === 'Investissements' || names(l.target) === 'Épargne libre')).toBe(false);
  });
});
