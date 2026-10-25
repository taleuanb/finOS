'use client';

export interface SegmentedOption<T extends string> { value: T; label: string }

/** Sélecteur segmenté (devise, période, onglets…). Cibles tactiles ≥ 44 px. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex gap-1 rounded-xl bg-[#f0f1f3] p-1 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 rounded-[9px] px-3 text-[13px] ${
              active ? 'bg-card font-bold text-foreground shadow-sm' : 'font-semibold text-muted'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
