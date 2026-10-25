import { parisDate } from '@/domain/dates';
import { ASSET_CLASSES, type AssetInput, type Currency, type DebtInput } from '@/domain/types';
import type { Repo } from '@/notion/repo';

/**
 * Logique des actions Patrimoine (actifs, mouvements, crédits), indépendante du dépôt réel (testée avec un FakeRepo).
 * Elle vit hors de `actions.ts` : un fichier 'use server' expose chacun de ses exports comme point d'entrée appelable.
 * Module sans dépendance serveur : les feuilles de formulaire y importent les listes de choix et les types.
 */

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/** Patch de modification : `null` efface un champ optionnel, `undefined` / absent = inchangé. */
export type AssetPatch = { [K in keyof AssetInput]?: AssetInput[K] | null };
export type DebtPatch = { [K in keyof DebtInput]?: DebtInput[K] | null };

export interface MovementInput {
  assetId: string; kind: 'buy' | 'sell'; date: string; quantity: number; amount: number; label?: string; nature?: string;
}

// Options des listes Notion (Select) créées par `src/notion/setup.ts`.
export const INSTITUTIONS = ['Revolut', 'LCL', 'Suravenir', 'Finary', 'Banque Maroc', 'Physique'] as const;
export const DEBT_TYPES = ['Crédit immobilier', 'Crédit consommation', 'Autre'] as const;
export const CURRENCIES: readonly Currency[] = ['EUR', 'MAD', 'USD'];

const MAX_TEXT = 200;
const MAX_INSTITUTION = 60;
const MAX_QUOTE_ID = 100;
const MAX_NATURE = 60;
const MAX_AMOUNT = 1_000_000_000;
const METALS = 'Métaux précieux';
const METAL_QUOTES = ['XAU', 'XAG'];

const ASSET_NOT_FOUND = 'Actif introuvable';
const DEBT_NOT_FOUND = 'Crédit introuvable';
const SAVE_ERROR = 'Enregistrement impossible, réessaie dans un instant.';
const DELETE_ERROR = 'Suppression impossible, réessaie dans un instant.';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });
const good = <T>(value: T): Parsed<T> => ({ ok: true, value });

const cents = (n: number) => Math.round(n * 100) / 100;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Vrai pour une date calendaire réelle 'AAAA-MM-JJ' (refuse 2026-13-45 et 2026-02-30). */
function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function readText(v: unknown, error: string, max: number): Parsed<string> {
  const t = typeof v === 'string' ? v.trim() : '';
  return t && t.length <= max ? good(t) : bad(error);
}

/** Montant fini dans [min, 1 000 000 000], arrondi au centime. */
function readAmount(v: unknown, error: string, opts: { positive?: boolean } = {}): Parsed<number> {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) return bad(error);
  const n = cents(v);
  return opts.positive && n <= 0 ? bad(error) : good(n);
}

// ---------------------------------------------------------------------------
// Actifs

const ASSET_KEYS = [
  'name', 'assetClass', 'subtype', 'institution', 'currency', 'mode', 'quoteId',
  'manualValue', 'manualValueDate', 'fixedMonthly', 'archived',
] as const satisfies readonly (keyof AssetInput)[];
const ASSET_REQUIRED: readonly string[] = ['name', 'assetClass', 'currency', 'mode'];

/** Valide un actif complet (champs inconnus ignorés) et le renvoie normalisé. */
function parseAsset(raw: unknown, now: Date): Parsed<AssetInput> {
  if (!isObject(raw)) return bad('Données invalides');
  const name = readText(raw.name, 'Nom requis (200 caractères maximum)', MAX_TEXT);
  if (!name.ok) return name;
  if (!ASSET_CLASSES.includes(raw.assetClass as never)) return bad('Classe invalide');
  if (!CURRENCIES.includes(raw.currency as Currency)) return bad('Devise invalide');
  if (raw.mode !== 'auto' && raw.mode !== 'manual') return bad('Mode de valorisation invalide');
  const assetClass = raw.assetClass as AssetInput['assetClass'];
  const mode = raw.mode;
  const out: AssetInput = { name: name.value, assetClass, currency: raw.currency as Currency, mode };

  if (raw.subtype != null && raw.subtype !== '') {
    const subtype = readText(raw.subtype, 'Sous-type invalide', MAX_TEXT);
    if (!subtype.ok) return subtype;
    out.subtype = subtype.value;
  }
  if (raw.institution != null) {
    const institution = readText(raw.institution, `Établissement invalide (${MAX_INSTITUTION} caractères maximum)`, MAX_INSTITUTION);
    if (!institution.ok) return institution;
    out.institution = institution.value;
  }

  const quoteRaw = raw.quoteId == null || raw.quoteId === '' ? undefined : raw.quoteId;
  if (quoteRaw !== undefined || mode === 'auto') {
    const quote = readText(quoteRaw, 'Identifiant de cotation requis pour une valorisation Auto', MAX_QUOTE_ID);
    if (!quote.ok) return quote;
    if (/\s/.test(quote.value)) return bad('Identifiant de cotation invalide');
    if (mode === 'auto' && assetClass === METALS) {
      const code = quote.value.toUpperCase();
      if (!METAL_QUOTES.includes(code)) return bad('Pour un métal précieux en Auto, l’identifiant doit être XAU (or) ou XAG (argent)');
      out.quoteId = code;
    } else {
      out.quoteId = quote.value;
    }
  }

  if (raw.manualValue != null) {
    const value = readAmount(raw.manualValue, 'Valeur manuelle invalide');
    if (!value.ok) return value;
    out.manualValue = value.value;
  } else if (mode === 'manual') {
    return bad('Valeur manuelle requise');
  }
  if (raw.manualValueDate != null) {
    if (!isRealDate(raw.manualValueDate)) return bad('Date de valeur invalide');
    out.manualValueDate = raw.manualValueDate;
  } else if (out.manualValue !== undefined) {
    out.manualValueDate = parisDate(now);
  }

  if (raw.fixedMonthly != null) {
    const monthly = readAmount(raw.fixedMonthly, 'Versement mensuel invalide');
    if (!monthly.ok) return monthly;
    out.fixedMonthly = monthly.value;
  }
  if (raw.archived != null) {
    if (typeof raw.archived !== 'boolean') return bad('Archivage invalide');
    out.archived = raw.archived;
  }
  return good(out);
}

export async function createAssetWith(repo: Repo, input: unknown, now: Date = new Date()): Promise<ActionResult> {
  const parsed = parseAsset(input, now);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, id: await repo.createAsset(parsed.value) };
  } catch (e) {
    console.error('createAsset', e);
    return bad(SAVE_ERROR);
  }
}

export async function updateAssetWith(repo: Repo, id: unknown, patch: unknown, now: Date = new Date()): Promise<ActionResult> {
  if (typeof id !== 'string' || !id) return bad(ASSET_NOT_FOUND);
  if (!isObject(patch)) return bad('Données invalides');
  try {
    // L'id vient du client : il doit désigner un actif de la base Actifs, jamais une autre page Notion.
    const existing = (await repo.listAssets()).find((a) => a.id === id);
    if (!existing) return bad(ASSET_NOT_FOUND);

    // Les règles croisées (Auto ⇒ cotation…) se vérifient sur l'actif tel qu'il serait après modification.
    const candidate: Record<string, unknown> = {};
    for (const k of ASSET_KEYS) if (existing[k] !== undefined) candidate[k] = existing[k];
    for (const k of ASSET_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v === null) {
        if (ASSET_REQUIRED.includes(k)) return bad('Champ obligatoire');
        delete candidate[k];
      } else {
        candidate[k] = v;
      }
    }
    const parsed = parseAsset(candidate, now);
    if (!parsed.ok) return parsed;

    // On n'écrit que les clés de saisie fournies, avec leur valeur normalisée (jamais un champ inconnu).
    const write: Record<string, unknown> = {};
    for (const k of ASSET_KEYS) if (patch[k] !== undefined) write[k] = parsed.value[k] ?? null;
    if (write.manualValueDate === undefined && parsed.value.manualValueDate && parsed.value.manualValueDate !== existing.manualValueDate) {
      write.manualValueDate = parsed.value.manualValueDate; // date du jour appliquée à une valeur sans date
    }
    if (Object.keys(write).length > 0) await repo.updateAsset(id, write as AssetPatch);
    return { ok: true };
  } catch (e) {
    console.error('updateAsset', e);
    return bad(SAVE_ERROR);
  }
}

export async function archiveAssetWith(repo: Repo, id: unknown, archived: unknown): Promise<ActionResult> {
  if (typeof id !== 'string' || !id) return bad(ASSET_NOT_FOUND);
  if (typeof archived !== 'boolean') return bad('Archivage invalide');
  try {
    if (!(await repo.listAssets()).some((a) => a.id === id)) return bad(ASSET_NOT_FOUND);
    await repo.updateAsset(id, { archived });
    return { ok: true };
  } catch (e) {
    console.error('archiveAsset', e);
    return bad(SAVE_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Mouvements

export async function addMovementWith(repo: Repo, input: unknown, now: Date = new Date()): Promise<ActionResult> {
  if (!isObject(input)) return bad('Données invalides');
  if (typeof input.assetId !== 'string' || !input.assetId) return bad(ASSET_NOT_FOUND);
  if (input.kind !== 'buy' && input.kind !== 'sell') return bad('Type de mouvement invalide');
  const kind = input.kind;
  const date = input.date == null || input.date === '' ? parisDate(now) : input.date;
  if (!isRealDate(date)) return bad('Date invalide');
  const quantity = input.quantity == null ? good(0) : readAmount(input.quantity, 'Quantité invalide');
  if (!quantity.ok) return quantity;
  const amount = readAmount(input.amount, 'Le montant doit être supérieur à 0', { positive: true });
  if (!amount.ok) return amount;

  let label = kind === 'buy' ? `Achat ${date}` : `Vente ${date}`;
  if (input.label != null && input.label !== '') {
    const custom = readText(input.label, `Libellé invalide (${MAX_TEXT} caractères maximum)`, MAX_TEXT);
    if (!custom.ok) return custom;
    label = custom.value;
  }
  let nature: string | undefined;
  if (input.nature != null && input.nature !== '') {
    const n = readText(input.nature, 'Nature invalide', MAX_NATURE);
    if (!n.ok) return n;
    nature = n.value;
  }

  try {
    const asset = (await repo.listAssets()).find((a) => a.id === input.assetId);
    if (!asset) return bad(ASSET_NOT_FOUND);
    if (asset.archived) return bad('Cet actif est archivé');
    // Métal précieux : la quantité est le poids fin (g), indispensable au calcul de la prime et du prix moyen.
    if (asset.assetClass === METALS && quantity.value <= 0) return bad('Poids fin requis pour un métal précieux');
    await repo.createMovement({
      assetId: asset.id, date, kind, label, quantity: quantity.value, amount: amount.value, ...(nature ? { nature } : {}),
    });
    return { ok: true };
  } catch (e) {
    console.error('addMovement', e);
    return bad(SAVE_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Crédits

interface DebtField { required: boolean; parse: (v: unknown) => Parsed<unknown> }

const DEBT_FIELDS: Record<keyof DebtInput, DebtField> = {
  name: { required: true, parse: (v) => readText(v, 'Nom requis (200 caractères maximum)', MAX_TEXT) },
  type: { required: false, parse: (v) => ((DEBT_TYPES as readonly unknown[]).includes(v) ? good(v) : bad('Type de crédit invalide')) },
  currency: { required: true, parse: (v) => (CURRENCIES.includes(v as Currency) ? good(v) : bad('Devise invalide')) },
  outstanding: { required: true, parse: (v) => readAmount(v, 'Capital restant dû invalide') },
  rate: {
    required: false,
    parse: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? good(Math.round(v * 10_000) / 10_000) : bad('Taux invalide (entre 0 et 100 %)')),
  },
  monthly: { required: false, parse: (v) => readAmount(v, 'Mensualité invalide') },
  endDate: { required: false, parse: (v) => (isRealDate(v) ? good(v) : bad('Date de fin invalide')) },
  financedAssetId: { required: false, parse: (v) => (typeof v === 'string' && v ? good(v) : bad(ASSET_NOT_FOUND)) },
};
const DEBT_KEYS = Object.keys(DEBT_FIELDS) as (keyof DebtInput)[];

export async function createDebtWith(repo: Repo, input: unknown): Promise<ActionResult> {
  if (!isObject(input)) return bad('Données invalides');
  const value: Record<string, unknown> = {};
  for (const k of DEBT_KEYS) {
    const v = input[k];
    if (v == null) {
      if (DEBT_FIELDS[k].required) return DEBT_FIELDS[k].parse(undefined) as { ok: false; error: string };
      continue;
    }
    const parsed = DEBT_FIELDS[k].parse(v);
    if (!parsed.ok) return parsed;
    value[k] = parsed.value;
  }
  try {
    if (value.financedAssetId && !(await repo.listAssets()).some((a) => a.id === value.financedAssetId)) return bad(ASSET_NOT_FOUND);
    return { ok: true, id: await repo.createDebt(value as unknown as DebtInput) };
  } catch (e) {
    console.error('createDebt', e);
    return bad(SAVE_ERROR);
  }
}

export async function updateDebtWith(repo: Repo, id: unknown, patch: unknown): Promise<ActionResult> {
  if (typeof id !== 'string' || !id) return bad(DEBT_NOT_FOUND);
  if (!isObject(patch)) return bad('Données invalides');
  const write: Record<string, unknown> = {};
  for (const k of DEBT_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null) {
      if (DEBT_FIELDS[k].required) return bad('Champ obligatoire');
      write[k] = null;
      continue;
    }
    const parsed = DEBT_FIELDS[k].parse(v);
    if (!parsed.ok) return parsed;
    write[k] = parsed.value;
  }
  try {
    // L'id vient du client : il doit désigner un crédit de la base Dettes.
    if (!(await repo.listDebts()).some((d) => d.id === id)) return bad(DEBT_NOT_FOUND);
    if (write.financedAssetId && !(await repo.listAssets()).some((a) => a.id === write.financedAssetId)) return bad(ASSET_NOT_FOUND);
    if (Object.keys(write).length > 0) await repo.updateDebt(id, write as DebtPatch);
    return { ok: true };
  } catch (e) {
    console.error('updateDebt', e);
    return bad(SAVE_ERROR);
  }
}

export async function deleteDebtWith(repo: Repo, id: unknown): Promise<ActionResult> {
  if (typeof id !== 'string' || !id) return bad(DEBT_NOT_FOUND);
  try {
    if (!(await repo.listDebts()).some((d) => d.id === id)) return bad(DEBT_NOT_FOUND);
    await repo.deleteDebt(id);
    return { ok: true };
  } catch (e) {
    console.error('deleteDebt', e);
    return bad(DELETE_ERROR);
  }
}
