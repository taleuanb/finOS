'use client';

import { StaleBanner } from '@/ui/StaleBanner';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult, AssetPatch, DebtPatch, MovementInput } from '@/app/patrimoine/patrimoineOps';
import { parisDate } from '@/domain/dates';
import { formatMoney, formatPct } from '@/domain/money';
import type { AssetClass, AssetInput, Currency, DebtInput } from '@/domain/types';
import type { Dashboard, ValuedAsset } from '@/lib/dashboard';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { HIDDEN_TEXT, useDisplay } from '@/ui/display';
import { Money } from '@/ui/Money';
import { AssetSheet } from './AssetSheet';
import { DebtSheet } from './DebtSheet';
import { MovementSheet } from './MovementSheet';

/** Actions d'écriture (server actions en production, doublures dans les tests). */
export interface PatrimoineActions {
  createAsset: (input: AssetInput) => Promise<ActionResult>;
  updateAsset: (id: string, patch: AssetPatch) => Promise<ActionResult>;
  archiveAsset: (id: string, archived: boolean) => Promise<ActionResult>;
  addMovement: (m: MovementInput) => Promise<ActionResult>;
  createDebt: (input: DebtInput) => Promise<ActionResult>;
  updateDebt: (id: string, patch: DebtPatch) => Promise<ActionResult>;
  deleteDebt: (id: string) => Promise<ActionResult>;
}

/** Feuille de formulaire ouverte : création / édition d'un actif, mouvement d'un actif, création / édition d'un crédit. */
type FormSheet =
  | { kind: 'asset'; id?: string }
  | { kind: 'movement'; assetId: string }
  | { kind: 'debt'; id?: string };

type Tab = 'actifs' | 'passifs';
type FilterKey = 'types' | 'institutions' | 'currencies';

interface Filters { types: string[]; institutions: string[]; currencies: string[] }
const NO_FILTER: Filters = { types: [], institutions: [], currencies: [] };

const FILTER_META: { key: FilterKey; label: string; title: string }[] = [
  { key: 'types', label: 'Type', title: 'Filtrer par type' },
  { key: 'institutions', label: 'Établissement', title: 'Filtrer par établissement' },
  { key: 'currencies', label: 'Devise', title: 'Filtrer par devise' },
];

// Couleur du point de groupe et de l'avatar rond, par classe d'actifs (maquette).
const CLASS_STYLE: Record<AssetClass, { dot: string; bg: string; fg: string }> = {
  Immobilier: { dot: '#6C7CF5', bg: '#1D2130', fg: '#FFFFFF' },
  'Fonds & ETF': { dot: '#3B9EF0', bg: '#E6F1FD', fg: '#1B5FA8' },
  Autres: { dot: '#9AA3B2', bg: '#EEF0F3', fg: '#3E4450' },
  PER: { dot: '#22B3A0', bg: '#DDF5F1', fg: '#0F6B5E' },
  Épargne: { dot: '#E0B43A', bg: '#FBF1D9', fg: '#7A5A0E' },
  Crypto: { dot: '#F2994A', bg: '#2A1E4A', fg: '#FFFFFF' },
  'Comptes courants': { dot: '#B7BDC7', bg: '#E6E9F7', fg: '#2F3A66' },
  Startups: { dot: '#B57BEE', bg: '#F3E8FF', fg: '#6B21A8' },
  'Métaux précieux': { dot: '#C99A2E', bg: '#FBF1D9', fg: '#7A5A0E' },
  'Noms de domaine': { dot: '#EC6FA8', bg: '#FCE7F3', fg: '#9D174D' },
};
const DEBT_STYLE = { dot: '#B42318', bg: '#FDECEC', fg: '#B42318' };

function initials(name: string): string {
  const words = name.split(/[\s/]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('fr-FR');
}

function readableDate(iso: string): string {
  // Horodatage complet : le jour est celui de Paris (23:30 UTC = lendemain à Paris). Date seule : telle quelle.
  const day = iso.length > 10 ? parisDate(new Date(iso)) : iso;
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

function perfBadge(gainPct: number | null): { tone: BadgeTone; text: string } | null {
  if (gainPct === null) return null;
  const abs = formatPct(Math.abs(gainPct));
  if (gainPct > 0) return { tone: 'gain', text: `▲ ${abs}` };
  if (gainPct < 0) return { tone: 'loss', text: `▼ ${abs}` };
  return { tone: 'neutral', text: abs };
}

interface RowModel {
  id: string; name: string; sub: string; eur: number; original: { amount: number; currency: Currency } | null;
  gainPct: number | null; warning: string | null; ini: string; bg: string; fg: string;
}
interface GroupModel { name: string; dot: string; rows: RowModel[]; sumEur: number }

function assetRow(a: ValuedAsset): RowModel {
  const style = CLASS_STYLE[a.assetClass];
  return {
    id: a.id, name: a.name, sub: [a.subtype, a.institution].filter(Boolean).join(' · '),
    eur: a.valueEur, original: a.currency === 'EUR' ? null : { amount: a.value, currency: a.currency },
    // Le statut écrit par la synchro commence déjà par « ⚠ » : on le retire, l'icône est ajoutée à l'affichage.
    gainPct: a.gainPct, warning: a.stale ? (a.syncStatus?.replace(/^\s*⚠\s*/, '') || 'à vérifier') : null,
    ini: initials(a.name), bg: style.bg, fg: style.fg,
  };
}

function groupAssets(assets: ValuedAsset[]): GroupModel[] {
  const map = new Map<AssetClass, RowModel[]>();
  for (const a of assets) map.set(a.assetClass, [...(map.get(a.assetClass) ?? []), assetRow(a)]);
  return [...map.entries()]
    .map(([name, rows]) => ({ name, dot: CLASS_STYLE[name].dot, rows, sumEur: rows.reduce((s, r) => s + r.eur, 0) }))
    .sort((a, b) => b.sumEur - a.sumEur);
}

function debtGroup(debts: Dashboard['debts']): GroupModel[] {
  if (debts.length === 0) return [];
  const rows = debts.map((d): RowModel => ({
    id: d.id, name: d.name,
    sub: [d.type, d.endDate ? `fin ${readableDate(d.endDate)}` : undefined].filter(Boolean).join(' · '),
    eur: d.valueEur, original: d.currency === 'EUR' ? null : { amount: d.outstanding, currency: d.currency },
    gainPct: null, warning: null, ini: initials(d.name), bg: DEBT_STYLE.bg, fg: DEBT_STYLE.fg,
  }));
  return [{ name: 'Crédits', dot: DEBT_STYLE.dot, rows, sumEur: rows.reduce((s, r) => s + r.eur, 0) }];
}

function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'fr'));
}

function FilterSheet({
  title, options, selected, onApply, onReset, onClose,
}: {
  title: string; options: string[]; selected: string[];
  onApply: (values: string[]) => void; onReset: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Ouverture : mémorise l'élément déclencheur, place le focus dans la feuille et le rend à la fermeture.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => opener?.focus();
  }, []);

  // Échap ferme ; Tab / Maj+Tab restent dans la feuille.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      const dialog = ref.current;
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('input, button')].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (outside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col gap-3 rounded-t-[24px] bg-card p-4 pb-6 outline-none"
      >
        <h2 className="text-[17px] font-extrabold">{title}</h2>
        <ul className="flex flex-col overflow-y-auto">
          {options.map((o) => (
            <li key={o}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-medium">
                <input
                  type="checkbox"
                  checked={draft.includes(o)}
                  onChange={() => toggle(o)}
                  className="h-5 w-5 accent-[#EE8A3C]"
                />
                {o}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 flex-1 rounded-full border border-border text-[14px] font-bold"
          >
            Réinitialiser
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="min-h-11 flex-1 rounded-full bg-accent text-[14px] font-bold text-[#1A1A1A]"
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

const ADD_BUTTON_CLASS =
  'inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-bold text-[#1A1A1A]';

function PositionRow({ row, onOpen }: { row: RowModel; onOpen: () => void }) {
  const { hidden } = useDisplay();
  const badge = perfBadge(row.gainPct);
  return (
    <li className="border-t border-[#F1F2F4]">
      <button
        type="button"
        aria-label={`Modifier ${row.name}`}
        aria-haspopup="dialog"
        onClick={onOpen}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[12px] font-extrabold"
          style={{ background: row.bg, color: row.fg }}
        >
          {row.ini}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[14px] font-bold">{row.name}</span>
          {row.sub ? <span className="truncate text-[12px] text-muted">{row.sub}</span> : null}
          {row.warning ? <span className="text-[12px] font-semibold text-loss">⚠ {row.warning}</span> : null}
        </span>
        <span className="flex flex-none flex-col items-end gap-1 whitespace-nowrap">
          <Money eur={row.eur} className="text-[14px] font-bold" />
          {row.original ? (
            <span className="text-[11px] text-muted">
              {hidden ? HIDDEN_TEXT : formatMoney(row.original.amount, row.original.currency)}
            </span>
          ) : null}
          {badge ? <Badge tone={badge.tone} className="!px-2 !py-0.5 !text-[11px]">{badge.text}</Badge> : null}
        </span>
      </button>
    </li>
  );
}

export function PatrimoineView({ data, actions }: { data: Dashboard; actions: PatrimoineActions }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('actifs');
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [openSheet, setOpenSheet] = useState<FilterKey | null>(null);
  const [form, setForm] = useState<FormSheet | null>(null);

  // Écriture réussie : la feuille se ferme (le focus revient à la ligne ouverte) et la route est relue.
  const done = () => {
    setForm(null);
    router.refresh();
  };
  const assetById = (id?: string) => data.assets.find((a) => a.id === id);
  const editedAsset = form?.kind === 'asset' ? assetById(form.id) : undefined;
  const movementAsset = form?.kind === 'movement' ? assetById(form.assetId) : undefined;
  const editedDebt = form?.kind === 'debt' ? data.debts.find((d) => d.id === form.id) : undefined;

  const options: Record<FilterKey, string[]> = useMemo(() => ({
    types: distinct(data.assets.map((a) => a.assetClass)),
    institutions: distinct(data.assets.map((a) => a.institution)),
    currencies: distinct(data.assets.map((a) => a.currency)),
  }), [data.assets]);

  const groups = useMemo(() => {
    if (tab === 'passifs') return debtGroup(data.debts);
    const keep = (sel: string[], v: string | undefined) => sel.length === 0 || (v !== undefined && sel.includes(v));
    return groupAssets(
      data.assets.filter((a) =>
        keep(filters.types, a.assetClass) && keep(filters.institutions, a.institution) && keep(filters.currencies, a.currency)),
    );
  }, [tab, data.assets, data.debts, filters]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const totalEur = groups.reduce((s, g) => s + g.sumEur, 0);
  const noun = tab === 'actifs' ? 'actif' : 'passif';
  const sheet = FILTER_META.find((f) => f.key === openSheet);

  return (
    <div className="flex flex-col gap-4">
      <StaleBanner data={data} />

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <div role="tablist" aria-label="Actifs et passifs" className="flex gap-6">
          {([['actifs', 'Actifs'], ['passifs', 'Passifs']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px min-h-11 border-b-2 text-[16px] font-bold ${
                tab === value ? 'border-foreground text-foreground' : 'border-transparent text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setForm(tab === 'actifs' ? { kind: 'asset' } : { kind: 'debt' })}
          className={`${ADD_BUTTON_CLASS} mb-1`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {tab === 'actifs' ? 'Ajouter' : 'Ajouter un crédit'}
        </button>
      </div>

      {tab === 'actifs' ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {FILTER_META.map((f) => {
            const n = filters[f.key].length;
            return (
              <button
                key={f.key}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpenSheet(f.key)}
                className={`min-h-11 flex-none rounded-full border px-3.5 text-[13px] font-semibold ${
                  n > 0 ? 'border-solid border-foreground bg-card' : 'border-dashed border-[#C9CDD5]'
                }`}
              >
                {n > 0 ? `${f.label} · ${n}` : `+ ${f.label}`}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold">Total</span>
          <span className="rounded-full bg-[#E9EBEF] px-2.5 py-[3px] text-[12px] font-semibold text-[#3E4450]">
            {count} {noun}{count > 1 ? 's' : ''}
          </span>
        </div>
        <Money eur={totalEur} className="text-[18px] font-extrabold" />
      </div>

      {groups.map((g) => (
        <section
          key={g.name}
          aria-label={g.name}
          className="overflow-hidden rounded-[20px] border border-border bg-card"
        >
          <div className="flex items-center justify-between border-b border-[#EEEFF2] bg-[#FAFAFB] px-4 py-3.5">
            <span className="inline-flex items-center gap-2 text-[13px] font-bold text-[#3E4450]">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: g.dot }} />
              {g.name}
            </span>
            <Money eur={g.sumEur} className="text-[13px] font-bold" />
          </div>
          <ul>
            {g.rows.map((r) => (
              <PositionRow
                key={r.id}
                row={r}
                onOpen={() => setForm(tab === 'actifs' ? { kind: 'asset', id: r.id } : { kind: 'debt', id: r.id })}
              />
            ))}
          </ul>
        </section>
      ))}

      {count === 0 ? (
        <p className="py-6 text-center text-[14px] text-muted">
          {tab === 'actifs' ? 'Aucun actif ne correspond aux filtres.' : 'Aucun passif.'}
        </p>
      ) : null}

      {form?.kind === 'asset' && (form.id === undefined || editedAsset) ? (
        <AssetSheet
          key={form.id ?? 'nouveau'}
          asset={editedAsset}
          actions={{ create: actions.createAsset, update: actions.updateAsset, archive: actions.archiveAsset }}
          onClose={() => setForm(null)}
          onDone={done}
          onAddMovement={editedAsset ? () => setForm({ kind: 'movement', assetId: editedAsset.id }) : undefined}
        />
      ) : null}
      {movementAsset ? (
        <MovementSheet
          key={movementAsset.id}
          asset={movementAsset}
          actions={{ add: actions.addMovement }}
          onClose={() => setForm(null)}
          onDone={done}
        />
      ) : null}
      {form?.kind === 'debt' && (form.id === undefined || editedDebt) ? (
        <DebtSheet
          key={form.id ?? 'nouveau'}
          debt={editedDebt}
          assets={data.assets}
          actions={{ create: actions.createDebt, update: actions.updateDebt, remove: actions.deleteDebt }}
          onClose={() => setForm(null)}
          onDone={done}
        />
      ) : null}

      {sheet ? (
        <FilterSheet
          key={sheet.key}
          title={sheet.title}
          options={options[sheet.key]}
          selected={filters[sheet.key]}
          onApply={(values) => { setFilters((f) => ({ ...f, [sheet.key]: values })); setOpenSheet(null); }}
          onReset={() => { setFilters((f) => ({ ...f, [sheet.key]: [] })); setOpenSheet(null); }}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
    </div>
  );
}
