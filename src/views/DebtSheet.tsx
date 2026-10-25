'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { DEBT_TYPES, isRealDate, type ActionResult, type DebtPatch } from '@/app/patrimoine/patrimoineOps';
import type { Asset, Currency, Debt, DebtInput } from '@/domain/types';
import { BottomSheet } from '@/ui/BottomSheet';
import {
  AmountInput, CURRENCY_SYMBOL, CurrencyField, Field, SecondaryButton, SheetFooter, inputClass, parseDecimal, useSubmit,
} from './formKit';

export interface DebtSheetActions {
  create: (input: DebtInput) => Promise<ActionResult>;
  update: (id: string, patch: DebtPatch) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}

const MAX_NAME = 200;

type FieldKey = 'name' | 'outstanding' | 'rate' | 'monthly' | 'endDate';

/** Création (sans `debt`) ou modification d'un crédit. Les montants sont saisis dans la devise du crédit. */
export function DebtSheet({ debt, assets, actions, onClose, onDone }: {
  debt?: Debt;
  assets: Pick<Asset, 'id' | 'name' | 'assetClass'>[];
  actions: DebtSheetActions;
  onClose: () => void;
  onDone: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(debt?.name ?? '');
  const [type, setType] = useState(debt?.type ?? '');
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'EUR');
  const [outstanding, setOutstanding] = useState(debt ? String(debt.outstanding) : '');
  const [rate, setRate] = useState(debt?.rate !== undefined ? String(debt.rate) : '');
  const [monthly, setMonthly] = useState(debt?.monthly !== undefined ? String(debt.monthly) : '');
  const [endDate, setEndDate] = useState(debt?.endDate ?? '');
  const [financedAssetId, setFinancedAssetId] = useState(debt?.financedAssetId ?? '');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const { pending, error, run } = useSubmit(onDone);

  // Immobilier d'abord (cas courant), puis les autres actifs.
  const sortedAssets = useMemo(
    () => [...assets].sort((a, b) => Number(b.assetClass === 'Immobilier') - Number(a.assetClass === 'Immobilier')),
    [assets],
  );
  const financedMissing = !!debt?.financedAssetId && !assets.some((a) => a.id === debt.financedAssetId);
  const typeKnown = !debt?.type || (DEBT_TYPES as readonly string[]).includes(debt.type);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FieldKey, string>> = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > MAX_NAME) errs.name = 'Nom requis (200 caractères maximum)';
    const principal = parseDecimal(outstanding);
    if (principal === null) errs.outstanding = 'Capital invalide (nombre positif)';
    let rateValue: number | undefined;
    if (rate.trim() !== '') {
      const r = parseDecimal(rate);
      if (r === null || r > 100) errs.rate = 'Taux invalide (entre 0 et 100)';
      else rateValue = r;
    }
    let monthlyValue: number | undefined;
    if (monthly.trim() !== '') {
      const m = parseDecimal(monthly);
      if (m === null) errs.monthly = 'Mensualité invalide (nombre positif)';
      else monthlyValue = m;
    }
    if (endDate && !isRealDate(endDate)) errs.endDate = 'Date invalide';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || principal === null) return;

    const next: DebtInput = {
      name: trimmedName, currency, outstanding: principal,
      ...(type ? { type } : {}),
      ...(rateValue !== undefined ? { rate: rateValue } : {}),
      ...(monthlyValue !== undefined ? { monthly: monthlyValue } : {}),
      ...(endDate ? { endDate } : {}),
      ...(financedAssetId ? { financedAssetId } : {}),
    };

    if (!debt) {
      void run(() => actions.create(next));
      return;
    }
    // Modification : seuls les champs changés sont envoyés ; un champ optionnel vidé part avec `null`.
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'type', 'outstanding', 'rate', 'monthly', 'endDate', 'financedAssetId'] as const) {
      const before = debt[k];
      const after = next[k];
      if (after === before || (after === undefined && before == null)) continue;
      patch[k] = after ?? null;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    void run(() => actions.update(debt.id, patch as DebtPatch));
  };

  const remove = () => {
    if (!debt || !window.confirm(`Supprimer « ${debt.name} » ?`)) return;
    void run(() => actions.remove(debt.id), 'Suppression impossible, réessaie dans un instant.');
  };

  const suffix = CURRENCY_SYMBOL[currency];

  return (
    <BottomSheet
      open
      title={debt ? 'Modifier le crédit' : 'Nouveau crédit'}
      onClose={onClose}
      footer={<SheetFooter formId={formId} pending={pending} error={error} onCancel={onClose} />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field label="Nom" error={errors.name}>
          {(a) => <input {...a} type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Type">
          {(a) => (
            <select {...a} value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {!typeKnown ? <option value={debt?.type}>{debt?.type}</option> : null}
              {DEBT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </Field>
        <CurrencyField value={currency} onChange={setCurrency} locked={!!debt} />
        <Field label={`Capital restant dû (${currency})`} suffix={suffix} error={errors.outstanding}>
          {(a) => <AmountInput aria={a} value={outstanding} onChange={setOutstanding} />}
        </Field>
        <Field label="Taux (%)" error={errors.rate}>
          {(a) => <AmountInput aria={a} value={rate} onChange={setRate} />}
        </Field>
        <Field label={`Mensualité (${currency})`} suffix={suffix} error={errors.monthly}>
          {(a) => <AmountInput aria={a} value={monthly} onChange={setMonthly} />}
        </Field>
        <Field label="Date de fin" error={errors.endDate}>
          {(a) => <input {...a} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Actif financé">
          {(a) => (
            <select {...a} value={financedAssetId} onChange={(e) => setFinancedAssetId(e.target.value)} className={inputClass}>
              <option value="">Aucun</option>
              {financedMissing ? <option value={debt?.financedAssetId}>Actif archivé</option> : null}
              {sortedAssets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
      </form>

      {debt ? (
        <div className="pt-1">
          <SecondaryButton onClick={remove} disabled={pending} danger>Supprimer</SecondaryButton>
        </div>
      ) : null}
    </BottomSheet>
  );
}
