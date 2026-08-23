/**
 * i18n runtime (#134): `t()` interpolation, dotted/nested key resolution, the
 * locale → en → key fallback chain, locale switching (store + hook), and the
 * `window.api.store` persistence round trip (pattern: shortcutStore tests).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  SOURCE_LOCALE,
  __resetI18nForTests,
  getLocale,
  loadPersistedLocale,
  registerCatalog,
  setLocale,
  subscribe,
  t,
  translate,
  useTranslation,
} from '../index';
import type { MessageCatalog } from '../types';

const TEST_CATALOG: MessageCatalog = {
  greet: 'Hello {name}, {count} files',
  common: { ok: 'OK', deep: { yes: 'Yes' } },
};

beforeEach(() => {
  __resetI18nForTests();
  registerCatalog('xx', { greet: 'Salut {name}, {count} fichiers' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetI18nForTests();
});

describe('translate', () => {
  it('resolves dotted keys from the en source catalog', () => {
    expect(t('statusLegend.title')).toBe('What the status colors mean');
    expect(t('routes.files.title')).toBe('File Explorer');
  });

  it('resolves nested catalogs and already-flat dotted catalogs alike', () => {
    registerCatalog('tst', TEST_CATALOG);
    expect(translate('common.deep.yes', undefined, 'tst')).toBe('Yes');
    registerCatalog('flat', { 'common.deep.yes': 'Flatly yes' });
    expect(translate('common.deep.yes', undefined, 'flat')).toBe('Flatly yes');
  });

  it('interpolates {placeholder} params and leaves unknown placeholders intact', () => {
    registerCatalog('tst', TEST_CATALOG);
    expect(translate('greet', { name: 'Ada', count: 3 }, 'tst')).toBe('Hello Ada, 3 files');
    expect(translate('greet', { name: 'Ada' }, 'tst')).toBe('Hello Ada, {count} files');
  });

  it('falls back locale → en → the key itself', () => {
    // xx has only its own greet; everything else cascades.
    expect(translate('greet', { name: 'Ada', count: 1 }, 'xx')).toBe('Salut Ada, 1 fichiers');
    expect(translate('statusLegend.title', undefined, 'xx')).toBe('What the status colors mean');
    expect(translate('no.such.key', undefined, 'xx')).toBe('no.such.key');
    expect(translate('no.such.key', undefined, SOURCE_LOCALE)).toBe('no.such.key');
  });

  it('warns once per missing key in dev, and not for fallbacks', () => {
    translate('gone.key');
    translate('gone.key');
    expect(console.warn).toHaveBeenCalledTimes(1);
    translate('statusLegend.title', undefined, 'xx');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('locale store', () => {
  it('switches the active locale and notifies subscribers', async () => {
    expect(getLocale()).toBe(SOURCE_LOCALE);
    const seen: string[] = [];
    const unsubscribe = subscribe(() => seen.push(getLocale()));
    await act(async () => {
      await setLocale('xx', { persist: false });
    });
    expect(getLocale()).toBe('xx');
    expect(seen).toEqual(['xx']);
    // Re-setting the same locale does not churn listeners.
    await act(async () => {
      await setLocale('xx', { persist: false });
    });
    expect(seen).toEqual(['xx']);
    unsubscribe();
  });

  it('re-renders useTranslation consumers on locale change (no provider needed)', async () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.locale).toBe(SOURCE_LOCALE);
    expect(result.current.t('statusLegend.title')).toBe('What the status colors mean');

    await act(async () => {
      await setLocale('xx', { persist: false });
    });
    expect(result.current.locale).toBe('xx');
    // greet exists in xx; statusLegend.title falls back to en.
    expect(result.current.t('greet', { name: 'Bo', count: 2 })).toBe('Salut Bo, 2 fichiers');
    expect(result.current.t('statusLegend.title')).toBe('What the status colors mean');
  });

  it('re-renders an I18nProvider subtree on locale change', async () => {
    function Probe() {
      const { t: translateWithLocale, locale } = useTranslation();
      return (
        <p>
          {locale}:{translateWithLocale('statusLegend.title')}
        </p>
      );
    }
    const { container } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    expect(container.textContent).toContain('en:What the status colors mean');
    await act(async () => {
      await setLocale('xx', { persist: false });
    });
    // xx has no statusLegend.* strings, so the en fallback still shows — the
    // locale prefix proves the subtree re-rendered.
    expect(container.textContent).toContain('xx:What the status colors mean');
  });
});

describe('locale persistence (window.api.store)', () => {
  const store = {
    get: vi.fn<(key: string) => Promise<unknown>>(),
    set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
  };

  beforeEach(() => {
    vi.stubGlobal('window', { api: { store } });
  });

  it('setLocale persists under the versioned key', async () => {
    await setLocale('de');
    expect(store.set).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'de');
    expect(LOCALE_STORAGE_KEY).toBe('shellysvn:locale:v1');
  });

  it('setLocale survives storage failures in-session', async () => {
    store.set.mockRejectedValue(new Error('disk gone'));
    await expect(setLocale('de')).resolves.toBeUndefined();
    expect(getLocale()).toBe('de');
  });

  it('loadPersistedLocale applies a stored locale once', async () => {
    store.get.mockResolvedValue('de');
    await expect(loadPersistedLocale()).resolves.toBe('de');
    expect(getLocale()).toBe('de');
    // Second load is a no-op even if storage now says something else.
    store.get.mockResolvedValue('fr');
    await expect(loadPersistedLocale()).resolves.toBe('de');
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('degrades to the source locale on invalid values or storage errors', async () => {
    store.get.mockResolvedValue(42);
    await expect(loadPersistedLocale()).resolves.toBe(SOURCE_LOCALE);
    __resetI18nForTests();
    store.get.mockRejectedValue(new Error('locked'));
    await expect(loadPersistedLocale()).resolves.toBe(SOURCE_LOCALE);
    expect(getLocale()).toBe(SOURCE_LOCALE);
  });
});
