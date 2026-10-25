'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Éléments focusables du dialogue, dans l'ordre du document. */
function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => !el.hasAttribute('disabled') && !el.closest('[hidden], [inert]'))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * Feuille modale partagée (formulaires, filtres) : dialogue ancré en bas, fond cliquable,
 * focus piégé (Tab / Maj+Tab bouclent), Échap ferme, focus rendu à l'élément d'origine.
 */
export function BottomSheet({
  open, title, onClose, children, footer,
}: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Ouverture : mémorise l'élément déclencheur, place le focus dans la feuille, bloque le défilement du body.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  // Échap ferme ; Tab / Maj+Tab restent dans la feuille. Sans effet tant que la feuille est fermée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = ref.current;
      if (!dialog) return;
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables(dialog);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (outside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Le clic sur le fond ferme, mais pas une sélection commencée dans le dialogue et terminée sur le fond.
  const pressedOnBackdrop = useRef(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full max-w-[480px] flex-col gap-3 rounded-t-[24px] bg-card p-4 pb-6 outline-none"
      >
        <h2 id={titleId} className="text-[17px] font-extrabold">{title}</h2>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? <div className="flex gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
