export interface SplitPart { value: number; color: string; label: string }

/** Barre horizontale segmentée (investi / en attente / libre…). Sans aucun montant affiché. */
export function SplitBar({ parts, label = 'Répartition' }: { parts: SplitPart[]; label?: string }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const names = shown.map((p) => p.label).join(', ');
  return (
    <div
      role="img"
      aria-label={names ? `${label} : ${names}` : label}
      className="flex h-2 overflow-hidden rounded-full bg-[#f0f1f3]"
    >
      {shown.map((p) => (
        <div key={p.label} data-seg style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
