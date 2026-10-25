'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Currency, FxRates } from '@/domain/types';

export const HIDDEN_TEXT = '•••••••';
const STORAGE_KEY = 'wos.display';

interface Prefs { currency: Currency; hidden: boolean }
const DEFAULT_PREFS: Prefs = { currency: 'EUR', hidden: false };

export interface DisplayState {
  currency: Currency;
  hidden: boolean;
  setCurrency: (c: Currency) => void;
  toggleHidden: () => void;
  fx: FxRates;
}

const DisplayContext = createContext<DisplayState | null>(null);

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Prefs> | null;
    if (!p || typeof p !== 'object') return null;
    const currency: Currency = p.currency === 'MAD' || p.currency === 'USD' || p.currency === 'EUR' ? p.currency : 'EUR';
    return { currency, hidden: p.hidden === true };
  } catch {
    return null;
  }
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible (navigation privée, quota…) : préférence non mémorisée */
  }
}

/**
 * Préférences d'affichage (devise, masquage des montants), mémorisées sur l'appareil.
 * Tant que les préférences ne sont pas relues (rendu serveur, premier rendu client),
 * les montants sont considérés comme masqués : aucun flash de chiffres si l'utilisateur les avait cachés.
 */
export function DisplayProvider({ fx, children }: { fx: FxRates; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    const stored = readPrefs();
    if (stored) {
      prefsRef.current = stored;
      setPrefs(stored);
    }
    setLoaded(true);
  }, []);

  const update = useCallback((patch: (p: Prefs) => Prefs) => {
    const next = patch(prefsRef.current);
    prefsRef.current = next;
    setPrefs(next);
    writePrefs(next);
  }, []);

  const setCurrency = useCallback((currency: Currency) => update((p) => ({ ...p, currency })), [update]);
  const toggleHidden = useCallback(() => update((p) => ({ ...p, hidden: !p.hidden })), [update]);

  const value = useMemo<DisplayState>(
    () => ({ currency: prefs.currency, hidden: loaded ? prefs.hidden : true, setCurrency, toggleHidden, fx }),
    [prefs, loaded, setCurrency, toggleHidden, fx],
  );
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplay(): DisplayState {
  const ctx = useContext(DisplayContext);
  if (!ctx) throw new Error('useDisplay doit être utilisé dans un <DisplayProvider>');
  return ctx;
}
