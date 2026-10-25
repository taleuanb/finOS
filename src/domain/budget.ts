import { toEur } from './money';
import type { BudgetLine, BudgetSummary, FxRates } from './types';

/** Spec §5.3 : épargne = revenus − dépenses ; investi = paramètre plafonné à l'épargne ; libre = le reste. */
export function summarizeBudget(lines: BudgetLine[], fx: FxRates, monthlyInvest: number): BudgetSummary {
  let incomeEur = 0;
  let expensesEur = 0;
  const groups = new Map<string, BudgetSummary['byCategory'][number]>();

  for (const l of lines) {
    const eur = toEur(l.monthlyAmount, l.currency, fx);
    if (l.section === 'revenu') incomeEur += eur;
    else expensesEur += eur;
    const key = `${l.section}\u0000${l.category}`;
    const g = groups.get(key);
    if (g) g.totalEur += eur;
    else groups.set(key, { category: l.category, section: l.section, totalEur: eur });
  }

  const savingsEur = incomeEur - expensesEur;
  const savingsRate = incomeEur > 0 ? savingsEur / incomeEur : 0;
  const investEur = Math.max(0, Math.min(monthlyInvest, savingsEur));
  const freeEur = savingsEur - investEur;

  return {
    incomeEur, expensesEur, savingsEur, savingsRate, investEur, freeEur,
    byCategory: [...groups.values()],
  };
}

export interface SankeyData {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}

/** Revenus → Budget → (Investissements, catégories de dépense, Épargne libre), format Recharts. */
export function budgetSankey(lines: BudgetLine[], s: BudgetSummary, fx: FxRates): SankeyData {
  const nodes: SankeyData['nodes'] = [];
  const links: SankeyData['links'] = [];
  const add = (name: string) => nodes.push({ name }) - 1;
  const link = (source: number, target: number, value: number) => {
    if (value > 0) links.push({ source, target, value });
  };

  const revenues = lines
    .filter((l) => l.section === 'revenu')
    .map((l) => ({ node: add(l.name), eur: toEur(l.monthlyAmount, l.currency, fx) }));
  const budget = add('Budget');
  const invest = add('Investissements');
  const expenses = s.byCategory
    .filter((c) => c.section === 'depense')
    .map((c) => ({ node: add(c.category), eur: c.totalEur }));
  const free = add('Épargne libre');

  for (const r of revenues) link(r.node, budget, r.eur);
  link(budget, invest, s.investEur);
  for (const e of expenses) link(budget, e.node, e.eur);
  link(budget, free, s.freeEur);

  return { nodes, links };
}
