import type { HTMLAttributes } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-[20px] border border-border bg-card p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}
