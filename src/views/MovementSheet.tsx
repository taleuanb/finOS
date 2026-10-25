'use client';

import { useId, useState, type FormEvent } from 'react';
import type { ActionResult, MovementInput } from '@/app/patrimoine/patrimoineOps';
import { parisDate } from '@/domain/dates';
import type { Asset } from '@/domain/types';
import { BottomSheet } from '@/ui/BottomSheet';
import { Segmented } from '@/ui/Segmented';
import { AmountInput, CURRENCY_SYMBOL, Field, SheetFooter, inputClass, isIsoDate, parseDecimal, useSubmit } from './formKit';

export interface MovementSheetActions {
  add: (m: MovementInput) => Promise<ActionResult>;
}

type FieldKey = 'date' | 'quantity' | 'amount';

/** Achat ou vente d'un actif. Le montant est saisi dans la devise de l'actif ; la quantité est le poids fin (g) pour un métal. */
export function MovementSheet({ asset, actions, onClose, onDone }: {
  asset: Pick<Asset, 'id' | 'name' | 'assetClass' | 'currency'>;
  actions: MovementSheetActions;
  onClose: () => void;
  onDone: () => void;
}) {
  const formId = useId();
  const [kind, setKind] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(() => parisDate(new Date()));
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const { pending, error, run } = useSubmit(onDone);

  const isMetal = asset.assetClass === 'Métaux précieux';
  const quantityLabel = isMetal ? 'Poids fin (g)' : 'Quantité (parts / unités)';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!isIsoDate(date)) errs.date = 'Date invalide';
    const q = quantity.trim() === '' ? (isMetal ? null : 0) : parseDecimal(quantity);
    if (q === null || (isMetal && q <= 0)) errs.quantity = isMetal ? 'Poids fin requis (grammes, supérieur à 0)' : 'Quantité invalide';
    const a = parseDecimal(amount);
    if (a === null || a <= 0) errs.amount = 'Montant requis (supérieur à 0)';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || q === null || a === null) return;
    void run(() => actions.add({
      assetId: asset.id, kind, date, quantity: q, amount: a, ...(label.trim() ? { label: label.trim() } : {}),
    }));
  };

  return (
    <BottomSheet
      open
      title={`Mouvement · ${asset.name}`}
      onClose={onClose}
      footer={<SheetFooter formId={formId} pending={pending} error={error} onCancel={onClose} />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Type</span>
          <Segmented
            ariaLabel="Type de mouvement"
            value={kind}
            onChange={setKind}
            options={[{ value: 'buy', label: 'Achat' }, { value: 'sell', label: 'Vente' }]}
          />
        </div>
        <Field label="Date" error={errors.date}>
          {(a) => <input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
        </Field>
        <Field label={quantityLabel} error={errors.quantity}>
          {(a) => <AmountInput aria={a} value={quantity} onChange={setQuantity} />}
        </Field>
        <Field label={`Montant (${asset.currency})`} suffix={CURRENCY_SYMBOL[asset.currency]} error={errors.amount}>
          {(a) => <AmountInput aria={a} value={amount} onChange={setAmount} />}
        </Field>
        <Field label="Libellé (facultatif)">
          {(a) => (
            <input
              {...a}
              type="text"
              autoComplete="off"
              placeholder={`${kind === 'buy' ? 'Achat' : 'Vente'} ${date}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
      </form>
    </BottomSheet>
  );
}
