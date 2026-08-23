import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AppSettings } from '@shared/types';
import {
  SettingsPreviewProvider,
  useSettingsPreview,
} from '../src/contexts/SettingsPreviewContext';

/**
 * Backlog #79 / #80 — the settings dialog previews appearance changes live by
 * applying them to the document root through applyVisualChanges. Every knob
 * added to useVisualSettings must be previewed here too, and cancelPreview
 * must revert all of them to the saved settings.
 */

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: 'dark',
    accentColor: '#336699',
    sidebarWidth: 280,
    fontSize: 'medium',
    animationSpeed: 'none',
    highContrast: 'system',
    density: 'comfortable',
    fontScale: 1,
    ...overrides,
  } as AppSettings;
}

function stubMatchMedia(prefers: Record<string, boolean>) {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: prefers[query] ?? false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: original,
    });
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsPreviewProvider>{children}</SettingsPreviewProvider>;
}

describe('SettingsPreviewContext appearance preview', () => {
  it('previews high contrast, density and font scale immediately', () => {
    const restore = stubMatchMedia({});
    const root = document.documentElement;
    root.classList.remove('high-contrast', 'density-compact', 'density-comfortable');
    root.removeAttribute('style');

    const { result } = renderHook(() => useSettingsPreview(), { wrapper });

    act(() => result.current.startPreview(settings()));
    expect(root.classList.contains('high-contrast')).toBe(false);
    expect(root.classList.contains('density-comfortable')).toBe(true);
    expect(root.style.fontSize).toBe('100%');

    act(() => result.current.updatePreviewSetting('highContrast', true));
    expect(root.classList.contains('high-contrast')).toBe(true);

    act(() => result.current.updatePreviewSetting('density', 'compact'));
    expect(root.classList.contains('density-compact')).toBe(true);
    expect(root.classList.contains('density-comfortable')).toBe(false);

    act(() => result.current.updatePreviewSetting('fontScale', 1.25));
    expect(root.style.fontSize).toBe('125%');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.25');

    // Cancel reverts everything to the saved settings in one pass.
    act(() => result.current.cancelPreview(settings()));
    expect(root.classList.contains('high-contrast')).toBe(false);
    expect(root.classList.contains('density-compact')).toBe(false);
    expect(root.classList.contains('density-comfortable')).toBe(true);
    expect(root.style.fontSize).toBe('100%');

    restore();
  });

  it("resolves 'system' high contrast against the OS hint while previewing", () => {
    const restore = stubMatchMedia({ '(prefers-contrast: more)': true });
    const root = document.documentElement;
    root.classList.remove('high-contrast');

    const { result } = renderHook(() => useSettingsPreview(), { wrapper });
    act(() => result.current.startPreview(settings({ highContrast: 'system' })));
    expect(root.classList.contains('high-contrast')).toBe(true);

    // An explicit preview overrides the OS hint.
    act(() => result.current.updatePreviewSetting('highContrast', false));
    expect(root.classList.contains('high-contrast')).toBe(false);

    restore();
  });

  it('previews the full accent variable set (not just the base triplet)', () => {
    const restore = stubMatchMedia({});
    const root = document.documentElement;
    root.removeAttribute('style');

    const { result } = renderHook(() => useSettingsPreview(), { wrapper });
    act(() => result.current.startPreview(settings({ accentColor: '#0ea5e9' })));
    expect(root.style.getPropertyValue('--color-accent-rgb')).toBe('14 165 233');
    // The direct (non-triplet) variables used by hand-written CSS must be
    // kept in sync with the saved-settings path in useVisualSettings.
    expect(root.style.getPropertyValue('--color-accent')).toBe('rgb(14 165 233)');
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe('rgb(65 216 255)');

    restore();
  });
});
