import { useEffect } from 'react';
import type { AppSettings } from '@shared/types';
import {
  applyAccentColor,
  applyDensity,
  applyFontScale,
  applyHighContrast,
  resolveHighContrast,
} from '../lib/appearance';

/**
 * Hook to apply visual settings (theme, accent color, animations, etc.) to the app
 *
 * This hook connects the settings UI to actual CSS variables and classes,
 * ensuring that when users change settings, the app visually updates.
 *
 * The DOM writes live in `lib/appearance.ts` and are shared with
 * SettingsPreviewContext so the saved state and the live preview can never
 * drift apart.
 *
 * Note: When the Settings Dialog is open with unsaved changes, the preview
 * system in SettingsPreviewContext handles live preview. This hook only
 * applies the saved settings and won't interfere with preview mode.
 */
export function useVisualSettings(settings: AppSettings | undefined) {
  // Apply theme (light/dark/system)
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      root.classList.remove('light', 'dark');
      root.classList.add(isDark ? 'dark' : 'light');
    };

    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches);
    };

    if (settings?.theme === 'system' || !settings?.theme) {
      // System theme - listen for changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else {
      applyTheme(settings.theme === 'dark');
      return undefined;
    }
  }, [settings?.theme]);

  // Apply accent color as CSS variables
  useEffect(() => {
    applyAccentColor(settings?.accentColor, document.documentElement);
  }, [settings?.accentColor]);

  // Apply animation speed
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('animations-none', 'animations-fast', 'animations-normal');

    const animationSpeed = settings?.animationSpeed ?? 'none';

    if (animationSpeed === 'none') {
      root.classList.add('animations-none');
    } else if (animationSpeed === 'fast') {
      root.classList.add('animations-fast');
    } else {
      root.classList.add('animations-normal');
    }
  }, [settings?.animationSpeed]);

  // Apply font size
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');

    if (settings?.fontSize) {
      root.classList.add(`font-size-${settings.fontSize}`);
    }
  }, [settings?.fontSize]);

  // Apply high-contrast mode ('system' follows the OS prefers-contrast hint)
  useEffect(() => {
    const root = document.documentElement;
    const setting = settings?.highContrast ?? 'system';

    if (setting === 'system') {
      const mediaQuery = window.matchMedia('(prefers-contrast: more)');
      const apply = () => applyHighContrast(resolveHighContrast('system', mediaQuery.matches), root);
      apply();
      mediaQuery.addEventListener('change', apply);
      return () => mediaQuery.removeEventListener('change', apply);
    }

    applyHighContrast(setting, root);
    return undefined;
  }, [settings?.highContrast]);

  // Apply density (row heights/paddings) app-wide
  useEffect(() => {
    applyDensity(settings?.density, document.documentElement);
  }, [settings?.density]);

  // Apply root font scale
  useEffect(() => {
    applyFontScale(settings?.fontScale, document.documentElement);
  }, [settings?.fontScale]);

  // Apply sidebar width
  useEffect(() => {
    if (settings?.sidebarWidth) {
      document.documentElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
    }
  }, [settings?.sidebarWidth]);
}
