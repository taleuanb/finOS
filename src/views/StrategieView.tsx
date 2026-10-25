'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Asset, AssetClass } from '@/domain/types';
import type { Dashboard } from '@/lib/dashboard';
import { useDisplay } from '@/ui/display';
import { PILOTABLE_CLASSES, type ActionResult, type MetalGridZoneInput } from '@/app/strategie/strategieOps';

export interface StrategieActions {
  saveMonthlyInvest: (amount: number) => Promise<ActionResult>;
  saveTarget: (assetClass: AssetClass, percent: number | null, mainAssetId: string | null) => Promise<ActionResult>;
  saveSpecialAssets: (p: { goldAssetId?: string | null; silverAssetId?: string | null; savingsAssetId?: string | null }) => Promise<ActionResult>;
  saveMetalGrid: (zones: MetalGridZoneInput[]) => Promise<ActionResult>;
}

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] text-foreground';
const GENERIC_ERROR = "L'enregistrement a échoué. Réessaie dans un instant.";
const METALS: AssetClass = 'Métaux précieux';
const MAX_ZONES = 8;

/** « 12,5 » ou « 12.5 » → 12.5 ; null si vide ou illisible. */
function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toField = (n: number) => String(round2(n)).replace('.', ',');

// --- Section : formulaire, état d'enregistrement et message (aria-live) ---

type Feedback = { kind: 'idle' } | { kind: 'saved'; text: string } | { kind: 'error'; text: string };
type Outcome = { ok: true; text?: string } | { ok: false; error: string };

function useSection() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => setFeedback((f) => (f.kind === 'idle' ? f : { kind: 'idle' })), []);

  const run = useCallback(async (task: () => Promise<Outcome>) => {
    setSaving(true);
    setFeedback({ kind: 'idle' });
    let outcome: Outcome;
    try {
      outcome = await task();
    } catch {
      outcome = { ok: false, error: GENERIC_ERROR };
    }
    setSaving(false);
    if (outcome.ok) {
      setFeedback({ kind: 'saved', text: outcome.text ?? 'Enregistré' });
      router.refresh();
    } else {
      setFeedback({ kind: 'error', text: outcome.error });
    }
  }, [router]);

  return { feedback, saving, reset, run };
}

function Section({ title, hint, section, onSave, children }: {
  title: string; hint?: string; section: ReturnType<typeof useSection>; onSave: () => void; children: ReactNode;
}) {
  const id = useId();
  const { feedback, saving } = section;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!saving) onSave();
  }
  return (
    <section aria-labelledby={id} className="rounded-[20px] border border-border bg-card p-4">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-base font-bold">{title}</h2>
          {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
        </div>
        {children}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-full bg-accent px-6 text-[14px] font-bold text-[#1A1A1A] disabled:opacity-50"
          >
            Enregistrer
          </button>
          <p
            role="status"
            aria-live="polite"
            className={`text-[13px] font-semibold ${feedback.kind === 'error' ? 'text-loss' : 'text-gain'}`}
          >
            {feedback.kind === 'idle' ? '' : feedback.text}
          </p>
        </div>
      </form>
    </section>
  );
}

function AssetSelect({ label, value, assets, onChange }: {
  label: string; value: string; assets: Asset[]; onChange: (v: string) => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      <option value="">Aucun</option>
      {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

// --- Investissement mensuel ---

function MonthlyInvest({ data, actions }: { data: Dashboard; actions: StrategieActions }) {
  const { hidden } = useDisplay();
  const section = useSection();
  const [text, setText] = useState(() => toField(data.strategy.monthlyInvest));
  const id = useId();

  return (
    <Section
      title="Investissement mensuel"
      hint="Montant que le plan répartit chaque mois entre tes cibles."
      section={section}
      onSave={() => section.run(async () => {
        const amount = parseNumber(text);
        if (amount === null) return { ok: false, error: 'Montant invalide' };
        const res = await actions.saveMonthlyInvest(amount);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      })}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-muted">Montant mensuel à investir</label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type={hidden ? 'password' : 'text'}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => { setText(e.target.value); section.reset(); }}
            className={FIELD}
          />
          <span aria-hidden="true" className="text-[15px] font-semibold text-foreground">€</span>
        </div>
      </div>
    </Section>
  );
}

// --- Cibles par classe ---

interface TargetRow { percent: string; main: string }
interface TargetBase { percent: number | null; main: string | null }

function Targets({ data, actions }: { data: Dashboard; actions: StrategieActions }) {
  const { strategy, assets } = data;
  const section = useSection();
  const assetsOf = (cls: AssetClass) => assets.filter((a) => a.assetClass === cls && !a.archived);

  const [base, setBase] = useState<Record<string, TargetBase>>(() => Object.fromEntries(
    PILOTABLE_CLASSES.map((cls) => {
      const t = strategy.targets[cls];
      return [cls, { percent: t === undefined ? null : round2(t * 100), main: cls === METALS ? null : strategy.mainAssetByClass[cls] ?? null }];
    }),
  ));
  const [rows, setRows] = useState<Record<string, TargetRow>>(() => Object.fromEntries(
    PILOTABLE_CLASSES.map((cls) => {
      const t = strategy.targets[cls];
      const main = cls === METALS ? undefined : strategy.mainAssetByClass[cls];
      return [cls, {
        percent: t === undefined ? '' : toField(t * 100),
        main: main && assetsOf(cls).some((a) => a.id === main) ? main : '',
      }];
    }),
  ));

  const patch = (cls: AssetClass, p: Partial<TargetRow>) => {
    setRows((r) => ({ ...r, [cls]: { ...r[cls], ...p } }));
    section.reset();
  };

  const parsed = PILOTABLE_CLASSES.map((cls) => ({ cls, text: rows[cls].percent.trim(), value: parseNumber(rows[cls].percent) }));
  const total = round2(parsed.reduce((s, p) => s + (p.value ?? 0), 0));
  const gap = round2(100 - total);

  async function save(): Promise<Outcome> {
    const changes: { cls: AssetClass; percent: number | null; main: string | null; delta: number }[] = [];
    for (const { cls, text, value } of parsed) {
      if (text !== '' && value === null) return { ok: false, error: `Pourcentage invalide pour ${cls}` };
      const b = base[cls];
      const main = rows[cls].main || null;
      if (value === null) {
        if (b.percent !== null) changes.push({ cls, percent: null, main: null, delta: -b.percent });
        else if (main !== null && main !== b.main) return { ok: false, error: `Indique le pourcentage de la cible ${cls}` };
      } else if (value !== b.percent || main !== b.main) {
        changes.push({ cls, percent: value, main, delta: value - (b.percent ?? 0) });
      }
    }
    if (total > 100) return { ok: false, error: 'Le total des cibles dépasse 100 %, corrige avant d’enregistrer' };
    if (changes.length === 0) return { ok: true, text: 'Aucun changement' };

    // Les baisses d'abord : la somme des cibles reste ≤ 100 % à chaque étape côté serveur.
    changes.sort((a, b) => a.delta - b.delta);
    for (const c of changes) {
      const res = await actions.saveTarget(c.cls, c.percent, c.main);
      if (!res.ok) return { ok: false, error: res.error };
      setBase((b) => ({ ...b, [c.cls]: { percent: c.percent, main: c.percent === null ? null : c.main } }));
    }
    return { ok: true };
  }

  return (
    <Section
      title="Cibles par classe"
      hint="Part visée de ton patrimoine investissable, et actif qui reçoit les versements de la classe."
      section={section}
      onSave={() => section.run(save)}
    >
      <ul className="flex flex-col gap-3">
        {PILOTABLE_CLASSES.map((cls) => {
          const row = rows[cls];
          const value = parseNumber(row.percent);
          const needsMain = cls !== METALS && value !== null && value > 0 && row.main === '';
          return (
            <li key={cls} aria-label={cls} className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-[14px] font-semibold">{cls}</span>
                <span className="flex w-24 shrink-0 items-center gap-1.5">
                  <input
                    aria-label={`Cible ${cls} (%)`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.percent}
                    onChange={(e) => patch(cls, { percent: e.target.value })}
                    className={`${FIELD} text-right`}
                  />
                  <span aria-hidden="true" className="text-[14px] text-muted">%</span>
                </span>
              </div>
              {cls === METALS ? (
                <p className="text-xs text-muted">Les achats d’or et d’argent suivent la grille ci-dessous.</p>
              ) : (
                <>
                  <AssetSelect
                    label={`Actif principal ${cls}`}
                    value={row.main}
                    assets={assetsOf(cls)}
                    onChange={(v) => patch(cls, { main: v })}
                  />
                  {needsMain ? <p className="text-xs font-semibold text-loss">Choisis un actif principal</p> : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-bold">{`Total des cibles : ${toField(total)} %`}</p>
        {gap > 0 ? (
          <p role="status" className="text-[13px] font-semibold text-loss">{`Il manque ${toField(gap)} % pour atteindre 100 %`}</p>
        ) : null}
        {gap < 0 ? (
          <p role="status" className="text-[13px] font-semibold text-loss">{`Le total dépasse 100 % de ${toField(-gap)} %`}</p>
        ) : null}
      </div>
    </Section>
  );
}

// --- Actifs spéciaux ---

function SpecialAssets({ data, actions }: { data: Dashboard; actions: StrategieActions }) {
  const { strategy, assets } = data;
  const section = useSection();
  const ofClass = (cls: AssetClass) => assets.filter((a) => a.assetClass === cls && !a.archived);
  const initial = (id: string | undefined, cls: AssetClass) => (id && ofClass(cls).some((a) => a.id === id) ? id : '');
  const [gold, setGold] = useState(() => initial(strategy.goldAssetId, METALS));
  const [silver, setSilver] = useState(() => initial(strategy.silverAssetId, METALS));
  const [savings, setSavings] = useState(() => initial(strategy.savingsAssetId, 'Épargne'));

  const field = (label: string, value: string, set: (v: string) => void, cls: AssetClass) => (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
      {label}
      <AssetSelect label={`Actif ${label.toLowerCase()}`} value={value} assets={ofClass(cls)} onChange={(v) => { set(v); section.reset(); }} />
    </label>
  );

  return (
    <Section
      title="Actifs spéciaux"
      hint="Les actifs que le plan utilise pour l’or, l’argent et l’épargne."
      section={section}
      onSave={() => section.run(async () => {
        const res = await actions.saveSpecialAssets({
          goldAssetId: gold || null, silverAssetId: silver || null, savingsAssetId: savings || null,
        });
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      })}
    >
      {field('Or', gold, setGold, METALS)}
      {field('Argent', silver, setSilver, METALS)}
      {field('Épargne', savings, setSavings, 'Épargne')}
    </Section>
  );
}

// --- Grille or / argent ---

interface GridRow { label: string; max: string; gold: string }

function MetalGrid({ data, actions }: { data: Dashboard; actions: StrategieActions }) {
  const { gridWarnings } = data.strategy;
  const section = useSection();
  const [rows, setRows] = useState<GridRow[]>(() => data.strategy.metalGrid.map((z) => ({
    label: z.label,
    max: Number.isFinite(z.max) ? toField(z.max) : '',
    gold: toField(z.goldShare * 100),
  })));

  const patch = (i: number, p: Partial<GridRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
    section.reset();
  };
  const add = () => {
    setRows((rs) => {
      if (rs.length >= MAX_ZONES) return rs;
      const previous = rs.length >= 2 ? parseNumber(rs[rs.length - 2].max) : 0;
      const row: GridRow = { label: `Zone ${rs.length + 1}`, max: previous === null ? '' : toField(previous + 10), gold: '50' };
      return [...rs.slice(0, -1), row, ...rs.slice(-1)];
    });
    section.reset();
  };
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    section.reset();
  };

  async function save(): Promise<Outcome> {
    const zones: MetalGridZoneInput[] = [];
    let min = 0;
    for (const [i, r] of rows.entries()) {
      const last = i === rows.length - 1;
      const goldPercent = parseNumber(r.gold);
      if (goldPercent === null) return { ok: false, error: 'Part d’or invalide' };
      let max: number | null = null;
      if (!last) {
        max = parseNumber(r.max);
        if (max === null) return { ok: false, error: 'Seuil invalide' };
        if (max <= min) return { ok: false, error: 'Chaque seuil doit être supérieur au précédent' };
      }
      zones.push({ label: r.label, min, max, goldPercent });
      if (max !== null) min = max;
    }
    const res = await actions.saveMetalGrid(zones);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  return (
    <Section
      title="Grille or / argent"
      hint="Selon le ratio or/argent, la part du versement métaux qui part dans l’or. Chaque zone commence où la précédente s’arrête."
      section={section}
      onSave={() => section.run(save)}
    >
      {gridWarnings && gridWarnings.length > 0 ? (
        <p className="text-[13px] font-semibold text-loss">
          {`Zones illisibles dans Notion : ${gridWarnings.join(', ')}. Elles seront supprimées à l’enregistrement.`}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const last = i === rows.length - 1;
          const from = i === 0 ? '0' : rows[i - 1].max.trim() || '…';
          return (
            <li key={i} aria-label={`Zone ${i + 1}`} className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Libellé zone ${i + 1}`}
                  value={r.label}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => patch(i, { label: e.target.value })}
                  className={FIELD}
                />
                <button
                  type="button"
                  aria-label={`Retirer la zone ${i + 1}`}
                  disabled={rows.length <= 2}
                  onClick={() => remove(i)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[18px] text-muted disabled:opacity-30"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <span>{`De ${from} à`}</span>
                {last ? (
                  <span className="font-semibold text-foreground">et plus</span>
                ) : (
                  <input
                    aria-label={`Maximum zone ${i + 1}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={r.max}
                    onChange={(e) => patch(i, { max: e.target.value })}
                    className={`${FIELD} w-24 text-right`}
                  />
                )}
                <span className="ml-auto">Part d’or</span>
                <input
                  aria-label={`Part d’or zone ${i + 1} (%)`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={r.gold}
                  onChange={(e) => patch(i, { gold: e.target.value })}
                  className={`${FIELD} w-20 text-right`}
                />
                <span aria-hidden="true">%</span>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={rows.length >= MAX_ZONES}
        onClick={add}
        className="min-h-11 self-start rounded-full border border-border px-4 text-[13px] font-semibold disabled:opacity-40"
      >
        Ajouter une zone
      </button>
    </Section>
  );
}

export function StrategieView({ data, actions }: { data: Dashboard; actions: StrategieActions }) {
  return (
    <>
      <Link href="/epargne" className="inline-flex min-h-11 items-center self-start text-[14px] font-semibold text-[#A24E0E]">
        ← Épargne
      </Link>
      <MonthlyInvest data={data} actions={actions} />
      <Targets data={data} actions={actions} />
      <SpecialAssets data={data} actions={actions} />
      <MetalGrid data={data} actions={actions} />
    </>
  );
}
