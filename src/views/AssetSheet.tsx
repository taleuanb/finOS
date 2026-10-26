'use client';

import { useId, useState, type FormEvent } from 'react';
import { INSTITUTIONS, isRealDate, type ActionResult, type AssetPatch } from '@/app/patrimoine/patrimoineOps';
import { parisDate } from '@/domain/dates';
import { ASSET_CLASSES, type Asset, type AssetClass, type AssetInput, type Currency } from '@/domain/types';
import { BottomSheet } from '@/ui/BottomSheet';
import { Segmented } from '@/ui/Segmented';
import {
  AmountInput, CURRENCY_SYMBOL, CurrencyField, Field, SecondaryButton, SheetFooter, inputClass, parseDecimal, useSubmit,
} from './formKit';

export interface AssetSheetActions {
  create: (input: AssetInput) => Promise<ActionResult>;
  update: (id: string, patch: AssetPatch) => Promise<ActionResult>;
  archive: (id: string, archived: boolean) => Promise<ActionResult>;
}

const OTHER = '__autre';
const METALS: AssetClass = 'Métaux précieux';
const MAX_NAME = 200;
const MAX_INSTITUTION = 60;

type Mode = 'auto' | 'manual';
type FieldKey = 'name' | 'quoteId' | 'manualValue' | 'manualValueDate' | 'fixedMonthly' | 'institutionOther';

const isKnownInstitution = (v: string | undefined) => (INSTITUTIONS as readonly string[]).includes(v ?? '');

/** Création (sans `asset`) ou modification d'un actif. Les montants sont saisis dans la devise de l'actif. */
export function AssetSheet({ asset, actions, onClose, onDone, onAddMovement }: {
  asset?: Asset;
  actions: AssetSheetActions;
  onClose: () => void;
  /** Appelé après un enregistrement réussi (la vue ferme la feuille et rafraîchit la route). */
  onDone: () => void;
  /** Modification seulement : ouvre la saisie d'un mouvement pour cet actif. */
  onAddMovement?: () => void;
}) {
  const formId = useId();
  const today = parisDate(new Date());
  // Valeurs de départ (texte des champs) : servent aussi à repérer les modifications non enregistrées.
  const [init] = useState(() => ({
    name: asset?.name ?? '',
    assetClass: asset?.assetClass ?? ('Autres' as AssetClass),
    subtype: asset?.subtype ?? '',
    institution: asset?.institution ? (isKnownInstitution(asset.institution) ? asset.institution : OTHER) : '',
    institutionOther: asset?.institution && !isKnownInstitution(asset.institution) ? asset.institution : '',
    currency: asset?.currency ?? ('EUR' as Currency),
    mode: asset?.mode ?? ('manual' as Mode),
    quoteId: asset?.quoteId ?? '',
    manualValue: asset?.manualValue !== undefined ? String(asset.manualValue) : '',
    manualValueDate: asset ? (asset.manualValueDate ?? '') : today,
    fixedMonthly: asset?.fixedMonthly !== undefined ? String(asset.fixedMonthly) : '',
  }));
  const [name, setName] = useState(init.name);
  const [assetClass, setAssetClass] = useState<AssetClass>(init.assetClass);
  const [subtype, setSubtype] = useState(init.subtype);
  const [institution, setInstitution] = useState(init.institution);
  const [institutionOther, setInstitutionOther] = useState(init.institutionOther);
  const [currency, setCurrency] = useState<Currency>(init.currency);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [quoteId, setQuoteId] = useState(init.quoteId);
  const [manualValue, setManualValue] = useState(init.manualValue);
  const [manualValueDate, setManualValueDate] = useState(init.manualValueDate);
  const [dateTouched, setDateTouched] = useState(false);
  const [fixedMonthly, setFixedMonthly] = useState(init.fixedMonthly);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const { pending, error, run } = useSubmit(onDone);

  const dirty = JSON.stringify(init) !== JSON.stringify({
    name, assetClass, subtype, institution, institutionOther, currency, mode, quoteId, manualValue, manualValueDate, fixedMonthly,
  });
  const suffix = CURRENCY_SYMBOL[currency];
  const isMetal = assetClass === METALS;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FieldKey, string>> = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > MAX_NAME) errs.name = 'Nom requis (200 caractères maximum)';

    const institutionValue = institution === OTHER ? institutionOther.trim() : institution;
    if (institution === OTHER && (!institutionValue || institutionValue.length > MAX_INSTITUTION)) {
      errs.institutionOther = `Établissement requis (${MAX_INSTITUTION} caractères maximum)`;
    }

    let quote: string | undefined;
    let value: number | undefined;
    let valueDate: string | undefined;
    if (mode === 'auto') {
      quote = quoteId.trim();
      if (!quote || /\s/.test(quote)) errs.quoteId = 'Identifiant de cotation requis (sans espace)';
      else if (isMetal && !['XAU', 'XAG'].includes(quote.toUpperCase())) errs.quoteId = 'Pour un métal précieux, saisis XAU (or) ou XAG (argent)';
      else if (isMetal) quote = quote.toUpperCase();
    } else {
      const v = parseDecimal(manualValue);
      if (v === null) errs.manualValue = 'Valeur invalide (nombre positif)';
      else value = v;
      // Valeur nouvelle ou modifiée sans toucher à la date : la valeur date d'aujourd'hui.
      valueDate = manualValueDate || undefined;
      if (v !== null && !dateTouched && (!asset || v !== asset.manualValue)) valueDate = today;
      if (valueDate !== undefined && !isRealDate(valueDate)) errs.manualValueDate = 'Date invalide';
    }

    let monthly: number | undefined;
    if (fixedMonthly.trim() !== '') {
      const m = parseDecimal(fixedMonthly);
      if (m === null) errs.fixedMonthly = 'Montant invalide (nombre positif)';
      else monthly = m;
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const next: AssetInput = {
      name: trimmedName, assetClass, currency, mode,
      ...(subtype.trim() ? { subtype: subtype.trim() } : {}),
      ...(institutionValue ? { institution: institutionValue } : {}),
      ...(mode === 'auto' ? { quoteId: quote } : { manualValue: value, manualValueDate: valueDate }),
      ...(monthly !== undefined ? { fixedMonthly: monthly } : {}),
    };

    if (!asset) {
      void run(() => actions.create(next));
      return;
    }
    // Modification : seuls les champs changés sont envoyés ; un champ optionnel vidé part avec `null`.
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'assetClass', 'subtype', 'institution', 'mode', 'quoteId', 'manualValue', 'manualValueDate', 'fixedMonthly'] as const) {
      const before = asset[k];
      const after = next[k];
      if (after === before || (after === undefined && before == null)) continue;
      if (after === undefined && (k === 'quoteId' || k === 'manualValue' || k === 'manualValueDate')) continue; // champ de l'autre mode
      patch[k] = after ?? null;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    void run(() => actions.update(asset.id, patch as AssetPatch));
  };

  const archive = () => {
    if (!asset || !window.confirm(`Archiver « ${asset.name} » ? Il disparaîtra du patrimoine.`)) return;
    void run(() => actions.archive(asset.id, true));
  };

  return (
    <BottomSheet
      open
      title={asset ? 'Modifier l’actif' : 'Nouvel actif'}
      onClose={onClose}
      footer={<SheetFooter formId={formId} pending={pending} error={error} onCancel={onClose} />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field label="Nom" error={errors.name}>
          {(a) => <input {...a} type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>

        <Field label="Classe">
          {(a) => (
            <select {...a} value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)} className={inputClass}>
              {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>

        <Field label="Sous-type">
          {(a) => <input {...a} type="text" autoComplete="off" value={subtype} onChange={(e) => setSubtype(e.target.value)} className={inputClass} />}
        </Field>

        <Field label="Établissement">
          {(a) => (
            <select {...a} value={institution} onChange={(e) => setInstitution(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {INSTITUTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
              <option value={OTHER}>Autre…</option>
            </select>
          )}
        </Field>
        {institution === OTHER ? (
          <Field label="Autre établissement" error={errors.institutionOther}>
            {(a) => (
              <input {...a} type="text" autoComplete="off" value={institutionOther} onChange={(e) => setInstitutionOther(e.target.value)} className={inputClass} />
            )}
          </Field>
        ) : null}

        <CurrencyField value={currency} onChange={setCurrency} locked={!!asset} />

        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Valorisation</span>
          <Segmented<Mode>
            ariaLabel="Valorisation"
            value={mode}
            onChange={setMode}
            options={[{ value: 'manual', label: 'Manuelle' }, { value: 'auto', label: 'Auto' }]}
          />
        </div>

        {mode === 'auto' ? (
          <Field
            label="Identifiant de cotation"
            error={errors.quoteId}
            hint="Ticker Yahoo (AAPL, IWDA.AS), id CoinGecko (bitcoin), XAU / XAG pour l’or et l’argent. La valeur apparaît à la prochaine synchronisation."
          >
            {(a) => <input {...a} type="text" autoComplete="off" autoCapitalize="off" value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className={inputClass} />}
          </Field>
        ) : (
          <>
            <Field label={`Valeur manuelle (${currency})`} suffix={suffix} error={errors.manualValue}>
              {(a) => <AmountInput aria={a} value={manualValue} onChange={setManualValue} />}
            </Field>
            <Field label="Date de la valeur" error={errors.manualValueDate}>
              {(a) => (
                <input
                  {...a}
                  type="date"
                  value={manualValueDate}
                  onChange={(e) => { setManualValueDate(e.target.value); setDateTouched(true); }}
                  className={inputClass}
                />
              )}
            </Field>
          </>
        )}

        <Field label={`Versement fixe mensuel (${currency})`} suffix={suffix} error={errors.fixedMonthly}>
          {(a) => <AmountInput aria={a} value={fixedMonthly} onChange={setFixedMonthly} />}
        </Field>
      </form>

      {asset ? (
        <div className="flex flex-col gap-2 pt-1">
          {onAddMovement ? (
            <>
              <SecondaryButton onClick={onAddMovement} disabled={pending || dirty} describedBy={dirty ? `${formId}-mouvement` : undefined}>
                Ajouter un mouvement
              </SecondaryButton>
              {dirty ? <p id={`${formId}-mouvement`} className="text-xs text-muted">Enregistre d’abord tes modifications</p> : null}
            </>
          ) : null}
          <SecondaryButton onClick={archive} disabled={pending} danger>Archiver</SecondaryButton>
        </div>
      ) : null}
    </BottomSheet>
  );
}
