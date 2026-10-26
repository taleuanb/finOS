'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { allocate } from '@/domain/allocation';
import { parisDate } from '@/domain/dates';
import { formatMoney, fromEur } from '@/domain/money';
import { AllocationError } from '@/domain/types';
import type { AllocationLine, Asset, Currency, FxRates } from '@/domain/types';
import type { Dashboard, PlanLineView } from '@/lib/dashboard';
import { StaleBanner } from '@/ui/StaleBanner';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { HIDDEN_TEXT, useDisplay } from '@/ui/display';
import { Money, formatDisplayMoney } from '@/ui/Money';
import { Segmented } from '@/ui/Segmented';
import { SplitBar } from '@/ui/charts/SplitBar';
import { StackedBars } from '@/ui/charts/StackedBars';

type ActionResult = { ok: true } | { ok: false; error: string };

export interface EpargneViewProps {
  data: Dashboard;
  validatePlan: (month: string, lines: AllocationLine[]) => Promise<ActionResult>;
  /** `quantity` : poids fin (métal, requis) ou nombre de parts / tokens (actif coté, facultatif). */
  declarePurchase: (assetId: string, month: string, amount: number, date: string, quantity?: number) => Promise<ActionResult>;
}

const METALS = 'Métaux précieux';
const GREEN = '#137A3A';
const ORANGE = '#EE8A3C';
const YELLOW = '#D1AE3A';
const GREY = '#D7DBE3';
const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] text-foreground';

/** « 100,5 » ou « 100.5 » → 100.5 ; null si vide ou illisible. */
function parseAmount(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const toField = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const cents = (n: number) => Math.round(n * 100);

const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: '€', MAD: 'MAD', USD: '$' };

/**
 * Les justifications de l'algorithme contiennent des montants en € (« Sous la cible de 841 € ») :
 * on les affiche dans la devise d'affichage, et masqués en mode masqué.
 */
function localizeReason(reason: string, d: { currency: Currency; hidden: boolean; fx: FxRates }): string {
  return reason.replace(/\d[\d\s]*(?:,\d+)?\s?€/g, (m) => {
    const n = Number(m.replace(/[^\d,]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? formatDisplayMoney(n, d) : HIDDEN_TEXT;
  });
}

function monthLong(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
}

/** Pastille du mois du plan (V1 : seul le mois courant est consultable, donc non interactive). */
export function MonthPill({ month }: { month: string }) {
  return (
    <span className="inline-flex h-10 items-center rounded-full border border-[#E3E5EA] bg-card px-3.5 text-[13px] font-semibold">
      {monthLong(month)}
    </span>
  );
}

function initials(name: string): string {
  const words = name.split(/[\s(]+/).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return s.toUpperCase();
}

function avatarStyle(asset: Asset | undefined, strategy: Dashboard['strategy']): { bg: string; fg: string } {
  if (asset?.id === strategy.goldAssetId) return { bg: '#FBF1D9', fg: '#7A5A0E' };
  if (asset?.id === strategy.silverAssetId) return { bg: '#EEF0F3', fg: '#3E4450' };
  switch (asset?.assetClass) {
    case 'Crypto': return { bg: '#2A1E4A', fg: '#FFFFFF' };
    case 'Startups': return { bg: '#F3E8FF', fg: '#6B21A8' };
    case 'PER':
    case 'Fonds & ETF': return { bg: '#FDECEC', fg: '#B42318' };
    default: return { bg: '#EEF0F3', fg: '#3E4450' };
  }
}

function Avatar({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 flex-none items-center justify-center rounded-full text-xs font-extrabold"
      style={{ background: bg, color: fg }}
    >
      {initials(name)}
    </span>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-xl bg-loss-bg px-3 py-2 text-[13px] font-semibold text-loss">{children}</p>;
}

// --- Feuille « Déclarer l'achat » ---------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function DeclareSheet({
  line, isMetal, askQuantity, currency, month, onClose, declarePurchase,
}: {
  line: PlanLineView; isMetal: boolean; askQuantity: boolean; currency: Currency; month: string; onClose: () => void;
  declarePurchase: EpargneViewProps['declarePurchase'];
}) {
  const uid = useId();
  const d = useDisplay();
  const dialogRef = useRef<HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);
  const [amount, setAmount] = useState(() => toField(fromEur(line.toInvestEur, currency, d.fx)));
  const [date, setDate] = useState(() => parisDate(new Date()));
  const [grams, setGrams] = useState('');
  const [units, setUnits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => { onCloseRef.current = onClose; });

  // Échap et piège du focus (Tab / Maj+Tab) : écouteur unique sur le document.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].sort((x, y) =>
        x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      if (items.length === 0) return void e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (value === null || value <= 0) return setError('Saisis un montant supérieur à 0.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Saisis une date valide.');
    let fineGrams: number | undefined;
    if (isMetal) {
      const g = parseAmount(grams);
      if (g === null || g <= 0) return setError('Le poids fin (en grammes) est requis pour un métal.');
      fineGrams = g;
    }
    let quantity: number | undefined;
    if (askQuantity && units.trim() !== '') {
      const q = parseAmount(units);
      if (q === null) return setError('Saisis une quantité valide (ou laisse le champ vide).');
      quantity = q;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = isMetal
          ? await declarePurchase(line.assetId, month, value, date, fineGrams)
          : quantity !== undefined
            ? await declarePurchase(line.assetId, month, value, date, quantity)
            : await declarePurchase(line.assetId, month, value, date);
        if (res.ok) onClose();
        else setError(res.error);
      } catch {
        setError("L'achat n'a pas pu être enregistré. Réessaie.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div data-backdrop className="absolute inset-0" aria-hidden="true" onClick={onClose} />
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onSubmit={submit}
        className="relative flex w-full max-w-[480px] flex-col gap-4 rounded-t-[20px] bg-card p-5 pb-8"
      >
        <h2 id={`${uid}-title`} className="text-[17px] font-bold">Déclarer l&apos;achat · {line.assetName}</h2>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted" htmlFor={`${uid}-amount`}>
          Montant ({CURRENCY_SYMBOL[currency]})
          <input
            id={`${uid}-amount`} className={FIELD} inputMode="decimal" autoFocus autoComplete="off"
            type={d.hidden ? 'password' : 'text'}
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {isMetal ? (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted" htmlFor={`${uid}-grams`}>
            Poids fin (g)
            <input
              id={`${uid}-grams`} className={FIELD} inputMode="decimal"
              value={grams} onChange={(e) => setGrams(e.target.value)}
            />
          </label>
        ) : null}
        {askQuantity ? (
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted" htmlFor={`${uid}-units`}>
              Quantité (parts / tokens)
              <input
                id={`${uid}-units`} className={FIELD} inputMode="decimal" autoComplete="off"
                aria-describedby={units.trim() === '' ? `${uid}-units-hint` : undefined}
                value={units} onChange={(e) => setUnits(e.target.value)}
              />
            </label>
            {units.trim() === '' ? (
              <span id={`${uid}-units-hint`} className="text-xs text-muted">Quantité à compléter dans Notion</span>
            ) : null}
          </div>
        ) : null}
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted" htmlFor={`${uid}-date`}>
          Date
          <input id={`${uid}-date`} type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-full border border-border bg-card text-[14px] font-semibold">
            Annuler
          </button>
          <button
            type="submit" disabled={pending}
            className="min-h-11 flex-1 rounded-full bg-foreground text-[14px] font-semibold text-white disabled:opacity-50"
          >
            Confirmer
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Plan validé -----------------------------------------------------------------------------------

function PlanRow({ line, asset, strategy, onDeclare }: {
  line: PlanLineView; asset: Asset | undefined; strategy: Dashboard['strategy']; onDeclare: (opener: HTMLElement) => void;
}) {
  const uid = useId();
  const d = useDisplay();
  const { bg, fg } = avatarStyle(asset, strategy);
  const declared = line.status === 'declared';
  return (
    <li aria-labelledby={uid} className="flex flex-col gap-2.5 border-t border-[#F1F2F4] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Avatar name={line.assetName} bg={bg} fg={fg} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={uid} className="text-[14px] font-bold">{line.assetName}</span>
          {line.plannedEur > 0 ? (
            <span className="text-xs text-muted">Prévu <Money eur={line.plannedEur} /> · {localizeReason(line.reason, d)}</span>
          ) : (
            <span className="text-xs text-muted">{localizeReason(line.reason, d)}</span>
          )}
        </div>
        {declared ? (
          <Badge tone="gain" className="whitespace-nowrap !px-2.5 !py-[5px] !text-xs">✓ Déclaré</Badge>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-[#FFE9D6] px-2.5 py-[5px] text-xs font-bold text-[#9A4A0E]">En attente</span>
        )}
      </div>
      {declared ? null : (
        <div className="flex items-center justify-between gap-2.5 rounded-xl bg-[#FFF6EE] px-3 py-2.5">
          <span className="text-[13px] text-[#3E4450]">
            À investir <strong className="text-foreground"><Money eur={line.toInvestEur} /></strong>
            {line.monthsAccrued > 0 ? (
              <span className="text-muted"> · {line.monthsAccrued} {line.monthsAccrued > 1 ? 'mois cumulés' : 'mois cumulé'}</span>
            ) : null}
          </span>
          <button
            type="button" onClick={(e) => onDeclare(e.currentTarget)}
            className="min-h-11 rounded-full bg-foreground px-3.5 text-xs font-semibold text-white"
          >
            Déclarer l&apos;achat
          </button>
        </div>
      )}
    </li>
  );
}

// --- Proposition à valider ------------------------------------------------------------------------

function Proposal({ data, validatePlan }: { data: Dashboard; validatePlan: EpargneViewProps['validatePlan'] }) {
  const d = useDisplay();
  const proposal = data.plan.proposal ?? [];
  const investEur = data.budget.investEur;
  const nameOf = (id: string) => data.assets.find((a) => a.id === id)?.name ?? id;
  const [fields, setFields] = useState(() => proposal.map((l) => toField(l.amount)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amounts = fields.map(parseAmount);
  const allValid = amounts.every((a) => a !== null);
  const total = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const totalOk = allValid && cents(total) === cents(investEur);

  function validate() {
    setError(null);
    startTransition(async () => {
      try {
        const toSend = proposal
          .map((l, i) => ({ ...l, amount: amounts[i] as number }))
          .filter((l) => l.amount > 0);
        const res = await validatePlan(data.plan.month, toSend);
        if (!res.ok) setError(res.error);
      } catch {
        setError("Le plan n'a pas pu être validé. Réessaie.");
      }
    });
  }

  return (
    <section aria-label="Proposition du mois" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card py-4">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-base font-bold">Proposition · <Money eur={investEur} /></h2>
        <span className="text-xs text-muted">modifiable</span>
      </div>
      <ul className="flex flex-col">
        {proposal.map((l, i) => {
          const asset = data.assets.find((a) => a.id === l.assetId);
          const { bg, fg } = avatarStyle(asset, data.strategy);
          return (
            <li key={l.assetId} className="flex items-center gap-3 border-t border-[#F1F2F4] px-4 py-3">
              <Avatar name={nameOf(l.assetId)} bg={bg} fg={fg} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-bold">{nameOf(l.assetId)}</span>
                <span className="text-xs text-muted">{localizeReason(l.reason, d)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={`Montant ${nameOf(l.assetId)}`}
                  inputMode="decimal"
                  autoComplete="off"
                  type={d.hidden ? 'password' : 'text'}
                  value={fields[i]}
                  onChange={(e) => setFields((f) => f.map((v, j) => (j === i ? e.target.value : v)))}
                  className="min-h-11 w-24 rounded-xl border border-border bg-background px-3 text-right text-[15px]"
                />
                <span aria-hidden="true" className="text-sm text-muted">€</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 px-4">
        {!totalOk ? (
          <p className="text-[13px] font-semibold text-loss">{`Total ≠ ${formatDisplayMoney(investEur, d)}`}</p>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <button
          type="button" onClick={validate} disabled={!totalOk || pending}
          className="min-h-11 rounded-full bg-foreground text-[14px] font-semibold text-white disabled:opacity-40"
        >
          Valider le plan
        </button>
      </div>
    </section>
  );
}

// --- Simulateur -------------------------------------------------------------------------------------

type SimMode = 'monthly' | 'yearly';

function Simulator({ data }: { data: Dashboard }) {
  const d = useDisplay();
  const [mode, setMode] = useState<SimMode>('monthly');
  const [amount, setAmount] = useState(String(Math.round(data.budget.investEur)));
  const nameOf = (id: string) => data.assets.find((a) => a.id === id)?.name ?? id;

  const result = useMemo((): { lines: AllocationLine[] } | { error: string } | null => {
    const parsed = parseAmount(amount);
    if (parsed === null || Math.round(parsed) <= 0) return null;
    try {
      const lines = allocate({
        amount: Math.round(parsed), months: mode === 'yearly' ? 12 : 1,
        assets: data.assets, strategy: data.strategy, ratio: data.metals.ratio, fx: data.fx,
      });
      return { lines };
    } catch (e) {
      if (e instanceof AllocationError) return { error: e.message };
      throw e;
    }
  }, [amount, mode, data.assets, data.strategy, data.metals.ratio, data.fx]);

  function changeMode(next: SimMode) {
    setMode(next);
    setAmount(String(Math.round(data.budget.investEur) * (next === 'yearly' ? 12 : 1)));
  }

  return (
    <section aria-label="Simulateur" className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card p-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Simulateur</h2>
        <span className="text-xs text-muted">sans rien écrire</span>
      </div>
      <Segmented
        ariaLabel="Période du simulateur" value={mode} onChange={changeMode}
        options={[{ value: 'monthly', label: 'Mensuel' }, { value: 'yearly', label: 'Annuel' }]}
      />
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
        Montant à investir
        <input
          className={FIELD} inputMode="numeric" autoComplete="off" type={d.hidden ? 'password' : 'text'}
          value={amount} onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {result && 'error' in result ? <ErrorText>{result.error}</ErrorText> : null}
      {result && 'lines' in result ? (
        <>
          <ul className="flex flex-col">
            {result.lines.map((l) => (
              <li key={l.assetId} className="flex items-start justify-between gap-3 border-t border-[#F1F2F4] py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-bold">{nameOf(l.assetId)}</span>
                  <span className="text-xs text-muted">{localizeReason(l.reason, d)}</span>
                </div>
                <span data-amount className="text-[14px] font-bold"><Money eur={l.amount} /></span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-[#F1F2F4] pt-2.5 text-[13px] font-semibold">
            <span>Total</span>
            <Money eur={result.lines.reduce((s, l) => s + l.amount, 0)} />
          </p>
        </>
      ) : null}
    </section>
  );
}

// --- Écran ----------------------------------------------------------------------------------------

export function EpargneView({ data, validatePlan, declarePurchase }: EpargneViewProps) {
  const d = useDisplay();
  const { plan, budget } = data;
  const [declaring, setDeclaring] = useState<PlanLineView | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  /** Ferme la feuille et rend le focus au bouton qui l'a ouverte (si toujours présent). */
  function closeSheet() {
    setDeclaring(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }
  const savingsAsset = data.assets.find((a) => a.id === data.strategy.savingsAssetId);
  const assetOf = (id: string) => data.assets.find((a) => a.id === id);

  const history = plan.history6.map((h) => {
    const invested = Math.max(0, Math.min(h.investedEur, h.savedEur));
    return {
      label: monthShort(h.month),
      parts: [
        { key: 'Investi', value: invested, color: GREEN },
        { key: 'Non investi', value: Math.max(0, h.savedEur - invested), color: GREY },
      ],
    };
  });

  return (
    <>
      <StaleBanner data={data} />

      <section aria-label="Épargne du mois" className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card px-[18px] py-5">
        <span className="text-sm font-medium text-muted">Épargne du mois</span>
        <Money eur={budget.savingsEur} className="text-4xl font-extrabold leading-none tracking-[-0.03em]" />
        <span className="text-[13px] text-muted">
          Revenus <Money eur={budget.incomeEur} /> − dépenses <Money eur={budget.expensesEur} /> ·{' '}
          <Link href="/budget" className="font-semibold text-[#A24E0E]">depuis ton budget</Link>
        </span>
        <SplitBar
          label="Répartition de l'épargne du mois"
          parts={[
            { value: plan.investedEur, color: GREEN, label: 'Investi' },
            { value: plan.pendingEur, color: ORANGE, label: 'En attente' },
            { value: plan.freeEur, color: YELLOW, label: 'Épargne libre' },
          ]}
        />
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Investi', color: GREEN, eur: plan.investedEur },
            { label: 'En attente', color: ORANGE, eur: plan.pendingEur },
            { label: 'Épargne libre', color: YELLOW, eur: plan.freeEur },
          ].map((k) => (
            <div key={k.label} className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: k.color }} />
                {k.label}
              </span>
              <Money eur={k.eur} className="text-[15px] font-bold" />
            </div>
          ))}
        </div>
      </section>

      {plan.allocationError ? (
        <div role="alert" className="flex flex-col gap-2 rounded-[20px] bg-loss-bg p-4 text-loss">
          <p className="text-[14px] font-bold">{plan.allocationError}</p>
          <Link href="/strategie" className="inline-flex min-h-11 items-center text-[13px] font-semibold underline">
            Régler la stratégie
          </Link>
        </div>
      ) : (
        <Link href="/strategie" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-[#A24E0E]">
          Régler la stratégie
        </Link>
      )}

      {!plan.validated && plan.proposal ? <Proposal key={plan.month} data={data} validatePlan={validatePlan} /> : null}

      {plan.validated || plan.lines.length > 0 ? (
        <section
          aria-label={plan.validated ? "Plan d'investissement" : 'Reliquats à investir'}
          className="overflow-hidden rounded-[20px] border border-border bg-card"
        >
          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            {plan.validated ? (
              <>
                <h2 className="text-base font-bold">Plan d&apos;investissement · <Money eur={budget.investEur} /></h2>
                <span className="text-xs text-muted">selon tes cibles</span>
              </>
            ) : (
              <>
                <h2 className="text-base font-bold">Reliquats à investir</h2>
                <span className="text-xs text-muted">mois précédents</span>
              </>
            )}
          </div>
          <ul>
            {plan.lines.map((l) => (
              <PlanRow
                key={l.assetId} line={l} asset={assetOf(l.assetId)} strategy={data.strategy}
                onDeclare={(opener) => { openerRef.current = opener; setDeclaring(l); }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Compte Épargne" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-[18px]">
        <div className="flex items-center gap-3">
          <Avatar name="Épargne" bg="#FBF1D9" fg="#7A5A0E" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold">{savingsAsset?.name ?? 'Épargne'}</span>
            {savingsAsset && savingsAsset.currency !== 'EUR' && savingsAsset.value !== undefined ? (
              <span className="text-xs text-muted">
                {d.hidden ? HIDDEN_TEXT : formatMoney(savingsAsset.value, savingsAsset.currency)}
              </span>
            ) : null}
          </div>
          <Money eur={plan.savings.balanceEur} className="text-lg font-extrabold" />
        </div>
        <SplitBar
          label="Épargne réservée et libre"
          parts={[
            { value: plan.savings.reservedEur, color: ORANGE, label: 'Réservé au plan' },
            { value: Math.max(0, plan.savings.freeEur), color: '#F1E4B6', label: 'Libre' },
          ]}
        />
        <div className="flex justify-between text-[13px] text-[#3E4450]">
          <span>Réservé au plan <strong className="text-[#A24E0E]"><Money eur={plan.savings.reservedEur} /></strong></span>
          <span>Libre <strong className="text-foreground"><Money eur={plan.savings.freeEur} /></strong></span>
        </div>
        <p className="border-t border-[#F1F2F4] pt-3 text-xs leading-relaxed text-muted">
          Un montant prévu mais pas déclaré reste sur ton Épargne, réservé à son actif, et s&apos;ajoute au mois suivant.
        </p>
      </section>

      <Card className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">6 derniers mois</h2>
          <span className="text-xs text-muted">épargné vs investi</span>
        </div>
        <StackedBars data={history} label="Épargne des six derniers mois, part investie et non investie" />
        <div className="flex gap-4 text-xs text-[#3E4450]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: GREEN }} />Investi
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: GREY }} />Non investi
          </span>
        </div>
      </Card>

      <Simulator data={data} />

      {declaring ? (
        <DeclareSheet
          key={declaring.assetId}
          line={declaring}
          isMetal={assetOf(declaring.assetId)?.assetClass === METALS}
          askQuantity={assetOf(declaring.assetId)?.mode === 'auto' && assetOf(declaring.assetId)?.assetClass !== METALS}
          currency={assetOf(declaring.assetId)?.currency ?? 'EUR'}
          month={plan.month}
          onClose={closeSheet}
          declarePurchase={declarePurchase}
        />
      ) : null}
    </>
  );
}
