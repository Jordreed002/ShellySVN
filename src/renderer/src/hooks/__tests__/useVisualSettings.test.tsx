import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types';

import { useVisualSettings } from '../useVisualSettings';

/**
 * Backlog #79 / #80 — useVisualSettings must translate the saved appearance
 * settings into root classes / CSS variables: theme, accent, high contrast
 * (including the `prefers-contrast: more` system mode), density and the root
 * font scale.
 */

interface FakeQuery extends MediaQueryList {
  __fire(matches: boolean): void;
}

function installMatchMedia(initial: Record<string, boolean>) {
  const registry = new Map<string, FakeQuery>();
  const original = window.matchMedia;

  const matchMedia = (query: string): MediaQueryList => {
    let entry = registry.get(query);
    if (!entry) {
      const listeners = new Set<(e: MediaQueryListEvent) => void>();
      const fake = {
        matches: initial[query] ?? false,
        media: query,
        onchange: null,
        addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
          listeners.add(cb);
        },
        removeEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
          listeners.delete(cb);
        },
        addListener: (cb: (e: MediaQueryListEvent) => void) => {
          listeners.add(cb);
        },
        removeListener: (cb: (e: MediaQueryListEvent) => void) => {
          listeners.delete(cb);
        },
        dispatchEvent: () => true,
        __fire(next: boolean) {
          fake.matches = next;
          for (const cb of listeners) cb({ matches: next, media: query } as MediaQueryListEvent);
        },
      };
      entry = fake as unknown as FakeQuery;
      registry.set(query, entry);
    }
    return entry;
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(matchMedia),
  });

  return {
    fire(query: string, matches: boolean) {
      registry.get(query)?.__fire(matches);
    },
    restore() {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: 'dark',
    accentColor: '#58a6ff',
    animationSpeed: 'none',
    fontSize: 'medium',
    sidebarWidth: 250,
    highContrast: false,
    density: 'comfortable',
    fontScale: 1,
    ...overrides,
  } as AppSettings;
}

function resetRoot() {
  const root = document.documentElement;
  root.className = '';
  root.removeAttribute('style');
}

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  resetRoot();
  media = installMatchMedia({});
});

afterEach(() => {
  media.restore();
  resetRoot();
  cleanup();
});

describe('useVisualSettings — theme', () => {
  it('applies explicit dark and light classes', () => {
    const { rerender } = renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ theme: 'dark' }),
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    rerender(baseSettings({ theme: 'light' }));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows the OS color scheme in system mode, including live changes', () => {
    media = installMatchMedia({ '(prefers-color-scheme: dark)': true });
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ theme: 'system' }),
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => media.fire('(prefers-color-scheme: dark)', false));
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});

describe('useVisualSettings — accent color', () => {
  it('derives all accent variables from the base triplet', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ accentColor: '#22c55e' }),
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-accent-rgb')).toBe('34 197 94');
    expect(style.getPropertyValue('--color-accent')).toBe('rgb(34 197 94)');
    expect(style.getPropertyValue('--color-accent-hover-rgb')).toBe('85 248 145');
    expect(style.getPropertyValue('--color-accent-glow')).toBe('rgba(34, 197, 94, 0.4)');
  });
});

describe('useVisualSettings — high contrast', () => {
  it('toggles the high-contrast class for explicit on/off', () => {
    const { rerender } = renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ highContrast: true }),
    });
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    rerender(baseSettings({ highContrast: false }));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
  });

  it("honors the OS 'prefers-contrast: more' hint in system mode", () => {
    media = installMatchMedia({ '(prefers-contrast: more)': true });
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ highContrast: 'system' }),
    });
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
  });

  it('stays off in system mode without the OS hint, then reacts to changes', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ highContrast: 'system' }),
    });
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);

    act(() => media.fire('(prefers-contrast: more)', true));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    act(() => media.fire('(prefers-contrast: more)', false));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
  });

  it('defaults to system mode when the setting is missing', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ highContrast: undefined }),
    });
    // No OS hint → off, but the listener is live.
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
    act(() => media.fire('(prefers-contrast: more)', true));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
  });
});

describe('useVisualSettings — density', () => {
  it('swaps the density class when the setting changes', () => {
    const { rerender } = renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ density: 'compact' }),
    });
    const root = document.documentElement;
    expect(root.classList.contains('density-compact')).toBe(true);

    rerender(baseSettings({ density: 'comfortable' }));
    expect(root.classList.contains('density-compact')).toBe(false);
    expect(root.classList.contains('density-comfortable')).toBe(true);
  });

  it('falls back to comfortable when unset', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ density: undefined }),
    });
    expect(document.documentElement.classList.contains('density-comfortable')).toBe(true);
  });
});

describe('useVisualSettings — font scale', () => {
  it('applies the scale as root font-size and exposes --font-scale', () => {
    const { rerender } = renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ fontScale: 1.25 }),
    });
    const root = document.documentElement;
    expect(root.style.fontSize).toBe('125%');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.25');

    rerender(baseSettings({ fontScale: 0.85 }));
    expect(root.style.fontSize).toBe('85%');
  });

  it('resets to 100% when unset', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ fontScale: undefined }),
    });
    expect(document.documentElement.style.fontSize).toBe('100%');
  });
});

describe('useVisualSettings — legacy knobs still applied', () => {
  it('applies animation speed class and sidebar width variable', () => {
    renderHook((s: AppSettings) => useVisualSettings(s), {
      initialProps: baseSettings({ animationSpeed: 'fast', sidebarWidth: 320 }),
    });
    const root = document.documentElement;
    expect(root.classList.contains('animations-fast')).toBe(true);
    expect(root.style.getPropertyValue('--sidebar-width')).toBe('320px');
  });
});
