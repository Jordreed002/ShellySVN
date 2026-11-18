import { describe, expect, it } from 'vitest';

import { ariaShortcut, displayShortcut, formatShortcut, isMacPlatform } from '../platformKeys';

describe('platformKeys', () => {
  it('detects macOS from the platform string', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('macOS')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
  });

  it('renders the primary modifier as Ctrl off macOS', () => {
    expect(formatShortcut('Ctrl+K', false)).toBe('Ctrl+K');
    expect(formatShortcut('Ctrl+Shift+A', false)).toBe('Ctrl+Shift+A');
    expect(formatShortcut('Ctrl+Alt+P', false)).toBe('Ctrl+Alt+P');
    expect(formatShortcut('F5', false)).toBe('F5');
  });

  it('renders macOS symbols in Apple order without separators', () => {
    expect(formatShortcut('Ctrl+K', true)).toBe('⌘K');
    expect(formatShortcut('Ctrl+Shift+A', true)).toBe('⇧⌘A');
    expect(formatShortcut('Ctrl+Alt+P', true)).toBe('⌥⌘P');
    expect(formatShortcut('Ctrl+b', true)).toBe('⌘B');
  });

  it('translates mac-symbol menu labels for other platforms and back', () => {
    expect(displayShortcut('⌘⇧O', false)).toBe('Ctrl+Shift+O');
    expect(displayShortcut('⇧⌘C', false)).toBe('Ctrl+Shift+C');
    expect(displayShortcut('⌘L', false)).toBe('Ctrl+L');
    expect(displayShortcut('⌘⇧O', true)).toBe('⇧⌘O');
    expect(displayShortcut('Ctrl+Shift+P', true)).toBe('⇧⌘P');
    expect(displayShortcut('↵', false)).toBe('↵');
    expect(displayShortcut('F5', true)).toBe('F5');
  });

  it('builds aria-keyshortcuts for the current platform only', () => {
    expect(ariaShortcut('Ctrl+K', true)).toBe('Meta+K');
    expect(ariaShortcut('Ctrl+K', false)).toBe('Control+K');
    expect(ariaShortcut('Ctrl+Shift+A', false)).toBe('Control+Shift+A');
  });
});
