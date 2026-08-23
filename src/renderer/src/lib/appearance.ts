import type { AppSettings, HighContrastSetting } from '@shared/types';

/**
 * Appearance application — the single place that translates appearance
 * settings into CSS variables / classes on the document root.
 *
 * Both consumers must stay in lockstep or the live preview lies:
 * - `hooks/useVisualSettings.ts` applies the *saved* settings
 * - `contexts/SettingsPreviewContext.tsx` applies *previewed* settings while
 *   the settings dialog is open
 *
 * If either needs a new visual knob, add the applier here and call it from
 * both — never inline the DOM writes in one of them only.
 */

/** Root font scale steps offered by the Appearance settings panel. */
export const FONT_SCALE_STEPS: readonly number[] = [0.85, 1, 1.1, 1.25];

/** Clamp for fontScale so a corrupt stored value can't nuke the layout. */
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2;

/**
 * Convert a hex color to an RGB object.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace('#', '');

  if (cleanHex.length !== 6) {
    return null;
  }

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null;
  }

  return { r, g, b };
}

/**
 * Adjust color brightness by a percentage
 */
export function adjustColorBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace('#', '');

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  const adjust = (value: number) => {
    const adjusted = value + (255 * percent) / 100;
    return Math.min(255, Math.max(0, Math.round(adjusted)));
  };

  const newR = adjust(r);
  const newG = adjust(g);
  const newB = adjust(b);

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * Normalize user-typed color input to a lowercase `#rrggbb` string, expanding
 * 3-digit shorthand. Returns null for anything that isn't a hex color.
 */
export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$/.test(trimmed) && !/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }
  const expanded = trimmed.length === 3 ? trimmed[0] + trimmed[0] + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] : trimmed;
  return `#${expanded.toLowerCase()}`;
}

/**
 * Resolve the highContrast setting to a concrete on/off value.
 * `true`/`false` win outright; `'system'` (and undefined) follows the OS
 * `prefers-contrast: more` query result passed in by the caller.
 */
export function resolveHighContrast(
  setting: HighContrastSetting | undefined,
  prefersMoreContrast: boolean
): boolean {
  if (setting === true || setting === false) {
    return setting;
  }
  return prefersMoreContrast;
}

/**
 * Apply the accent color as CSS variables.
 *
 * All accent shades hang off `--color-accent-rgb` (Tailwind's `accent` token
 * and `border-focus` read it, and alpha utilities like `bg-accent/10` compose
 * on top of it). Hover/muted shades need per-theme lightening/darkening that a
 * single alpha cannot express, so they keep dedicated `-rgb` variables that are
 * recomputed here whenever the base accent changes.
 */
export function applyAccentColor(accentColor: string | undefined, root: HTMLElement): void {
  if (!accentColor) {
    // Restore the stylesheet defaults fully when no accent is set.
    for (const prop of [
      '--color-accent-rgb',
      '--color-accent',
      '--color-accent-hover-rgb',
      '--color-accent-hover',
      '--color-accent-muted-rgb',
      '--color-accent-muted',
      '--color-accent-glow',
    ]) {
      root.style.removeProperty(prop);
    }
    return;
  }

  const rgb = hexToRgb(accentColor);
  if (!rgb) {
    return;
  }
  const triplet = `${rgb.r} ${rgb.g} ${rgb.b}`;

  // Base — the single source every other accent shade derives from.
  root.style.setProperty('--color-accent-rgb', triplet);
  root.style.setProperty('--color-accent', `rgb(${triplet})`);

  // Hover — slightly lighter in dark themes.
  const hoverRgb = hexToRgb(adjustColorBrightness(accentColor, 20));
  if (hoverRgb) {
    const hoverTriplet = `${hoverRgb.r} ${hoverRgb.g} ${hoverRgb.b}`;
    root.style.setProperty('--color-accent-hover-rgb', hoverTriplet);
    root.style.setProperty('--color-accent-hover', `rgb(${hoverTriplet})`);
  }

  // Muted — slightly darker for less emphasis.
  const mutedRgb = hexToRgb(adjustColorBrightness(accentColor, -15));
  if (mutedRgb) {
    const mutedTriplet = `${mutedRgb.r} ${mutedRgb.g} ${mutedRgb.b}`;
    root.style.setProperty('--color-accent-muted-rgb', mutedTriplet);
    root.style.setProperty('--color-accent-muted', `rgb(${mutedTriplet})`);
  }

  // Glow — the accent with transparency, used by focus/shadow accents.
  root.style.setProperty('--color-accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
}

/**
 * Apply row density as a `.density-*` class. The classes set the
 * `--row-height` / `--row-height-tree` / `--row-pad-y` variables that central
 * row utilities (`h-row`, `.file-row`, …) consume.
 */
export function applyDensity(density: AppSettings['density'], root: HTMLElement): void {
  root.classList.remove('density-compact', 'density-comfortable');
  root.classList.add(density === 'compact' ? 'density-compact' : 'density-comfortable');
}

/**
 * Apply high-contrast mode as the `.high-contrast` class, which overrides the
 * border / text / status tokens with contrast-boosted variants.
 */
export function applyHighContrast(active: boolean, root: HTMLElement): void {
  root.classList.toggle('high-contrast', active);
}

/**
 * Apply the root font scale. `--font-scale` is exposed for hand-written CSS
 * (body font-size composes on it) and the root font-size is set as a
 * percentage so every rem-based utility scales app-wide.
 */
export function applyFontScale(scale: number | undefined, root: HTMLElement): void {
  const requested = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1;
  const factor = Math.min(Math.max(requested, FONT_SCALE_MIN), FONT_SCALE_MAX);
  root.style.setProperty('--font-scale', String(factor));
  // Round: 1.1 * 100 is 110.00000000000001 in IEEE-754.
  root.style.fontSize = `${Math.round(factor * 100)}%`;
}
