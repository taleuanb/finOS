import { describe, expect, it } from 'vitest';
import type { Asset, FxRates, Movement, PlanLine } from './types';
import { estimatedSavingsBalance, monthStatus, monthsAccrued, reservedAndFree, toInvestByAsset } from './plan';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.1, GBP: 0.85 };

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, name: id, assetClass: 'Métaux précieux', currency: 'EUR', mode: 'manual',
  quantity: 0, costBasis: 0, archived: false, ...over,
});
const assets: Asset[] = [
  asset('or'),
  asset('ag'),
  asset('mad', { currency: 'MAD', assetClass: 'Autres' }),
  asset('epargne', { assetClass: 'Épargne' }),
];

const line = (month: string, assetId: string, amount: number): PlanLine => ({ month, assetId, amount, origin: 'cible' });
const buy = (id: string, date: string, assetId: string, amount: number, over: Partial<Movement> = {}): Movement => ({
  id, label: id, date, assetId, kind: 'buy', quantity: 1, amount, ...over,
});

const plan: PlanLine[] = [line('2026-10', 'or', 165), line('2026-11', 'or', 165)];

describe('toInvestByAsset', () => {
  it('cumule les montants prévus non déclarés', () => {
    expect(toInvestByAsset(plan, [], assets, fx, '2026-11').get('or')).toBe(330);
    expect(toInvestByAsset(plan, [], assets, fx, '2026-10').get('or')).toBe(165);
  });

  it('retire les achats déclarés', () => {
    const m = [buy('b1', '2026-11-12', 'or', 330)];
    expect(toInvestByAsset(plan, m, assets, fx, '2026-11').get('or')).toBe(0);
    expect(toInvestByAsset(plan, [buy('b', '2026-10-20', 'or', 100)], assets, fx, '2026-11').get('or')).toBe(230);
  });

  it('ne descend jamais sous 0 (trop-payé)', () => {
    const m = [buy('b1', '2026-11-12', 'or', 400)];
    expect(toInvestByAsset(plan, m, assets, fx, '2026-11').get('or')).toBe(0);
  });

  it('ignore un achat antérieur au premier mois du plan', () => {
    const m = [buy('b1', '2026-09-30', 'or', 330)];
    expect(toInvestByAsset(plan, m, assets, fx, '2026-11').get('or')).toBe(330);
  });

  it('ignore les achats postérieurs au mois demandé et les ventes', () => {
    const m = [
      buy('b1', '2026-12-01', 'or', 330),
      buy('b2', '2026-10-15', 'or', 100, { kind: 'sell' }),
      buy('b3', '2026-10-15', 'ag', 100),
    ];
    expect(toInvestByAsset(plan, m, assets, fx, '2026-11').get('or')).toBe(330);
  });

  it('compte un achat du dernier jour du mois', () => {
    const m = [buy('b1', '2026-11-30', 'or', 330)];
    expect(toInvestByAsset(plan, m, assets, fx, '2026-11').get('or')).toBe(0);
  });

  it("convertit en € un achat d'un actif MAD", () => {
    const p = [line('2026-10', 'mad', 1000)];
    const m = [buy('b1', '2026-10-05', 'mad', 10850)];
    expect(toInvestByAsset(p, m, assets, fx, '2026-10').get('mad')).toBeCloseTo(0, 6);
    const m2 = [buy('b1', '2026-10-05', 'mad', 5425)];
    expect(toInvestByAsset(p, m2, assets, fx, '2026-10').get('mad')).toBeCloseTo(500, 6);
  });

  it("n'inclut pas les actifs sans plan jusqu'au mois demandé", () => {
    expect(toInvestByAsset(plan, [], assets, fx, '2026-09').has('or')).toBe(false);
    expect(toInvestByAsset(plan, [], assets, fx, '2026-11').has('ag')).toBe(false);
  });

  it('traite chaque actif séparément', () => {
    const p = [...plan, line('2026-11', 'ag', 90)];
    const r = toInvestByAsset(p, [buy('b', '2026-11-02', 'ag', 40)], assets, fx, '2026-11');
    expect(r.get('or')).toBe(330);
    expect(r.get('ag')).toBe(50);
  });
});

describe('monthStatus', () => {
  it("est 'declared' quand les achats couvrent le cumul", () => {
    const m = [buy('b1', '2026-11-12', 'or', 330)];
    expect(monthStatus('or', '2026-11', plan, m, assets, fx)).toBe('declared');
  });
  it("est 'pending' sinon", () => {
    expect(monthStatus('or', '2026-11', plan, [], assets, fx)).toBe('pending');
    expect(monthStatus('or', '2026-11', plan, [buy('b', '2026-11-12', 'or', 200)], assets, fx)).toBe('pending');
  });
  it("est 'pending' pour un actif sans plan", () => {
    expect(monthStatus('ag', '2026-11', plan, [], assets, fx)).toBe('pending');
  });
  it('octobre déclaré mais novembre en attente', () => {
    const m = [buy('b1', '2026-10-12', 'or', 165)];
    expect(monthStatus('or', '2026-10', plan, m, assets, fx)).toBe('declared');
    expect(monthStatus('or', '2026-11', plan, m, assets, fx)).toBe('pending');
  });
});

describe('monthsAccrued', () => {
  it('arrondit le nombre de mois cumulés', () => {
    expect(monthsAccrued(330, 165)).toBe(2);
    expect(monthsAccrued(165, 165)).toBe(1);
    expect(monthsAccrued(0, 165)).toBe(0);
  });
  it('vaut 0 si rien de prévu ce mois', () => {
    expect(monthsAccrued(330, 0)).toBe(0);
    expect(monthsAccrued(330, -5)).toBe(0);
  });
});

describe('estimatedSavingsBalance', () => {
  const base = {
    manualValueEur: 14747, manualDate: '2026-10-10', monthlySavingsEur: 1770,
    movements: [] as Movement[], plan, assets, fx, today: '2026-12-05',
  };

  it("ajoute l'épargne à chaque 1er passé et retire les achats du plan", () => {
    const movements = [buy('b1', '2026-11-12', 'or', 500)];
    expect(estimatedSavingsBalance({ ...base, movements })).toBe(14747 + 3540 - 500);
  });

  it('ignore les achats antérieurs ou égaux à la saisie manuelle, et ceux hors plan', () => {
    const movements = [
      buy('b1', '2026-10-10', 'or', 100),
      buy('b2', '2026-10-01', 'or', 100),
      buy('b3', '2026-11-12', 'ag', 100),
    ];
    expect(estimatedSavingsBalance({ ...base, movements })).toBe(14747 + 3540);
  });

  it("ignore les achats postérieurs à aujourd'hui", () => {
    const movements = [buy('b1', '2026-12-06', 'or', 100)];
    expect(estimatedSavingsBalance({ ...base, movements })).toBe(14747 + 3540);
  });

  it('ne compte pas les ventes', () => {
    const movements = [buy('b1', '2026-11-12', 'or', 100, { kind: 'sell' })];
    expect(estimatedSavingsBalance({ ...base, movements })).toBe(14747 + 3540);
  });

  it('convertit les achats en €', () => {
    const p = [...plan, line('2026-11', 'mad', 1000)];
    const movements = [buy('b1', '2026-11-12', 'mad', 10850)];
    expect(estimatedSavingsBalance({ ...base, plan: p, movements })).toBeCloseTo(14747 + 3540 - 1000, 6);
  });

  it('compte le 1er le jour même, pas la saisie faite un 1er', () => {
    expect(estimatedSavingsBalance({ ...base, today: '2026-11-01' })).toBe(14747 + 1770);
    expect(estimatedSavingsBalance({ ...base, manualDate: '2026-11-01', today: '2026-11-01' })).toBe(14747);
    expect(estimatedSavingsBalance({ ...base, manualDate: '2026-11-01', today: '2026-12-01' })).toBe(14747 + 1770);
  });

  it('ne change rien le même mois que la saisie', () => {
    expect(estimatedSavingsBalance({ ...base, today: '2026-10-25' })).toBe(14747);
  });

  it("traverse le changement d'année", () => {
    expect(estimatedSavingsBalance({ ...base, manualDate: '2026-12-15', today: '2027-01-31' })).toBe(14747 + 1770);
    expect(estimatedSavingsBalance({ ...base, manualDate: '2026-12-15', today: '2027-02-01' })).toBe(14747 + 1770 * 2);
  });
});

describe('reservedAndFree', () => {
  it('sépare le réservé du libre', () => {
    expect(reservedAndFree(14747, new Map([['or', 330], ['ag', 270], ['st', 600]]))).toEqual({ reservedEur: 1200, freeEur: 13547 });
  });
  it('gère une map vide', () => {
    expect(reservedAndFree(1000, new Map())).toEqual({ reservedEur: 0, freeEur: 1000 });
  });
});

describe('toInvestByAsset — dérive du taux MAD (I2)', () => {
  // Prévu 165 € ; achat payé 1 790,25 MAD (= 165 € au taux 10,85). Le lendemain, le taux bouge.
  const madAsset = [asset('mad', { currency: 'MAD', assetClass: 'Autres' })];
  const madPlan = [line('2026-11', 'mad', 165)];
  const paid = [buy('b1', '2026-11-12', 'mad', 1790.25)];
  const drift: FxRates = { ...fx, MAD: 10.86 }; // 1 790,25 / 10,86 = 164,85 € → reste 0,15 €

  it('un reste de moins de 1 € compte comme 0 (Déclaré)', () => {
    expect(toInvestByAsset(madPlan, paid, madAsset, drift, '2026-11').get('mad')).toBe(0);
    expect(monthStatus('mad', '2026-11', madPlan, paid, madAsset, drift)).toBe('declared');
    expect(reservedAndFree(1000, toInvestByAsset(madPlan, paid, madAsset, drift, '2026-11')).reservedEur).toBe(0);
  });

  it('arrondit le reste au centime', () => {
    const half = [buy('b1', '2026-11-12', 'mad', 1000)];
    // 165 − 1000 / 10,86 = 72,9189… → 72,92
    expect(toInvestByAsset(madPlan, half, madAsset, drift, '2026-11').get('mad')).toBe(72.92);
  });

  it('un reste ≥ 1 € reste dû', () => {
    const almost = [buy('b1', '2026-11-12', 'mad', 1779.4)]; // ≈ 164 € au taux 10,85 → 1 € dû
    expect(toInvestByAsset(madPlan, almost, madAsset, fx, '2026-11').get('mad')).toBe(1);
  });
});
