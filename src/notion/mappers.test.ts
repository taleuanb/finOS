import { describe, expect, it } from 'vitest';
import assetEtf from './__fixtures__/asset-etf.json';
import assetManual from './__fixtures__/asset-manual-no-currency.json';
import movement from './__fixtures__/movement.json';
import debt from './__fixtures__/debt.json';
import budgetLine from './__fixtures__/budget-line.json';
import strategyRows from './__fixtures__/strategy-rows.json';
import planLine from './__fixtures__/plan-line.json';
import snapshot from './__fixtures__/snapshot.json';
import {
  assetToProperties, budgetLineToProperties, debtToProperties, movementToProperties, pageToAsset,
  pageToBudgetLine, pageToDebt, pageToMovement, pageToPlanLine, pageToSnapshot, planLineToProperties,
  rowsToStrategy, snapshotToProperties, strategyToRows, valuationToProperties, type NotionPage,
} from './mappers';
import { ASSET_CLASSES } from '@/domain/types';

const pg = (x: unknown) => x as NotionPage;
/** Convertit un corps d'écriture Notion en forme lue (comme si Notion renvoyait ce qu'on a écrit). */
function asProps(written: unknown): NotionPage['properties'] {
  const out: NotionPage['properties'] = {};
  for (const [name, raw] of Object.entries(written as Record<string, Record<string, unknown>>)) {
    if ('title' in raw) out[name] = { type: 'title', title: (raw.title as { text: { content: string } }[]).map((t) => ({ plain_text: t.text.content })) };
    else if ('rich_text' in raw) out[name] = { type: 'rich_text', rich_text: (raw.rich_text as { text: { content: string } }[]).map((t) => ({ plain_text: t.text.content })) };
    else out[name] = { type: Object.keys(raw)[0], ...raw } as NotionPage['properties'][string];
  }
  return out;
}

describe('pageToAsset', () => {
  it('lit classe, devise, mode, rollups et Archivé', () => {
    const a = pageToAsset(pg(assetEtf));
    expect(a).toMatchObject({
      id: 'a1111111-0000-4000-8000-000000000001', name: 'iShares Core S&P 500', assetClass: 'Fonds & ETF',
      subtype: 'ETF', institution: 'Revolut', currency: 'USD', mode: 'auto', quoteId: 'CSPX.L',
      quantity: 12.5, costBasis: 7450.25, unitPrice: 615.4, value: 7692.5, valueEur: 7123.61,
      syncStatus: 'OK', lastUpdate: '2026-10-24', archived: false,
    });
    expect(a.manualValue).toBeUndefined();
    expect(a.fixedMonthly).toBeUndefined();
  });

  it('lit une valorisation manuelle archivée', () => {
    const a = pageToAsset(pg(assetManual));
    expect(a).toMatchObject({
      mode: 'manual', manualValue: 1600000, manualValueDate: '2026-06-30', fixedMonthly: 100,
      archived: true, quantity: 0, costBasis: 0, assetClass: 'Immobilier',
    });
    expect(a.quoteId).toBeUndefined();
  });

  it("sans devise : EUR et statut '⚠ devise manquante'", () => {
    const a = pageToAsset(pg(assetManual));
    expect(a.currency).toBe('EUR');
    expect(a.syncStatus).toBe('⚠ devise manquante');
  });

  it("ne garde que la partie date d'une date avec heure", () => {
    const p = structuredClone(assetEtf) as unknown as NotionPage;
    (p.properties['Dernière MAJ'] as unknown as { date: { start: string } }).date.start = '2026-10-24T05:00:00.000+02:00';
    expect(pageToAsset(p).lastUpdate).toBe('2026-10-24');
  });
});

describe('autres pages', () => {
  it('pageToMovement', () => {
    expect(pageToMovement(pg(movement))).toEqual({
      id: 'm1111111-0000-4000-8000-000000000002', label: '20 Francs Suisse', date: '2026-03-14',
      assetId: 'a1111111-0000-4000-8000-000000000009', kind: 'buy', nature: 'Pièce', quantity: 5.806,
      amount: 612.5, spotEurPerKg: 88450, planMonth: '2026-03',
    });
  });
  it('pageToMovement : vente', () => {
    const p = structuredClone(movement) as unknown as NotionPage;
    (p.properties['Type'] as unknown as { select: { name: string } }).select.name = 'Vente/retrait';
    expect(pageToMovement(p).kind).toBe('sell');
  });
  it('pageToDebt', () => {
    expect(pageToDebt(pg(debt))).toEqual({
      id: 'd1111111-0000-4000-8000-000000000001', name: 'Prêt immobilier', type: 'Prêt immobilier', currency: 'EUR',
      outstanding: 182500, rate: 0.0245, monthly: 1120, endDate: '2041-05-01',
      financedAssetId: 'a1111111-0000-4000-8000-000000000003', valueEur: 182500,
    });
  });
  it('pageToBudgetLine', () => {
    expect(pageToBudgetLine(pg(budgetLine))).toEqual({
      id: 'b1111111-0000-4000-8000-000000000001', name: 'Loyer', section: 'depense', category: 'Logement',
      monthlyAmount: 850, currency: 'EUR', order: 2,
    });
  });
  it('pageToPlanLine', () => {
    expect(pageToPlanLine(pg(planLine))).toEqual({
      id: 'p1111111-0000-4000-8000-000000000001', month: '2026-11',
      assetId: 'a1111111-0000-4000-8000-000000000001', amount: 405, origin: 'signal',
    });
  });
  it('pageToSnapshot : un nombre par classe', () => {
    const s = pageToSnapshot(pg(snapshot));
    expect(s).toMatchObject({
      date: '2026-10-24', totalAssetsEur: 586200, totalDebtsEur: 182500, netEur: 403700,
      goldSilverRatio: 62.4, eurMad: 10.85, eurUsd: 1.08, partial: true,
    });
    expect(Object.keys(s.byClass).sort()).toEqual([...ASSET_CLASSES].sort());
    expect(s.byClass['Métaux précieux']).toBe(18000);
    expect(s.byClass['Fonds & ETF']).toBe(41000);
  });
});

describe('rowsToStrategy', () => {
  const s = rowsToStrategy(strategyRows.map(pg));
  it('cible:Crypto = 10 → 0.10 et actif principal', () => {
    expect(s.targets.Crypto).toBe(0.1);
    expect(s.targets['Fonds & ETF']).toBe(0.45);
    expect(s.mainAssetByClass.Crypto).toBe('a1111111-0000-4000-8000-000000000004');
  });
  it('actifs or/argent/épargne, investissement mensuel, devise', () => {
    expect(s.goldAssetId).toBe('a1111111-0000-4000-8000-000000000009');
    expect(s.silverAssetId).toBe('a1111111-0000-4000-8000-000000000010');
    expect(s.savingsAssetId).toBe('a1111111-0000-4000-8000-000000000011');
    expect(s.monthlyInvest).toBe(900);
    expect(s.displayCurrency).toBe('MAD');
  });
  it('zones : « 50-65 » avec 55 → Neutre 0.55 ; « 80- » → Infinity ; tri par borne basse', () => {
    expect(s.metalGrid).toEqual([
      { label: 'Neutre', min: 50, max: 65, goldShare: 0.55 },
      { label: 'Penche argent', min: 65, max: 80, goldShare: 0.4 },
      { label: 'Argent bon marché', min: 80, max: Infinity, goldShare: 0.2 },
    ]);
  });
  it('ignore une clé inconnue, une classe inconnue et une zone illisible', () => {
    const extra = [
      ...strategyRows.map(pg),
      pg({ id: 'x1', properties: { 'Clé': { type: 'title', title: [{ plain_text: 'cible:Licornes' }] }, 'Valeur': { type: 'number', number: 5 } } }),
      pg({ id: 'x2', properties: { 'Clé': { type: 'title', title: [{ plain_text: 'zone:Bizarre' }] }, 'Valeur': { type: 'number', number: 5 }, 'Texte': { type: 'rich_text', rich_text: [{ plain_text: 'abc' }] } } }),
    ];
    const r = rowsToStrategy(extra);
    expect(Object.keys(r.targets).sort()).toEqual(['Crypto', 'Fonds & ETF']);
    expect(r.metalGrid).toHaveLength(3);
  });
  it('I10 : bornes de zone avec tiret, demi-cadratin ou cadratin ; zone illisible signalée', () => {
    const zone = (id: string, label: string, share: number | null, text: string) => pg({
      id, properties: {
        'Clé': { type: 'title', title: [{ plain_text: `zone:${label}` }] },
        'Valeur': { type: 'number', number: share },
        'Texte': { type: 'rich_text', rich_text: [{ plain_text: text }] },
      },
    });
    const r = rowsToStrategy([
      zone('z1', 'Or', 80, '0–50'), zone('z2', 'Neutre', 55, '50 — 65'), zone('z3', 'Argent', 20, '65-'),
      zone('z4', 'Bizarre', 5, 'abc'), zone('z5', 'Sans part', null, '10-20'),
    ]);
    expect(r.metalGrid).toEqual([
      { label: 'Or', min: 0, max: 50, goldShare: 0.8 },
      { label: 'Neutre', min: 50, max: 65, goldShare: 0.55 },
      { label: 'Argent', min: 65, max: Infinity, goldShare: 0.2 },
    ]);
    expect(r.gridWarnings).toEqual(['Bizarre', 'Sans part']);
    expect(rowsToStrategy(strategyRows.map(pg)).gridWarnings).toBeUndefined();
  });
  it('sans ligne : valeurs par défaut', () => {
    const r = rowsToStrategy([]);
    expect(r).toMatchObject({ targets: {}, mainAssetByClass: {}, monthlyInvest: 0, displayCurrency: 'EUR' });
    expect(r.metalGrid).toHaveLength(5);
  });
});

describe('inverses *ToProperties', () => {
  it('aller-retour actif (hors rollups et formules, jamais écrits)', () => {
    const a = pageToAsset(pg(assetEtf));
    const props = assetToProperties(a);
    expect(props['Quantité']).toBeUndefined();
    expect(props['Prix de revient']).toBeUndefined();
    const rollup = (n: number) => ({ type: 'rollup', rollup: { type: 'number', number: n } });
    const back = pageToAsset({ id: a.id, properties: asProps({ ...props, 'Quantité': rollup(a.quantity), 'Prix de revient': rollup(a.costBasis) }) });
    expect(back).toEqual(a);
  });
  it('aller-retour mouvement, dette, budget, plan, instantané', () => {
    const m = pageToMovement(pg(movement));
    expect(pageToMovement({ id: m.id, properties: asProps(movementToProperties(m)) })).toEqual(m);
    const d = pageToDebt(pg(debt));
    expect(pageToDebt({ id: d.id, properties: asProps(debtToProperties(d)) })).toEqual(d);
    const b = pageToBudgetLine(pg(budgetLine));
    expect(pageToBudgetLine({ id: b.id, properties: asProps(budgetLineToProperties(b)) })).toEqual(b);
    const p = pageToPlanLine(pg(planLine));
    expect(pageToPlanLine({ id: p.id!, properties: asProps(planLineToProperties(p)) })).toEqual(p);
    const s = pageToSnapshot(pg(snapshot));
    expect(pageToSnapshot({ id: 'z', properties: asProps(snapshotToProperties(s)) })).toEqual(s);
  });
  it('snapshot : titre = date ISO ; ratio null → propriété vide', () => {
    const s = { ...pageToSnapshot(pg(snapshot)), goldSilverRatio: null };
    const props = snapshotToProperties(s);
    expect(props['Nom']).toEqual({ title: [{ text: { content: '2026-10-24' } }] });
    expect(props['Date']).toEqual({ date: { start: '2026-10-24' } });
    expect(props['Ratio or/argent']).toEqual({ number: null });
  });
  it('valuationToProperties : seulement les champs script', () => {
    const props = valuationToProperties({ value: 10, valueEur: 9, syncStatus: 'OK', lastUpdate: '2026-10-25' });
    expect(Object.keys(props).sort()).toEqual(['Dernière MAJ', 'Statut sync', 'Valeur', 'Valeur €'].sort());
  });
  it('strategyToRows : aller-retour', () => {
    const s = rowsToStrategy(strategyRows.map(pg));
    const rows = strategyToRows(s);
    const back = rowsToStrategy(rows.map((r, i) => pg({
      id: `r${i}`,
      properties: {
        'Clé': { type: 'title', title: [{ plain_text: r.key }] },
        'Valeur': { type: 'number', number: r.value ?? null },
        'Texte': { type: 'rich_text', rich_text: r.text ? [{ plain_text: r.text }] : [] },
        'Actif': { type: 'relation', relation: r.assetId ? [{ id: r.assetId }] : [] },
      },
    })));
    expect(back).toEqual(s);
  });
});
