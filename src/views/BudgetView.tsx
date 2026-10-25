'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { budgetSankey, summarizeBudget } from '@/domain/budget';
import { toEur } from '@/domain/money';
import type { BudgetLine, Currency } from '@/domain/types';
import type { Dashboard } from '@/lib/dashboard';
import { Card } from '@/ui/Card';
import { SankeyChart } from '@/ui/charts/SankeyChart';
import { formatDateFr } from '@/ui/charts/shared';
import { useDisplay } from '@/ui/display';
import { Money } from '@/ui/Money';
import type { ActionResult, BudgetLineInput, SaveResult } from '@/app/budget/budgetOps';
import { exportSankeyPng } from './exportPng';

export interface BudgetActions {
  save: (line: BudgetLineInput) => Promise<SaveResult>;
  remove: (id: string) => Promise<ActionResult>;
  reorder: (ids: string[]) => Promise<ActionResult>;
}

type Section = BudgetLine['section'];
type Tab = Section | 'invest';

const TABS: { value: Tab; label: string }[] = [
  { value: 'revenu', label: 'Revenus' },
  { value: 'invest', label: 'Investissements' },
  { value: 'depense', label: 'Dépenses' },
];
const CURRENCIES: Currency[] = ['EUR', 'MAD', 'USD'];
const ADD_LABEL: Record<Section, string> = { revenu: 'Ajouter un revenu', depense: 'Ajouter une dépense' };

interface Row {
  key: string;
  id?: string;
  name: string;
  section: Section;
  category: string;
  currency: Currency;
  order: number;
  /** Dernière valeur valide, utilisée par le résumé et le Sankey. */
  monthlyAmount: number;
  amountText: string;
  fieldError?: string;
  /** Modifiée depuis le dernier enregistrement réussi. */
  dirty: boolean;
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
}

/** « 12,5 » ou « 12.5 » → 12.5 ; une virgule finale (saisie en cours) est tolérée. Sinon null. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s  ]/g, '').replace(/[.,]$/, '');
  if (!/^\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const toRow = (l: BudgetLine): Row => ({
  key: l.id, id: l.id, name: l.name, section: l.section, category: l.category, currency: l.currency,
  order: l.order, monthlyAmount: l.monthlyAmount, amountText: String(l.monthlyAmount),
  dirty: false, status: 'idle',
});

const rowLabel = (r: Row) => r.name.trim() || 'nouvelle ligne';

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="#B7BDC7" className="shrink-0">
      <circle cx="2" cy="3" r="1.4" /><circle cx="8" cy="3" r="1.4" />
      <circle cx="2" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" />
      <circle cx="2" cy="13" r="1.4" /><circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}

function IconButton({ label, disabled, onClick, children }: {
  label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-foreground disabled:opacity-30"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function BudgetView({ data, actions }: { data: Dashboard; actions: BudgetActions }) {
  const display = useDisplay();
  const [tab, setTab] = useState<Tab>('depense');
  const [rows, setRows] = useState<Row[]>(() => [...data.budget.lines].sort((a, b) => a.order - b.order).map(toRow));
  const rowsRef = useRef(rows);
  const [extraCats, setExtraCats] = useState<{ section: Section; name: string }[]>([]);
  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const chains = useRef<Record<string, Promise<void>>>({});
  const seq = useRef(0);
  const sankeyRef = useRef<HTMLDivElement>(null);

  const commit = useCallback((next: Row[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);
  const patch = useCallback((key: string, p: Partial<Row> | ((r: Row) => Partial<Row>)) => {
    commit(rowsRef.current.map((r) => (r.key === key ? { ...r, ...(typeof p === 'function' ? p(r) : p) } : r)));
  }, [commit]);

  // --- Calculs client (résumé + Sankey) ---
  const { summary, sankey } = useMemo(() => {
    const lines: BudgetLine[] = rows
      .filter((r) => r.name.trim() !== '' && r.monthlyAmount > 0)
      .map((r) => ({
        id: r.key, name: r.name.trim(), section: r.section, category: r.category,
        monthlyAmount: r.monthlyAmount, currency: r.currency, order: r.order,
      }));
    const s = summarizeBudget(lines, data.fx, data.strategy.monthlyInvest);
    return { summary: s, sankey: budgetSankey(lines, s, data.fx) };
  }, [rows, data.fx, data.strategy.monthlyInvest]);

  // --- Enregistrement ---
  const saveRow = useCallback((key: string) => {
    const run = async () => {
      const row = rowsRef.current.find((r) => r.key === key);
      if (!row || !row.dirty) return;
      const amount = parseAmount(row.amountText);
      if (amount === null) {
        patch(key, { fieldError: 'Montant invalide' });
        return;
      }
      const name = row.name.trim();
      if (!name) {
        if (row.id) patch(key, { status: 'error', message: 'Nom requis' });
        return;
      }
      const payload: BudgetLineInput = {
        ...(row.id ? { id: row.id } : {}),
        name, section: row.section, category: row.category, monthlyAmount: amount, currency: row.currency, order: row.order,
      };
      patch(key, { status: 'saving', message: undefined, fieldError: undefined, monthlyAmount: amount });
      let res: SaveResult;
      try {
        res = await actions.save(payload);
      } catch {
        res = { ok: false, error: 'Enregistrement impossible, réessaie dans un instant.' };
      }
      if (res.ok) {
        patch(key, (r) => ({
          id: res.id,
          status: 'saved',
          message: undefined,
          dirty: !(r.name.trim() === name && parseAmount(r.amountText) === amount && r.currency === payload.currency),
        }));
      } else {
        patch(key, { status: 'error', message: res.error });
      }
    };
    const chain = (chains.current[key] ?? Promise.resolve()).then(run);
    chains.current[key] = chain;
    return chain;
  }, [actions, patch]);

  // --- Édition ---
  const onName = (key: string, name: string) => patch(key, { name, dirty: true, status: 'idle', message: undefined });
  const onAmount = (key: string, text: string) => {
    const v = parseAmount(text);
    patch(key, {
      amountText: text, dirty: true, status: 'idle', message: undefined,
      ...(v !== null ? { monthlyAmount: v } : {}),
      fieldError: text.trim() !== '' && v === null ? 'Montant invalide' : undefined,
    });
  };
  const onCurrency = (key: string, currency: Currency) => {
    patch(key, { currency, dirty: true, status: 'idle', message: undefined });
    void saveRow(key);
  };

  const addLine = (section: Section, category: string) => {
    const order = rowsRef.current.reduce((m, r) => Math.max(m, r.order), 0) + 1;
    const key = `new-${++seq.current}`;
    commit([
      ...rowsRef.current,
      {
        key, name: '', section, category, currency: 'EUR', order, monthlyAmount: 0, amountText: '0',
        dirty: true, status: 'idle',
      },
    ]);
  };

  const removeLine = async (key: string) => {
    await (chains.current[key] as Promise<void> | undefined);
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row) return;
    if (!row.id) {
      commit(rowsRef.current.filter((r) => r.key !== key));
      return;
    }
    if (!window.confirm(`Supprimer « ${rowLabel(row)} » ?`)) return;
    patch(key, { status: 'saving', message: undefined });
    let res: ActionResult;
    try {
      res = await actions.remove(row.id);
    } catch {
      res = { ok: false, error: 'Suppression impossible, réessaie dans un instant.' };
    }
    if (res.ok) commit(rowsRef.current.filter((r) => r.key !== key));
    else patch(key, { status: 'error', message: res.error });
  };

  const moveLine = async (key: string, dir: -1 | 1) => {
    const all = rowsRef.current;
    const row = all.find((r) => r.key === key);
    if (!row) return;
    const group = all.filter((r) => r.section === row.section && r.category === row.category);
    const target = group[group.indexOf(row) + dir];
    if (!target) return;
    const next = [...all];
    const i = next.indexOf(row);
    const j = next.indexOf(target);
    [next[i], next[j]] = [next[j], next[i]];
    commit(next.map((r, order) => ({ ...r, order })));
    const ids = rowsRef.current.flatMap((r) => (r.id ? [r.id] : []));
    let res: ActionResult;
    try {
      res = await actions.reorder(ids);
    } catch {
      res = { ok: false, error: 'Réorganisation impossible, réessaie dans un instant.' };
    }
    patch(key, res.ok ? { status: 'saved', message: undefined } : { status: 'error', message: res.error });
  };

  // --- Catégories ---
  const categories = useMemo(() => {
    const names: string[] = [];
    for (const r of rows) if (r.section === tab && !names.includes(r.category)) names.push(r.category);
    for (const c of extraCats) if (c.section === tab && !names.includes(c.name)) names.push(c.name);
    return names;
  }, [rows, extraCats, tab]);

  const createCategory = (e: FormEvent) => {
    e.preventDefault();
    const name = catName.trim();
    if (!name || tab === 'invest') return;
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCatError('Cette catégorie existe déjà');
      return;
    }
    setExtraCats((c) => [...c, { section: tab, name }]);
    setCatName('');
    setCatError(null);
    setAddingCat(false);
  };

  const doExport = async () => {
    setExportMsg(null);
    const ok = await exportSankeyPng(sankeyRef.current);
    if (!ok) setExportMsg("Export impossible pour le moment.");
  };

  const ratePct = Math.round(summary.savingsRate * 100);

  return (
    <div className="flex flex-col gap-4">
      {data.stale ? (
        <div role="status" className="rounded-xl bg-loss-bg px-3 py-2 text-[13px] font-semibold text-loss">
          Données du {formatDateFr(data.asOf)}
        </div>
      ) : null}

      <p className="text-sm leading-relaxed text-muted">
        Ton budget type du mois. L&apos;épargne qui en sort alimente ton plan d&apos;investissement.
      </p>

      <div role="tablist" aria-label="Sections du budget" className="flex gap-1 rounded-full border border-border bg-card p-1">
        {TABS.map((t) => {
          const active = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { setTab(t.value); setAddingCat(false); setCatError(null); }}
              className={`min-h-11 flex-1 rounded-full px-2 text-[13px] font-semibold ${active ? 'bg-accent text-[#1A1A1A]' : 'text-muted'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'invest' ? (
        <InvestPanel data={data} />
      ) : (
        <>
          {categories.map((cat) => {
            const catRows = rows.filter((r) => r.section === tab && r.category === cat);
            const totalEur = catRows.reduce((s, r) => s + toEur(r.monthlyAmount, r.currency, data.fx), 0);
            const saving = catRows.some((r) => r.status === 'saving');
            const errored = catRows.find((r) => r.status === 'error');
            const pending = catRows.some((r) => r.dirty && r.status !== 'error');
            const status = saving
              ? 'Enregistrement…'
              : errored
                ? (errored.message ?? 'Erreur')
                : !pending && catRows.some((r) => r.status === 'saved')
                  ? 'Enregistré'
                  : '';
            return (
              <section key={`${tab}:${cat}`} aria-label={cat} className="flex flex-col gap-1 rounded-[18px] border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2 pb-1.5">
                  <h2 className="text-[15px] font-bold">{cat}</h2>
                  <Money eur={totalEur} className="text-[13px] font-semibold text-muted" />
                </div>

                {catRows.map((r, idx) => (
                  <div key={r.key} className="flex flex-col gap-0.5 border-b border-[#F1F2F4] py-1">
                    <div className="flex items-center gap-2">
                      <GripIcon />
                      <input
                        type="text"
                        aria-label={`Nom de ${r.name.trim() || (r.id ? 'la ligne' : 'la nouvelle ligne')}`}
                        value={r.name}
                        placeholder="Nom de la ligne"
                        autoFocus={!r.id && r.name === ''}
                        onChange={(e) => onName(r.key, e.target.value)}
                        onBlur={() => void saveRow(r.key)}
                        className="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-sm text-[#2A2F3A] outline-none focus:bg-background"
                      />
                      <IconButton label={`Supprimer ${rowLabel(r)}`} onClick={() => void removeLine(r.key)}>
                        <path d="M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3" />
                      </IconButton>
                    </div>
                    <div className="flex items-center gap-2 pl-[18px]">
                      <input
                        type={display.hidden ? 'password' : 'text'}
                        inputMode="decimal"
                        autoComplete="off"
                        data-1p-ignore
                        aria-label={`Montant ${rowLabel(r)}`}
                        aria-invalid={r.fieldError ? true : undefined}
                        value={r.amountText}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => onAmount(r.key, e.target.value)}
                        onBlur={() => void saveRow(r.key)}
                        className="min-h-11 w-28 rounded-lg bg-transparent px-1 text-right text-[15px] font-semibold outline-none focus:bg-background"
                      />
                      <select
                        aria-label={`Devise ${rowLabel(r)}`}
                        value={r.currency}
                        onChange={(e) => onCurrency(r.key, e.target.value as Currency)}
                        className="min-h-11 rounded-lg bg-transparent px-1 text-xs text-muted outline-none focus:bg-background"
                      >
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c === 'EUR' ? '€' : c}</option>)}
                      </select>
                      <span className="flex-1" />
                      <IconButton label={`Monter ${rowLabel(r)}`} disabled={idx === 0} onClick={() => void moveLine(r.key, -1)}>
                        <path d="M6 15l6-6 6 6" />
                      </IconButton>
                      <IconButton label={`Descendre ${rowLabel(r)}`} disabled={idx === catRows.length - 1} onClick={() => void moveLine(r.key, 1)}>
                        <path d="M6 9l6 6 6-6" />
                      </IconButton>
                    </div>
                    {r.fieldError ? <p className="pl-[18px] text-xs font-semibold text-loss">{r.fieldError}</p> : null}
                  </div>
                ))}

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => addLine(tab, cat)}
                    className="min-h-11 text-left text-sm font-semibold text-[#A24E0E]"
                  >
                    {`+ ${ADD_LABEL[tab]}`}
                  </button>
                  <span aria-live="polite" className={`text-xs ${errored ? 'font-semibold text-loss' : 'text-muted'}`}>{status}</span>
                </div>
              </section>
            );
          })}

          {addingCat ? (
            <form onSubmit={createCategory} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-4">
              <input
                type="text"
                aria-label="Nom de la catégorie"
                value={catName}
                autoFocus
                placeholder="Nom de la catégorie"
                onChange={(e) => { setCatName(e.target.value); setCatError(null); }}
                className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none"
              />
              {catError ? <p className="text-xs font-semibold text-loss">{catError}</p> : null}
              <div className="flex gap-2">
                <button type="submit" className="min-h-11 flex-1 rounded-full bg-accent text-[13px] font-bold text-[#1A1A1A]">
                  Créer la catégorie
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingCat(false); setCatName(''); setCatError(null); }}
                  className="min-h-11 flex-1 rounded-full border border-border text-[13px] font-semibold"
                >
                  Annuler
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCat(true)}
              className="min-h-11 self-start text-sm font-semibold text-[#3E4450]"
            >
              + Ajouter une catégorie
            </button>
          )}
        </>
      )}

      <section aria-label="Résumé" className="flex flex-col gap-3.5 rounded-[18px] border border-border bg-card p-[18px]">
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Revenus</span>
            <Money eur={summary.incomeEur} className="text-base font-extrabold" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Dépenses</span>
            <Money eur={summary.expensesEur} className="text-base font-extrabold" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Taux d&apos;épargne</span>
            <span className={`text-base font-extrabold ${ratePct >= 0 ? 'text-gain' : 'text-loss'}`}>
              {`${ratePct < 0 ? '−' : ''}${Math.abs(ratePct)} %`}
            </span>
          </div>
        </div>
        {summary.savingsEur >= 0 ? (
          <p className="text-sm leading-relaxed text-[#3E4450]">
            Tu épargnes <strong className="text-foreground"><Money eur={summary.savingsEur} /></strong> par mois. Tu en
            investis <strong className="text-foreground"><Money eur={summary.investEur} /></strong> selon ton plan, et{' '}
            <strong className="text-[#A24E0E]"><Money eur={summary.freeEur} /></strong> restent sur ton Épargne.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-[#3E4450]">
            Tes dépenses dépassent tes revenus de{' '}
            <strong className="text-loss"><Money eur={-summary.savingsEur} /></strong> par mois.
          </p>
        )}
      </section>

      <section aria-label="Flux du budget" className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card px-3 py-4">
        <h2 className="mx-1 text-[15px] font-bold">Où va ton argent</h2>
        <div ref={sankeyRef}>
          {sankey.links.length > 0 ? (
            <SankeyChart data={sankey} />
          ) : (
            <p className="px-1 py-6 text-center text-sm text-muted">
              Ajoute des revenus et des dépenses pour voir où va ton argent.
            </p>
          )}
        </div>
        <div className="flex gap-2 p-1">
          <button
            type="button"
            onClick={() => void doExport()}
            className="min-h-11 flex-1 rounded-full border border-[#E3E5EA] bg-card text-[13px] font-semibold"
          >
            Exporter le graphique
          </button>
          <Link
            href="/epargne"
            className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-accent px-2 text-[13px] font-bold text-[#1A1A1A]"
          >
            <span>Répartir mes <Money eur={summary.investEur} /></span>
          </Link>
        </div>
        <p role="status" className="px-1 text-xs font-semibold text-loss">{exportMsg}</p>
      </section>
    </div>
  );
}

function InvestPanel({ data }: { data: Dashboard }) {
  const { plan, assets } = data;
  const name = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  let title = 'Plan du mois';
  let items: { key: string; label: string; eur: number }[] | null = null;
  if (plan.validated && plan.lines.length > 0) {
    items = plan.lines.map((l) => ({ key: l.assetId, label: l.assetName, eur: l.plannedEur }));
  } else if (plan.proposal) {
    title = 'Proposition du mois (non validée)';
    items = plan.proposal.map((l) => ({ key: l.assetId, label: name(l.assetId), eur: l.amount }));
  }
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-[15px] font-bold">{title}</h2>
      {items ? (
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.key} className="flex min-h-11 items-center justify-between gap-3 border-b border-[#F1F2F4] text-sm">
              <span className="text-[#2A2F3A]">{it.label}</span>
              <Money eur={it.eur} className="font-semibold" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{plan.allocationError ?? "Aucun plan d'investissement pour ce mois."}</p>
      )}
      <p className="text-xs text-muted">
        Lecture seule : la répartition se règle dans{' '}
        <Link href="/epargne" className="font-semibold text-[#A24E0E] underline">Épargne</Link>.
      </p>
    </Card>
  );
}
