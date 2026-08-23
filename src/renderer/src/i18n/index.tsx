/**
 * Renderer i18n runtime (#134): locale store, `t()`, and React bindings.
 *
 * Architecture:
 * - The locale lives in a module-level store with subscribe/getSnapshot, so
 *   `useTranslation()` re-renders on locale change WITHOUT requiring a provider
 *   (the pilot surfaces render inside existing tests and screens untouched).
 * - `I18nProvider` is the explicit opt-in wrapper: it loads the persisted
 *   locale once on mount and re-renders its subtree on change. Mounting it in
 *   `main.tsx` is the follow-up wiring step (see MOUNT note below) — this
 *   scaffold deliberately does not edit `main.tsx`.
 * - Fallback chain: current locale → `en` (source) → the key itself, so a
 *   missing translation never crashes or blanks the UI.
 *
 * Locale persistence follows the `lib/shortcutStore.ts` pattern: a versioned
 * key on the `window.api.store` bridge, tolerant of storage failures.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { FlatCatalog, Locale, MessageCatalog, TranslationParams } from './types';
import { SOURCE_LOCALE, flattenCatalog, interpolate } from './types';
import { en } from './locales/en';

/** Versioned persistence key (pattern: `lib/shortcutStore.ts`). */
export const LOCALE_STORAGE_KEY = 'shellysvn:locale:v1';

/** Registry of flattened catalogs, keyed by locale. */
const catalogs = new Map<Locale, FlatCatalog>([[SOURCE_LOCALE, flattenCatalog(en)]]);

/** The current locale (module store). Starts at the source locale. */
let currentLocale: Locale = SOURCE_LOCALE;
let loadedOnce = false;

const listeners = new Set<() => void>();
const warnedKeys = new Set<string>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to locale changes (the same subscription `useTranslation` uses). */
export { subscribe };

/** Snapshot for `useSyncExternalStore`; stable between locale changes. */
export function getLocale(): Locale {
  return currentLocale;
}

/** True when a catalog has been registered for the locale. */
export function hasCatalog(locale: Locale): boolean {
  return catalogs.has(locale);
}

/** The locales with registered catalogs, in registration order (`en` first). */
export function availableLocales(): Locale[] {
  return [...catalogs.keys()];
}

/**
 * Register (or replace) a catalog. Nested catalogs are flattened to dotted
 * keys. Translation-only locales may omit keys that match `en`; missing keys
 * fall back through the chain.
 */
export function registerCatalog(locale: Locale, catalog: MessageCatalog): void {
  if (!locale) return;
  catalogs.set(locale, flattenCatalog(catalog));
}

/** Look a key up in one locale's flat catalog. */
function lookup(locale: Locale, key: string): string | undefined {
  const value = catalogs.get(locale)?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Translate `key` with the fallback chain: `locale` → `en` → the key itself.
 * `{name}` placeholders are interpolated from `params`; unknown placeholders
 * and missing keys are returned as-is (the key is NOT interpolated, so a
 * missing message is always identifiable in the UI).
 */
export function translate(key: string, params?: TranslationParams, locale: Locale = currentLocale): string {
  const value = lookup(locale, key) ?? (locale === SOURCE_LOCALE ? undefined : lookup(SOURCE_LOCALE, key));
  if (value === undefined) {
    if (import.meta.env.DEV && !warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] missing message for key "${key}" (locale "${locale}")`);
    }
    return key;
  }
  return interpolate(value, params);
}

/** Standalone `t`, bound to the current locale at call time. */
export function t(key: string, params?: TranslationParams): string {
  return translate(key, params);
}

export interface SetLocaleOptions {
  /** Persist to `window.api.store` (default true). Pass false for ephemeral/test/pseudo locales. */
  persist?: boolean;
}

/**
 * Switch the active locale and (by default) persist the choice.
 *
 * ### Future settings toggle mount (coordination note)
 * The settings surface is owned by another track; when a language picker lands
 * there, its `onChange` should be exactly:
 *
 * ```ts
 * onChange={(locale) => void setLocale(locale)}
 * ```
 *
 * with the choices sourced from `availableLocales()`. Nothing else is needed —
 * every `useTranslation()` consumer re-renders automatically.
 */
export async function setLocale(locale: Locale, options: SetLocaleOptions = {}): Promise<void> {
  if (!locale || typeof locale !== 'string') return;
  const { persist = true } = options;
  const changed = locale !== currentLocale;
  currentLocale = locale;
  loadedOnce = true;
  if (changed) emitChange();
  if (!persist) return;
  try {
    await window.api?.store?.set(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage failures must never break a locale switch in-session.
  }
}

/**
 * Load the persisted locale once (idempotent). Invalid or missing values
 * degrade to the current locale. Called by `I18nProvider`; also safe to call
 * from `main.tsx` if the provider is not mounted.
 */
export async function loadPersistedLocale(): Promise<Locale> {
  if (loadedOnce) return currentLocale;
  loadedOnce = true;
  try {
    const stored = await window.api?.store?.get<unknown>(LOCALE_STORAGE_KEY);
    if (typeof stored === 'string' && stored && stored !== currentLocale) {
      currentLocale = stored;
      emitChange();
    }
  } catch {
    // Degrade to the current (source) locale.
  }
  return currentLocale;
}

export interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Explicit i18n wrapper: loads the persisted locale on mount and re-renders
 * its subtree on every locale change. Optional for consumers —
 * `useTranslation()` works without it — but mounting it is what makes the
 * persisted choice take effect app-wide.
 *
 * ### MOUNT (future wiring, `src/renderer/src/main.tsx` — not edited here)
 * ```tsx
 * <I18nProvider>            // e.g. just inside <SettingsPreviewProvider>
 *   <RouterProvider router={router} />
 * </I18nProvider>
 * ```
 */
export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const locale = useSyncExternalStore(subscribe, getLocale);

  useEffect(() => {
    void loadPersistedLocale();
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: (key: string, params?: TranslationParams) => translate(key, params, locale) }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  // Prefer an explicit provider value when present, so provider-only consumers
  // stay in sync; otherwise bind directly to the module store.
  const context = useContext(I18nContext);
  const locale = useSyncExternalStore(subscribe, getLocale);
  const translateForLocale = useCallback(
    (key: string, params?: TranslationParams) => translate(key, params, locale),
    [locale]
  );
  return useMemo(
    () => context ?? { locale, t: translateForLocale },
    [context, locale, translateForLocale]
  );
}

/** Reset module state between tests (registered catalogs beyond `en`, locale, warnings). */
export function __resetI18nForTests(): void {
  for (const locale of Array.from(catalogs.keys())) {
    if (locale !== SOURCE_LOCALE) catalogs.delete(locale);
  }
  currentLocale = SOURCE_LOCALE;
  loadedOnce = false;
  warnedKeys.clear();
}

export { SOURCE_LOCALE };
export type { Locale, MessageCatalog, TranslationParams };
