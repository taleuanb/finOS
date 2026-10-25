// Importe les achats de métaux (tableur → CSV) dans les mouvements.
// Usage : npx tsx scripts/import-metals.ts [chemin.csv]   (défaut : data/metals-purchases.csv)
// Les actifs « Or » et « Argent » sont ceux de la Stratégie (goldAssetId / silverAssetId).
import { readFileSync } from 'node:fs';
import type { Movement } from '../src/domain/types';
import type { Repo } from '../src/notion/repo';

export type MetalPurchase = Omit<Movement, 'id' | 'assetId'> & { metal: 'gold' | 'silver' };
export interface ImportResult {
  created: number;
  skipped: number;
  /** Lignes refusées (ex. poids fin manquant) ; `reason` est un message lisible en français. */
  rejected: { label: string; reason: string }[];
}

const COLUMNS = ['date', 'metal', 'nature', 'detail', 'quantite', 'prix_paye', 'poids_fin_g'] as const;
const METALS: Record<string, MetalPurchase['metal']> = { or: 'gold', argent: 'silver' };

/** Nombre au format français (« 93,309 », « 1 300 ») ; chaîne vide → NaN. */
function parseNumber(raw: string): number {
  const s = raw.replace(/[\s  ]/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

/** « 19/03/2025 » (ou déjà « 2025-03-19 ») → « 2025-03-19 ». Date inexistante → null. */
function parseDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [d, mo, y] = raw.includes('/') ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${y}-${mo}-${d}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Lit le CSV `date;metal;nature;detail;quantite;prix_paye;poids_fin_g` (séparateur « ; », virgule décimale).
 * - quantity = poids fin en grammes (unité de l'actif) ; `NaN` si la colonne est vide
 *   (importMetals refuse alors la ligne) ;
 * - le nombre de pièces (colonne quantite) > 1 est rappelé dans le libellé : « Maple Leaf 1 oz × 3 ».
 * Lève une Error indiquant la ligne en cas de métal, date ou montant invalide.
 */
export function parseMetalsCsv(csv: string): MetalPurchase[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const [header, ...body] = lines;
  if (!header || header.split(';').map((c) => c.trim()).join(';') !== COLUMNS.join(';')) {
    throw new Error(`En-tête CSV invalide : ${COLUMNS.join(';')} attendu`);
  }
  return body.map((line, i) => {
    const where = `ligne ${i + 2}`;
    const cells = line.split(';').map((c) => c.trim());
    if (cells.length !== COLUMNS.length) throw new Error(`CSV ${where} : ${COLUMNS.length} colonnes attendues`);
    const [rawDate, rawMetal, nature, detail, rawPieces, rawPrice, rawWeight] = cells;

    const date = parseDate(rawDate);
    if (!date) throw new Error(`CSV ${where} : date invalide « ${rawDate} »`);
    const metal = METALS[rawMetal.toLowerCase()];
    if (!metal) throw new Error(`CSV ${where} : métal inconnu « ${rawMetal} » (Or ou Argent attendu)`);
    const amount = parseNumber(rawPrice);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`CSV ${where} : prix payé invalide « ${rawPrice} »`);
    const pieces = parseNumber(rawPieces);
    if (!Number.isInteger(pieces) || pieces < 1) throw new Error(`CSV ${where} : quantité invalide « ${rawPieces} »`);

    return {
      label: pieces > 1 ? `${detail} × ${pieces}` : detail,
      date,
      kind: 'buy' as const,
      nature,
      quantity: parseNumber(rawWeight),
      amount,
      metal,
    };
  });
}

const key = (date: string, label: string, amount: number, assetId: string) => `${date}|${label}|${amount}|${assetId}`;

/**
 * Crée un mouvement d'achat par ligne, sur l'actif Or ou Argent.
 * - ligne sans poids fin exploitable → `rejected` (message « <détail> : poids fin manquant »), rien n'est écrit ;
 * - ligne déjà présente (même date, libellé, montant et actif) → `skipped` : le script est rejouable.
 * Le libellé de `rejected` est le détail seul (sans « × n »), comme dans le tableur.
 */
export async function importMetals(
  repo: Pick<Repo, 'createMovement' | 'listMovements'>,
  rows: MetalPurchase[],
  ids: { gold: string; silver: string },
): Promise<ImportResult> {
  const seen = new Set((await repo.listMovements()).map((m) => key(m.date, m.label, m.amount, m.assetId)));
  const result: ImportResult = { created: 0, skipped: 0, rejected: [] };

  for (const { metal, ...row } of rows) {
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
      const detail = row.label.replace(/ × \d+$/, '');
      result.rejected.push({ label: detail, reason: `${detail} : poids fin manquant` });
      continue;
    }
    const assetId = metal === 'gold' ? ids.gold : ids.silver;
    const k = key(row.date, row.label, row.amount, assetId);
    if (seen.has(k)) {
      result.skipped++;
      continue;
    }
    await repo.createMovement({ ...row, assetId });
    seen.add(k);
    result.created++;
  }
  return result;
}

async function main() {
  const { getRepo } = await import('../src/notion/index');
  const file = process.argv[2] ?? 'data/metals-purchases.csv';
  const rows = parseMetalsCsv(readFileSync(file, 'utf8'));

  const repo = getRepo();
  const strategy = await repo.getStrategy();
  const { goldAssetId, silverAssetId } = strategy;
  if (!goldAssetId || !silverAssetId) {
    const missing = [!goldAssetId && 'l’actif Or', !silverAssetId && 'l’actif Argent'].filter(Boolean).join(' et ');
    console.error(`Stratégie incomplète : ${missing} non renseigné dans la table Stratégie (goldAssetId / silverAssetId).`);
    process.exit(1);
  }

  const { created, skipped, rejected } = await importMetals(repo, rows, { gold: goldAssetId, silver: silverAssetId });
  console.log(`Import des achats de métaux (${file}) : ${rows.length} ligne(s) lue(s).`);
  console.log(`  ${created} mouvement(s) créé(s)`);
  console.log(`  ${skipped} déjà présent(s), ignoré(s)`);
  console.log(`  ${rejected.length} refusé(s)`);
  for (const r of rejected) console.log(`    - ${r.reason}`);
}

// Ne s'exécute que lancé directement (npx tsx scripts/import-metals.ts), pas à l'import par les tests.
if (/import-metals\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error('Échec de l’import :', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
