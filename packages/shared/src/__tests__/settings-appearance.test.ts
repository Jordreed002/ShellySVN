import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeSettings } from '../settings-defaults';

/**
 * Backlog #79 / #80 — appearance settings round-trip.
 *
 * `highContrast`, `density` and `fontScale` are optional on AppSettings so
 * stored settings from older builds merge cleanly, but the defaults must be
 * concrete (the Appearance panel renders against them) and a persisted value
 * must survive a merge round-trip untouched.
 */
describe('appearance settings defaults', () => {
  it('defaults highContrast to system (honors prefers-contrast)', () => {
    expect(DEFAULT_SETTINGS.highContrast).toBe('system');
  });

  it('defaults density to comfortable and fontScale to 100%', () => {
    expect(DEFAULT_SETTINGS.density).toBe('comfortable');
    expect(DEFAULT_SETTINGS.fontScale).toBe(1);
  });
});

describe('appearance settings round-trip', () => {
  it('fills the appearance defaults into an empty stored settings object', () => {
    const merged = mergeSettings(undefined);
    expect(merged.highContrast).toBe('system');
    expect(merged.density).toBe('comfortable');
    expect(merged.fontScale).toBe(1);
    expect(merged.accentColor).toBe('#6366f1');
  });

  it('round-trips every new appearance value through mergeSettings', () => {
    const stored = {
      accentColor: '#0ea5e9',
      highContrast: true,
      density: 'compact',
      fontScale: 1.25,
    };
    const merged = mergeSettings(stored);
    expect(merged.accentColor).toBe('#0ea5e9');
    expect(merged.highContrast).toBe(true);
    expect(merged.density).toBe('compact');
    expect(merged.fontScale).toBe(1.25);
  });

  it('round-trips the off variant of high contrast distinctly from system', () => {
    expect(mergeSettings({ highContrast: false }).highContrast).toBe(false);
    expect(mergeSettings({ highContrast: 'system' }).highContrast).toBe('system');
  });

  it('keeps legacy stored settings (without the new fields) intact', () => {
    const legacy = {
      theme: 'dark',
      accentColor: '#8b5cf6',
      sidebarWidth: 300,
      animationSpeed: 'normal',
    };
    const merged = mergeSettings(legacy);
    expect(merged.theme).toBe('dark');
    expect(merged.accentColor).toBe('#8b5cf6');
    expect(merged.sidebarWidth).toBe(300);
    expect(merged.animationSpeed).toBe('normal');
    // New fields fall back to defaults rather than undefined.
    expect(merged.highContrast).toBe('system');
    expect(merged.density).toBe('comfortable');
    expect(merged.fontScale).toBe(1);
  });
});
