import type { HTMLAttributes } from 'react';

export type BadgeTone = 'gain' | 'loss' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  gain: 'bg-gain-bg text-gain',
  loss: 'bg-loss-bg text-loss',
  neutral: 'bg-[#f0f1f3] text-muted',
};

export function Badge({
  tone,
  className = '',
  children,
  ...rest
}: { tone: BadgeTone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-bold ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
