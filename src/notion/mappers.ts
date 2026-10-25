import type { Client } from '@notionhq/client';
// Conversion pages Notion <-> objets du domaine. Noms exacts des propriétés : voir `schema.ts`.
import {
  ASSET_CLASSES, DEFAULT_METAL_GRID,
  type Asset, type AssetClass, type AssetInput, type BudgetLine, type DebtInput, type StrategyEntryInput, type Currency, type Debt, type MetalZone, type Movement,
  type PlanLine, type Snapshot, type Strategy,
} from '@/domain/types';
import { OPT, P, STRATEGY_KEY } from './schema';

// ---------------------------------------------------------------------------
// Forme minimale d'une page Notion (tout ce que lisent les mappers).

type RichText = { plain_text: string }[];

export interface NotionProp {
  type?: string;
  title?: RichText;
  rich_text?: RichText;
  number?: number | null;
  select?: { name: string } | null;
  date?: { start: string } | null;
  relation?: { id: string }[];
  checkbox?: boolean;
  rollup?: { type?: string; number?: number | null } | null;
  formula?: { type?: string; number?: number | null } | null;
}

export interface NotionPage {
  id: string;
  properties: Record<string, NotionProp | undefined>;
}

/** Propriétés à envoyer à l'API Notion (création / mise à jour). */
export type NotionProps = NonNullable<Parameters<Client['pages']['create']>[0]['properties']>;

// ---------------------------------------------------------------------------
// Lecture

const text = (rt?: RichText): string => (rt ?? []).map((t) => t.plain_text).join('');

const readTitle = (p: NotionPage, name: string): string => text(p.properties[name]?.title);
const readText = (p: NotionPage, name: string): string | undefined => {
  const v = text(p.properties[name]?.rich_text);
  return v === '' ? undefined : v;
};
const readNumber = (p: NotionPage, name: string): number | undefined => {
  const prop = p.properties[name];
  if (!prop) return undefined;
  const v = prop.type === 'rollup' ? prop.rollup?.number : prop.type === 'formula' ? prop.formula?.number : prop.number;
  return typeof v === 'number' ? v : undefined;
};
const readSelect = (p: NotionPage, name: string): string | undefined => p.properties[name]?.select?.name || undefined;
/** Select ou texte libre (colonnes dont le type n'est pas figé par la spec). */
const readSelectOrText = (p: NotionPage, name: string): string | undefined => readSelect(p, name) ?? readText(p, name);
const readDate = (p: NotionPage, name: string): string | undefined => {
  const start = p.properties[name]?.date?.start;
  return start ? start.slice(0, 10) : undefined;
};
/** Date avec heure éventuelle, telle que Notion la renvoie (horodatage ISO complet). */
const readDateTime = (p: NotionPage, name: string): string | undefined => p.properties[name]?.date?.start || undefined;
const readRelation = (p: NotionPage, name: string): string | undefined => p.properties[name]?.relation?.[0]?.id;
const readCheckbox = (p: NotionPage, name: string): boolean => p.properties[name]?.checkbox === true;

const CURRENCIES: readonly Currency[] = ['EUR', 'MAD', 'USD'];
const asCurrency = (v: string | undefined): Currency | undefined => CURRENCIES.find((c) => c === v);
const asAssetClass = (v: string | undefined): AssetClass | undefined => ASSET_CLASSES.find((c) => c === v);

// ---------------------------------------------------------------------------
// Écriture

const w = {
  title: (v: string) => ({ title: [{ text: { content: v } }] }),
  text: (v: string | undefined) => ({ rich_text: v ? [{ text: { content: v } }] : [] }),
  num: (v: number | null | undefined) => ({ number: v ?? null }),
  sel: (v: string | undefined) => ({ select: v ? { name: v } : null }),
  date: (v: string | undefined) => ({ date: v ? { start: v } : null }),
  rel: (id: string | undefined) => ({ relation: id ? [{ id }] : [] }),
  chk: (v: boolean) => ({ checkbox: v }),
};

// ---------------------------------------------------------------------------
// Actifs (§4.1)

export function pageToAsset(page: NotionPage): Asset {
  const p = P.assets;
  const currency = asCurrency(readSelect(page, p.currency));
  const asset: Asset = {
    id: page.id,
    name: readTitle(page, p.name),
    assetClass: asAssetClass(readSelect(page, p.assetClass)) ?? 'Autres',
    currency: currency ?? 'EUR',
    mode: readSelect(page, p.mode) === OPT.mode.manual ? 'manual' : 'auto',
    quantity: readNumber(page, p.quantity) ?? 0,
    costBasis: readNumber(page, p.costBasis) ?? 0,
    archived: readCheckbox(page, p.archived),
  };
  const optional: Partial<Asset> = {
    subtype: readSelectOrText(page, p.subtype),
    institution: readSelectOrText(page, p.institution),
    quoteId: readText(page, p.quoteId),
    manualValue: readNumber(page, p.manualValue),
    manualValueDate: readDate(page, p.manualValueDate),
    unitPrice: readNumber(page, p.unitPrice),
    value: readNumber(page, p.value),
    valueEur: readNumber(page, p.valueEur),
    fixedMonthly: readNumber(page, p.fixedMonthly),
    syncStatus: readText(page, p.syncStatus),
    lastUpdate: readDateTime(page, p.lastUpdate), // horodatage complet : fraîcheur à l'heure près
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (asset as unknown as Record<string, unknown>)[k] = v;
  if (!currency) asset.syncStatus = '⚠ devise manquante';
  return asset;
}

/** Propriétés modifiables d'un actif. Quantité, Prix de revient (rollups), Plus-value et % (formules) ne s'écrivent pas. */
export function assetToProperties(a: Omit<Asset, 'id'>): NotionProps {
  const p = P.assets;
  return {
    [p.name]: w.title(a.name),
    [p.assetClass]: w.sel(a.assetClass),
    [p.subtype]: w.text(a.subtype),
    [p.institution]: w.sel(a.institution),
    [p.currency]: w.sel(a.currency),
    [p.mode]: w.sel(a.mode === 'manual' ? OPT.mode.manual : OPT.mode.auto),
    [p.quoteId]: w.text(a.quoteId),
    [p.manualValue]: w.num(a.manualValue),
    [p.manualValueDate]: w.date(a.manualValueDate),
    [p.unitPrice]: w.num(a.unitPrice),
    [p.value]: w.num(a.value),
    [p.valueEur]: w.num(a.valueEur),
    [p.fixedMonthly]: w.num(a.fixedMonthly),
    [p.syncStatus]: w.text(a.syncStatus),
    [p.lastUpdate]: w.date(a.lastUpdate),
    [p.archived]: w.chk(a.archived),
  };
}

/** Champs « (script) » d'un actif écrits par la synchro. */
export function valuationToProperties(patch: { unitPrice?: number; value: number; valueEur: number; syncStatus: string; lastUpdate: string }): NotionProps {
  const p = P.assets;
  const props: NotionProps = {
    [p.value]: w.num(patch.value),
    [p.valueEur]: w.num(patch.valueEur),
    [p.syncStatus]: w.text(patch.syncStatus),
    [p.lastUpdate]: w.date(patch.lastUpdate),
  };
  if (patch.unitPrice !== undefined) props[p.unitPrice] = w.num(patch.unitPrice);
  return props;
}

/** Patch d'écriture : clé absente (ou `undefined`) = inchangé, `null` = champ optionnel vidé. */
export type Patch<T> = { [K in keyof T]?: T[K] | null };

/**
 * Propriétés d'entrée d'un actif saisies dans l'app (création ou patch). N'écrit que les clés présentes ;
 * jamais Quantité / Prix de revient (rollups), Plus-value / % (formules) ni les champs « script » (sauf pour vider
 * « Cours unitaire » : `unitPrice: null`).
 * `null` vide un champ optionnel ; sur un champ obligatoire (nom, classe, devise, mode) il est ignoré.
 * Types alignés sur la base créée par `setup.ts` : Sous-type en texte, Établissement en select.
 */
export function assetInputToProperties(a: Patch<AssetInput> & { unitPrice?: null }): NotionProps {
  const p = P.assets;
  const props: NotionProps = {};
  if (a.name != null) props[p.name] = w.title(a.name);
  if (a.assetClass != null) props[p.assetClass] = w.sel(a.assetClass);
  if (a.subtype !== undefined) props[p.subtype] = w.text(a.subtype ?? undefined);
  if (a.institution !== undefined) props[p.institution] = w.sel(a.institution ?? undefined);
  if (a.currency != null) props[p.currency] = w.sel(a.currency);
  if (a.mode != null) props[p.mode] = w.sel(a.mode === 'manual' ? OPT.mode.manual : OPT.mode.auto);
  if (a.quoteId !== undefined) props[p.quoteId] = w.text(a.quoteId ?? undefined);
  if (a.manualValue !== undefined) props[p.manualValue] = w.num(a.manualValue);
  if (a.manualValueDate !== undefined) props[p.manualValueDate] = w.date(a.manualValueDate ?? undefined);
  if (a.fixedMonthly !== undefined) props[p.fixedMonthly] = w.num(a.fixedMonthly);
  if (a.archived !== undefined) props[p.archived] = w.chk(a.archived === true);
  if (a.unitPrice === null) props[p.unitPrice] = w.num(null); // vidé seulement (classe / cotation / mode changés)
  return props;
}

// ---------------------------------------------------------------------------
// Mouvements (§4.2)

export function pageToMovement(page: NotionPage): Movement {
  const p = P.movements;
  const m: Movement = {
    id: page.id,
    label: readTitle(page, p.label),
    date: readDate(page, p.date) ?? '',
    assetId: readRelation(page, p.asset) ?? '',
    kind: readSelect(page, p.kind) === OPT.kind.sell ? 'sell' : 'buy',
    quantity: readNumber(page, p.quantity) ?? 0,
    amount: readNumber(page, p.amount) ?? 0,
  };
  const nature = readSelectOrText(page, p.nature);
  const spot = readNumber(page, p.spotEurPerKg);
  const planMonth = readText(page, p.planMonth);
  if (nature !== undefined) m.nature = nature;
  if (spot !== undefined) m.spotEurPerKg = spot;
  if (planMonth !== undefined) m.planMonth = planMonth;
  return m;
}

/** Prime % est une formule : jamais écrite. */
export function movementToProperties(m: Omit<Movement, 'id'>): NotionProps {
  const p = P.movements;
  return {
    [p.label]: w.title(m.label),
    [p.date]: w.date(m.date),
    [p.asset]: w.rel(m.assetId),
    [p.kind]: w.sel(m.kind === 'sell' ? OPT.kind.sell : OPT.kind.buy),
    [p.nature]: w.sel(m.nature),
    [p.quantity]: w.num(m.quantity),
    [p.amount]: w.num(m.amount),
    [p.spotEurPerKg]: w.num(m.spotEurPerKg),
    [p.planMonth]: w.text(m.planMonth),
  };
}

// ---------------------------------------------------------------------------
// Dettes (§4.3)

export function pageToDebt(page: NotionPage): Debt {
  const p = P.debts;
  const d: Debt = {
    id: page.id,
    name: readTitle(page, p.name),
    currency: asCurrency(readSelect(page, p.currency)) ?? 'EUR',
    outstanding: readNumber(page, p.outstanding) ?? 0,
  };
  const optional: Partial<Debt> = {
    type: readSelectOrText(page, p.type),
    rate: readNumber(page, p.rate),
    monthly: readNumber(page, p.monthly),
    endDate: readDate(page, p.endDate),
    financedAssetId: readRelation(page, p.financedAsset),
    valueEur: readNumber(page, p.valueEur),
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (d as unknown as Record<string, unknown>)[k] = v;
  return d;
}

export function debtToProperties(d: Omit<Debt, 'id'>): NotionProps {
  const p = P.debts;
  return {
    [p.name]: w.title(d.name),
    [p.type]: w.sel(d.type),
    [p.currency]: w.sel(d.currency),
    [p.outstanding]: w.num(d.outstanding),
    [p.rate]: w.num(d.rate),
    [p.monthly]: w.num(d.monthly),
    [p.endDate]: w.date(d.endDate),
    [p.financedAsset]: w.rel(d.financedAssetId),
    [p.valueEur]: w.num(d.valueEur),
  };
}

/** Propriétés d'entrée d'un crédit (jamais Valeur €). Mêmes règles que `assetInputToProperties`. */
export function debtInputToProperties(d: Patch<DebtInput>): NotionProps {
  const p = P.debts;
  const props: NotionProps = {};
  if (d.name != null) props[p.name] = w.title(d.name);
  if (d.type !== undefined) props[p.type] = w.sel(d.type ?? undefined);
  if (d.currency != null) props[p.currency] = w.sel(d.currency);
  if (d.outstanding != null) props[p.outstanding] = w.num(d.outstanding);
  if (d.rate !== undefined) props[p.rate] = w.num(d.rate);
  if (d.monthly !== undefined) props[p.monthly] = w.num(d.monthly);
  if (d.endDate !== undefined) props[p.endDate] = w.date(d.endDate ?? undefined);
  if (d.financedAssetId !== undefined) props[p.financedAsset] = w.rel(d.financedAssetId ?? undefined);
  return props;
}

// ---------------------------------------------------------------------------
// Budget (§4.4)

export function pageToBudgetLine(page: NotionPage): BudgetLine {
  const p = P.budget;
  return {
    id: page.id,
    name: readTitle(page, p.name),
    section: readSelect(page, p.section) === OPT.section.revenu ? 'revenu' : 'depense',
    category: readSelectOrText(page, p.category) ?? '',
    monthlyAmount: readNumber(page, p.monthlyAmount) ?? 0,
    currency: asCurrency(readSelect(page, p.currency)) ?? 'EUR',
    order: readNumber(page, p.order) ?? 0,
  };
}

export function budgetLineToProperties(l: Omit<BudgetLine, 'id'>): NotionProps {
  const p = P.budget;
  return {
    [p.name]: w.title(l.name),
    [p.section]: w.sel(l.section === 'revenu' ? OPT.section.revenu : OPT.section.depense),
    [p.category]: w.sel(l.category),
    [p.monthlyAmount]: w.num(l.monthlyAmount),
    [p.currency]: w.sel(l.currency),
    [p.order]: w.num(l.order),
  };
}

// ---------------------------------------------------------------------------
// Stratégie (§4.5) : lignes clé/valeur

/** Ligne de la base Stratégie sous forme neutre (inverse de `rowsToStrategy`). */
export interface StrategyRow { key: string; value?: number; text?: string; assetId?: string }

const round = (n: number) => Math.round(n * 1e6) / 1e6;
/** « min-max », « min–max » ou « min—max » ; « 80- » pour une zone ouverte. */
const ZONE_TEXT = /^\s*(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)?\s*$/;

function parseZone(label: string, share: number | undefined, range: string | undefined): MetalZone | undefined {
  const m = range ? ZONE_TEXT.exec(range) : null;
  if (!m || share === undefined) return undefined;
  const min = Number(m[1].replace(',', '.'));
  const max = m[2] === undefined ? Infinity : Number(m[2].replace(',', '.'));
  return { label, min, max, goldShare: round(share / 100) };
}

/** Page Notion -> ligne neutre. */
export function pageToStrategyRow(page: NotionPage): StrategyRow {
  const p = P.strategy;
  const row: StrategyRow = { key: readTitle(page, p.key).trim() };
  const value = readNumber(page, p.value);
  const text = readText(page, p.text);
  const asset = readRelation(page, p.asset);
  if (value !== undefined) row.value = value;
  if (text !== undefined) row.text = text;
  if (asset !== undefined) row.assetId = asset;
  return row;
}

export function rowsToStrategy(pages: NotionPage[]): Strategy {
  return strategyFromRows(pages.map(pageToStrategyRow));
}

/** Lignes neutres -> Strategy (partagé par la lecture Notion et le FakeRepo). */
export function strategyFromRows(rows: StrategyRow[]): Strategy {
  const s: Strategy = { targets: {}, mainAssetByClass: {}, monthlyInvest: 0, metalGrid: [], displayCurrency: 'EUR' };
  const zones: MetalZone[] = [];
  const unreadable: string[] = [];

  for (const row of rows) {
    const { key, value, assetId: asset } = row;

    if (key.startsWith(STRATEGY_KEY.targetPrefix)) {
      const cls = asAssetClass(key.slice(STRATEGY_KEY.targetPrefix.length).trim());
      if (!cls) continue;
      if (value !== undefined) s.targets[cls] = round(value / 100);
      if (asset) s.mainAssetByClass[cls] = asset;
    } else if (key.startsWith(STRATEGY_KEY.zonePrefix)) {
      const zone = parseZone(key.slice(STRATEGY_KEY.zonePrefix.length).trim(), value, row.text);
      if (zone) zones.push(zone);
      else unreadable.push(key.slice(STRATEGY_KEY.zonePrefix.length).trim());
    } else if (key === STRATEGY_KEY.gold) {
      if (asset) s.goldAssetId = asset;
    } else if (key === STRATEGY_KEY.silver) {
      if (asset) s.silverAssetId = asset;
    } else if (key === STRATEGY_KEY.savings) {
      if (asset) s.savingsAssetId = asset;
    } else if (key === STRATEGY_KEY.monthlyInvest) {
      if (value !== undefined) s.monthlyInvest = value;
    } else if (key === STRATEGY_KEY.displayCurrency) {
      const c = asCurrency(row.text?.trim());
      if (c) s.displayCurrency = c;
    }
    // Clé inconnue : ignorée.
  }

  // Sans aucune zone saisie : grille par défaut de la spec §4.5.
  s.metalGrid = zones.length > 0 ? zones.sort((a, b) => a.min - b.min) : DEFAULT_METAL_GRID.map((z) => ({ ...z }));
  if (unreadable.length > 0) s.gridWarnings = unreadable;
  return s;
}

export function strategyToRows(s: Strategy): StrategyRow[] {
  const rows: StrategyRow[] = [];
  const classes = new Set<AssetClass>([...(Object.keys(s.targets) as AssetClass[]), ...(Object.keys(s.mainAssetByClass) as AssetClass[])]);
  for (const cls of classes) {
    const target = s.targets[cls];
    rows.push({
      key: STRATEGY_KEY.targetPrefix + cls,
      ...(target !== undefined ? { value: round(target * 100) } : {}),
      ...(s.mainAssetByClass[cls] ? { assetId: s.mainAssetByClass[cls] } : {}),
    });
  }
  if (s.goldAssetId) rows.push({ key: STRATEGY_KEY.gold, assetId: s.goldAssetId });
  if (s.silverAssetId) rows.push({ key: STRATEGY_KEY.silver, assetId: s.silverAssetId });
  if (s.savingsAssetId) rows.push({ key: STRATEGY_KEY.savings, assetId: s.savingsAssetId });
  rows.push({ key: STRATEGY_KEY.monthlyInvest, value: s.monthlyInvest });
  for (const z of s.metalGrid) {
    rows.push({
      key: STRATEGY_KEY.zonePrefix + z.label,
      value: round(z.goldShare * 100),
      text: `${z.min}-${Number.isFinite(z.max) ? z.max : ''}`,
    });
  }
  rows.push({ key: STRATEGY_KEY.displayCurrency, text: s.displayCurrency });
  return rows;
}

export function strategyRowToProperties(r: StrategyRow): NotionProps {
  const p = P.strategy;
  return {
    [p.key]: w.title(r.key),
    [p.value]: w.num(r.value),
    [p.text]: w.text(r.text),
    [p.asset]: w.rel(r.assetId),
  };
}

/**
 * Écriture d'une clé Stratégie : `value` / `text` / `assetId` absents = inchangés, `null` = vidés.
 * Le titre (la clé) n'est écrit qu'à la création.
 */
export function strategyEntryToProperties(e: StrategyEntryInput, creating: boolean): NotionProps {
  const p = P.strategy;
  const props: NotionProps = {};
  if (creating) props[p.key] = w.title(e.key);
  if (e.value !== undefined) props[p.value] = w.num(e.value);
  if (e.text !== undefined) props[p.text] = w.text(e.text ?? undefined);
  if (e.assetId !== undefined) props[p.asset] = w.rel(e.assetId ?? undefined);
  return props;
}

// ---------------------------------------------------------------------------
// Plan mensuel (§4.6)

const ORIGIN_TO_NOTION = { fixe: OPT.origin.fixe, cible: OPT.origin.cible, signal: OPT.origin.signal } as const;

export function pageToPlanLine(page: NotionPage): PlanLine {
  const p = P.plan;
  const origin = readSelect(page, p.origin);
  return {
    id: page.id,
    month: readTitle(page, p.month),
    assetId: readRelation(page, p.asset) ?? '',
    amount: readNumber(page, p.amount) ?? 0,
    origin: origin === OPT.origin.fixe ? 'fixe' : origin === OPT.origin.signal ? 'signal' : 'cible',
  };
}

export function planLineToProperties(l: PlanLine): NotionProps {
  const p = P.plan;
  return {
    [p.month]: w.title(l.month),
    [p.asset]: w.rel(l.assetId),
    [p.amount]: w.num(l.amount),
    [p.origin]: w.sel(ORIGIN_TO_NOTION[l.origin]),
  };
}

// ---------------------------------------------------------------------------
// Historique (§4.7) : titre = date ISO, une propriété nombre par classe

export function pageToSnapshot(page: NotionPage): Snapshot {
  const p = P.history;
  const byClass = {} as Snapshot['byClass'];
  for (const cls of ASSET_CLASSES) byClass[cls] = readNumber(page, p.byClass[cls]) ?? 0;
  return {
    date: readTitle(page, p.title) || readDate(page, p.date) || '',
    totalAssetsEur: readNumber(page, p.totalAssetsEur) ?? 0,
    totalDebtsEur: readNumber(page, p.totalDebtsEur) ?? 0,
    netEur: readNumber(page, p.netEur) ?? 0,
    byClass,
    goldSilverRatio: readNumber(page, p.goldSilverRatio) ?? null,
    eurMad: readNumber(page, p.eurMad) ?? 0,
    eurUsd: readNumber(page, p.eurUsd) ?? 0,
    partial: readCheckbox(page, p.partial),
  };
}

export function snapshotToProperties(s: Snapshot): NotionProps {
  const p = P.history;
  const props: NotionProps = {
    [p.title]: w.title(s.date),
    [p.date]: w.date(s.date),
    [p.totalAssetsEur]: w.num(s.totalAssetsEur),
    [p.totalDebtsEur]: w.num(s.totalDebtsEur),
    [p.netEur]: w.num(s.netEur),
    [p.goldSilverRatio]: w.num(s.goldSilverRatio),
    [p.eurMad]: w.num(s.eurMad),
    [p.eurUsd]: w.num(s.eurUsd),
    [p.partial]: w.chk(s.partial),
  };
  for (const cls of ASSET_CLASSES) props[p.byClass[cls]] = w.num(s.byClass[cls] ?? 0);
  return props;
}
