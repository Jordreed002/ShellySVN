import { describe, expect, it } from 'vitest';
import type { AppSettings, HighContrastSetting } from '@shared/types';
import {
  adjustColorBrightness,
  applyAccentColor,
  applyDensity,
  applyFontScale,
  applyHighContrast,
  FONT_SCALE_STEPS,
  hexToRgb,
  normalizeHexColor,
  resolveHighContrast,
} from '../appearance';

function makeRoot(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('hexToRgb / adjustColorBrightness', () => {
  it('parses six-digit hex with or without #', () => {
    expect(hexToRgb('#58a6ff')).toEqual({ r: 88, g: 166, b: 255 });
    expect(hexToRgb('58a6ff')).toEqual({ r: 88, g: 166, b: 255 });
  });

  it('rejects shorthand and garbage', () => {
    expect(hexToRgb('#58a6')).toBeNull();
    expect(hexToRgb('nope12')).toBeNull();
  });

  it('lightens and darkens symmetrically', () => {
    expect(adjustColorBrightness('#000000', 20)).toBe('#333333');
    expect(adjustColorBrightness('#ffffff', -20)).toBe('#cccccc');
  });
});

describe('normalizeHexColor', () => {
  it('expands 3-digit shorthand to lowercase #rrggbb', () => {
    expect(normalizeHexColor('#F0A')).toBe('#ff00aa');
    expect(normalizeHexColor('09f')).toBe('#0099ff');
  });

  it('lowercases 6-digit hex and tolerates a missing #', () => {
    expect(normalizeHexColor('#58A6FF')).toBe('#58a6ff');
    expect(normalizeHexColor('58A6FF')).toBe('#58a6ff');
  });

  it('returns null for anything that is not a hex color', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('#1234567')).toBeNull();
    expect(normalizeHexColor('rgb(1, 2, 3)')).toBeNull();
  });
});

describe('resolveHighContrast', () => {
  it('lets explicit on/off win over the OS preference', () => {
    expect(resolveHighContrast(true, false)).toBe(true);
    expect(resolveHighContrast(false, true)).toBe(false);
  });

  it('follows the OS preference for system and undefined', () => {
    const system: HighContrastSetting = 'system';
    expect(resolveHighContrast(system, true)).toBe(true);
    expect(resolveHighContrast(system, false)).toBe(false);
    expect(resolveHighContrast(undefined, true)).toBe(true);
    expect(resolveHighContrast(undefined, false)).toBe(false);
  });
});

describe('applyAccentColor', () => {
  it('derives every accent variable from the base triplet', () => {
    const root = makeRoot();
    applyAccentColor('#58a6ff', root);

    expect(root.style.getPropertyValue('--color-accent-rgb')).toBe('88 166 255');
    expect(root.style.getPropertyValue('--color-accent')).toBe('rgb(88 166 255)');
    // hover = +20% brightness (blue clamps at 255), muted = -15% brightness
    expect(root.style.getPropertyValue('--color-accent-hover-rgb')).toBe('139 217 255');
    expect(root.style.getPropertyValue('--color-accent-muted-rgb')).toBe('50 128 217');
    expect(root.style.getPropertyValue('--color-accent-glow')).toBe(
      'rgba(88, 166, 255, 0.4)'
    );
  });

  it('is a no-op for an unparseable color', () => {
    const root = makeRoot();
    applyAccentColor('not-a-color', root);
    expect(root.style.getPropertyValue('--color-accent-rgb')).toBe('');
  });

  it('clears inline overrides when no accent is set', () => {
    const root = makeRoot();
    applyAccentColor('#58a6ff', root);
    applyAccentColor(undefined, root);
    expect(root.style.getPropertyValue('--color-accent-rgb')).toBe('');
    expect(root.style.getPropertyValue('--color-accent')).toBe('');
  });
});

describe('applyDensity', () => {
  it('toggles exactly one density class', () => {
    const root = makeRoot();
    applyDensity('compact', root);
    expect(root.classList.contains('density-compact')).toBe(true);
    expect(root.classList.contains('density-comfortable')).toBe(false);

    applyDensity('comfortable', root);
    expect(root.classList.contains('density-compact')).toBe(false);
    expect(root.classList.contains('density-comfortable')).toBe(true);
  });

  it('falls back to comfortable for undefined', () => {
    const root = makeRoot();
    applyDensity(undefined, root);
    expect(root.classList.contains('density-comfortable')).toBe(true);
  });
});

describe('applyHighContrast', () => {
  it('adds and removes the high-contrast class', () => {
    const root = makeRoot();
    applyHighContrast(true, root);
    expect(root.classList.contains('high-contrast')).toBe(true);
    applyHighContrast(false, root);
    expect(root.classList.contains('high-contrast')).toBe(false);
  });
});

describe('applyFontScale', () => {
  it('sets the font scale as a root percentage and a raw variable', () => {
    const root = makeRoot();
    applyFontScale(1.1, root);
    expect(root.style.fontSize).toBe('110%');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.1');
  });

  it('defaults to 100% and clamps corrupt values', () => {
    const root = makeRoot();
    applyFontScale(undefined, root);
    expect(root.style.fontSize).toBe('100%');

    applyFontScale(Number.NaN, root);
    expect(root.style.fontSize).toBe('100%');

    applyFontScale(99, root);
    expect(root.style.fontSize).toBe('200%');
  });

  it('offers the four advertised steps', () => {
    expect([...FONT_SCALE_STEPS]).toEqual([0.85, 1, 1.1, 1.25]);
  });
});

describe('settings plumbing smoke', () => {
  it('accepts the new fields on an AppSettings-typed object', () => {
    const settings: AppSettings = {
      highContrast: true,
      density: 'compact',
      fontScale: 1.25,
    } as AppSettings;
    expect(settings.highContrast).toBe(true);
    expect(settings.density).toBe('compact');
    expect(settings.fontScale).toBe(1.25);
  });
});
