import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AppSettings } from '@shared/types';
import {
  SettingsPreviewProvider,
  useSettingsPreview,
} from '../src/contexts/SettingsPreviewContext';

function settings(theme: AppSettings['theme']): AppSettings {
  return {
    theme,
    accentColor: '#336699',
    sidebarWidth: 280,
    fontSize: 'medium',
    animationSpeed: 'none',
  } as AppSettings;
}

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsPreviewProvider>{children}</SettingsPreviewProvider>;
}

describe('SettingsPreviewContext theme preview', () => {
  it('applies explicit light and dark classes immediately', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const { result } = renderHook(() => useSettingsPreview(), { wrapper });

    act(() => result.current.startPreview(settings('light')));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => result.current.updatePreviewSetting('theme', 'dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  });
});
