'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import type { Currency } from '@/domain/types';
import type { ActionResult } from '@/app/patrimoine/patrimoineOps';
import { useDisplay } from '@/ui/display';

/** Éléments communs aux feuilles de formulaire (actif, mouvement, crédit). */

export const SAVE_FAILED = 'Enregistrement impossible, réessaie dans un instant.';

export const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: '€', MAD: 'MAD', USD: '$' };

/** « 12,5 » ou « 12.5 » → 12.5 ; espaces (y compris insécables) et virgule finale tolérés. Vide ou illisible : null. */
export function parseDecimal(text: string): number | null {
  const t = text.replace(/[\s  ]/g, '').replace(/[.,]$/, '');
  if (!/^\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Date saisie (`type="date"`) : 'AAAA-MM-JJ' réelle ou non. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-[15px] aria-[invalid=true]:border-loss';

export interface FieldAria { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }

/** Champ étiqueté : `<label>` lié, aide, message d'erreur relié par `aria-describedby`, suffixe facultatif (devise). */
export function Field({ label, error, hint, suffix, children }: {
  label: string; error?: string; hint?: string; suffix?: string; children: (aria: FieldAria) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-erreur`;
  const hintId = `${id}-aide`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      <div className="flex items-center gap-2">
        {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
        {suffix ? <span aria-hidden="true" className="flex-none text-[13px] font-semibold text-muted">{suffix}</span> : null}
      </div>
      {hint ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={errId} className="text-xs font-semibold text-loss">{error}</p> : null}
    </div>
  );
}

/** Champ numérique : texte avec clavier décimal ; `type="password"` en mode masqué (le montant n'est jamais en clair). */
export function AmountInput({ aria, value, onChange }: { aria: FieldAria; value: string; onChange: (v: string) => void }) {
  const { hidden } = useDisplay();
  return (
    <input
      {...aria}
      type={hidden ? 'password' : 'text'}
      inputMode="decimal"
      autoComplete="off"
      data-1p-ignore
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

/**
 * Envoi d'une action : un seul envoi à la fois, erreur conservée (la saisie reste dans la feuille),
 * exception réseau ramenée à un message générique. En cas de succès, `onDone` ferme la feuille.
 */
export function useSubmit(onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = async (call: () => Promise<ActionResult>, failure: string = SAVE_FAILED) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    let res: ActionResult;
    try {
      res = await call();
    } catch {
      res = { ok: false, error: failure };
    }
    if (res.ok) {
      onDone();
      return;
    }
    busy.current = false;
    setPending(false);
    setError(res.error);
  };
  return { pending, error, run };
}

/** Pied de feuille : erreur d'envoi (annoncée) puis Annuler / Enregistrer (bouton lié au formulaire par `form`). */
export function SheetFooter({ formId, pending, error, onCancel }: {
  formId: string; pending: boolean; error: string | null; onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {error ? <p role="alert" className="text-[13px] font-semibold text-loss">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="min-h-11 flex-1 rounded-full border border-border text-[14px] font-bold disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="min-h-11 flex-1 rounded-full bg-accent text-[14px] font-bold text-[#1A1A1A] disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

/** Bouton secondaire de la feuille (Archiver, Supprimer, Ajouter un mouvement). */
export function SecondaryButton({ children, onClick, disabled, danger }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 w-full rounded-full border border-border text-[14px] font-bold disabled:opacity-50 ${danger ? 'text-loss' : ''}`}
    >
      {children}
    </button>
  );
}
