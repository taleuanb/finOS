'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const svg = (children: ReactNode) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const NAV_ITEMS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: '/',
    label: 'Synthèse',
    icon: svg(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>,
    ),
  },
  {
    href: '/patrimoine',
    label: 'Patrimoine',
    icon: svg(
      <>
        <path d="M5 21V12" />
        <path d="M12 21V4" />
        <path d="M19 21V9" />
      </>,
    ),
  },
  {
    href: '/budget',
    label: 'Budget',
    icon: svg(
      <>
        <path d="M20 7H5a2 2 0 0 1 0-4h13v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15V7" />
        <circle cx="16.5" cy="14" r="1" />
      </>,
    ),
  },
  {
    href: '/epargne',
    label: 'Épargne',
    icon: svg(
      <>
        <path d="M21 12A9 9 0 1 1 12 3v9z" />
        <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
      </>,
    ),
  },
  {
    href: '/metaux',
    label: 'Métaux',
    icon: svg(
      <>
        <path d="M6 5h12l3 14H3z" />
        <path d="M8.5 9h7" />
      </>,
    ),
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-[480px] px-1 pb-2 pt-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[11px] ${
                active ? 'font-bold text-curve' : 'font-medium text-muted'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
