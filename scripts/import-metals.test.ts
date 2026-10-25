import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeRepo } from '../src/notion/fakeRepo';
import { importMetals, parseMetalsCsv } from './import-metals';

const csv = readFileSync('data/metals-purchases.csv', 'utf8');
const ids = { gold: 'a-or', silver: 'a-argent' };
const head = 'date;metal;nature;detail;quantite;prix_paye;poids_fin_g\n';

describe('parseMetalsCsv', () => {
  it('lit les 7 lignes du tableur', () => {
    expect(parseMetalsCsv(csv)).toHaveLength(7);
  });

  it('convertit les dates JJ/MM/AAAA en AAAA-MM-JJ', () => {
    const rows = parseMetalsCsv(csv);
    expect(rows.map((r) => r.date)).toEqual([
      '2025-03-19', '2025-03-19', '2025-03-19', '2025-06-25', '2025-06-25', '2025-06-25', '2025-11-01',
    ]);
  });

  it('mappe les colonnes : métal, nature, libellé, grammes fins, montant', () => {
    const [suisse, maple, , , , lingot] = parseMetalsCsv(csv);
    expect(suisse).toEqual({
      label: '20 Francs Suisse', date: '2025-03-19', kind: 'buy', nature: 'Pièce',
      quantity: 6.4516, amount: 547, metal: 'gold',
    });
    // 3 pièces : le poids est le total, le nombre de pièces est rappelé dans le libellé
    expect(maple).toMatchObject({ label: 'Maple Leaf 1 oz × 3', quantity: 93.309, amount: 126, metal: 'silver' });
    expect(lingot).toMatchObject({ label: 'Lingot 500 g', nature: 'Lingot', quantity: 500, amount: 615, metal: 'silver' });
  });

  it('accepte les fins de ligne CRLF, un BOM et les lignes vides', () => {
    const rows = parseMetalsCsv('﻿' + csv.replace(/\n/g, '\r\n') + '\r\n\r\n');
    expect(rows).toHaveLength(7);
  });

  it('refuse un métal inconnu ou une date invalide', () => {
    expect(() => parseMetalsCsv(head + '19/03/2025;Platine;Pièce;X;1;10;1')).toThrow(/Platine/);
    expect(() => parseMetalsCsv(head + '31/02/2025;Or;Pièce;X;1;10;1')).toThrow(/date/i);
  });
});

describe('importMetals', () => {
  it('crée les achats valides sur l’actif du métal et refuse la ligne sans poids', async () => {
    const repo = new FakeRepo();
    const res = await importMetals(repo, parseMetalsCsv(csv), ids);
    expect(res.created).toBe(6);
    expect(res.skipped).toBe(0);
    expect(res.rejected).toEqual([{ label: 'Collier', reason: 'Collier : poids fin manquant' }]);

    const movements = await repo.listMovements();
    expect(movements).toHaveLength(6);
    expect(movements.every((m) => m.kind === 'buy')).toBe(true);
    expect(movements.find((m) => m.label === '20 Francs Suisse')).toMatchObject({ assetId: 'a-or', quantity: 6.4516, amount: 547 });
    expect(movements.find((m) => m.label === 'Britannia 1 oz × 3')).toMatchObject({ assetId: 'a-argent', quantity: 93.309, amount: 81 });
    expect(movements.find((m) => m.label === 'Collier')).toBeUndefined();
  });

  it('ne crée pas de doublon à la seconde exécution', async () => {
    const repo = new FakeRepo();
    await importMetals(repo, parseMetalsCsv(csv), ids);
    const again = await importMetals(repo, parseMetalsCsv(csv), ids);
    expect(again).toMatchObject({ created: 0, skipped: 6 });
    expect(again.rejected).toHaveLength(1);
    expect(await repo.listMovements()).toHaveLength(6);
  });

  it('crée deux lignes de même date et libellé si les montants diffèrent', async () => {
    const repo = new FakeRepo();
    const rows = parseMetalsCsv(head + '19/03/2025;Or;Pièce;X;1;100;6\n19/03/2025;Or;Pièce;X;1;110;6');
    expect(await importMetals(repo, rows, ids)).toMatchObject({ created: 2, skipped: 0 });
  });

  it('un même achat existant sur un autre actif n’est pas un doublon', async () => {
    const repo = new FakeRepo();
    await repo.createMovement({ label: '20 Francs Suisse', date: '2025-03-19', assetId: 'autre', kind: 'buy', quantity: 6.4516, amount: 547 });
    const res = await importMetals(repo, parseMetalsCsv(csv), ids);
    expect(res.created).toBe(6);
  });
});
