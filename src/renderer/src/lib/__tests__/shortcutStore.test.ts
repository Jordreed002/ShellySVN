import { describe, expect, it } from 'vitest';
import {
  findConflictingBinding,
  findConflicts,
  normalizeShortcutKey,
  parseLegacyShortcutBindings,
  parseShortcutOverrides,
  resolveBindings,
  toOverrideMap,
} from '../shortcutStore';
import type { ShortcutBinding } from '../../hooks/useShortcutBindings';

function binding(overrides: Partial<ShortcutBinding>): ShortcutBinding {
  return {
    id: 'commit',
    name: 'Commit',
    category: 'svn-operations',
    defaultKey: 'Ctrl+S',
    currentKey: 'Ctrl+S',
    enabled: true,
    ...overrides,
  };
}

describe('normalizeShortcutKey', () => {
  it('produces the canonical modifier order and casing', () => {
    expect(normalizeShortcutKey('ctrl+s')).toBe('Ctrl+S');
    expect(normalizeShortcutKey('Shift+Ctrl+K')).toBe('Ctrl+Shift+K');
    expect(normalizeShortcutKey('Meta+K')).toBe('Ctrl+K');
    expect(normalizeShortcutKey('⌘⇧A')).toBe('Ctrl+Shift+A');
    expect(normalizeShortcutKey('alt+f5')).toBe('Alt+F5');
    expect(normalizeShortcutKey('f5')).toBe('F5');
    expect(normalizeShortcutKey('ArrowUp')).toBe('ArrowUp');
    expect(normalizeShortcutKey('Ctrl+,')).toBe('Ctrl+,');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeShortcutKey('')).toBe('');
    expect(normalizeShortcutKey('  ')).toBe('');
  });
});

describe('parseShortcutOverrides', () => {
  it('accepts a valid override map and normalizes keys', () => {
    expect(
      parseShortcutOverrides({
        commit: { key: 'shift+ctrl+k', enabled: true },
        log: { key: 'Ctrl+L' },
        refresh: { key: 'F5', enabled: false },
      })
    ).toEqual({
      commit: { key: 'Ctrl+Shift+K', enabled: true },
      log: { key: 'Ctrl+L', enabled: true },
      refresh: { key: 'F5', enabled: false },
    });
  });

  it('drops malformed entries and non-object payloads', () => {
    expect(parseShortcutOverrides({ commit: 'Ctrl+S', log: null, ok: { key: 'F1' } })).toEqual({
      ok: { key: 'F1', enabled: true },
    });
    expect(parseShortcutOverrides(null)).toEqual({});
    expect(parseShortcutOverrides([{ id: 'commit' }])).toEqual({});
  });
});

describe('parseLegacyShortcutBindings', () => {
  it('converts the pre-#78 full-array payload into an override map', () => {
    expect(
      parseLegacyShortcutBindings([
        { id: 'commit', currentKey: 'Ctrl+Shift+K', enabled: true },
        { id: 'broken' },
        'nonsense',
      ])
    ).toEqual({ commit: { key: 'Ctrl+Shift+K', enabled: true } });
  });

  it('ignores non-array payloads', () => {
    expect(parseLegacyShortcutBindings({ commit: { key: 'Ctrl+S' } })).toEqual({});
  });
});

describe('resolveBindings', () => {
  const defaults = [
    binding({ id: 'commit', name: 'Commit' }),
    binding({ id: 'update', name: 'Update', defaultKey: 'Ctrl+U', currentKey: 'Ctrl+U' }),
  ];

  it('applies overrides and ignores stale ids', () => {
    const resolved = resolveBindings(defaults, {
      commit: { key: 'Ctrl+Shift+K', enabled: false },
      'removed-in-v2': { key: 'Ctrl+Q', enabled: true },
    });
    expect(resolved[0]).toMatchObject({ id: 'commit', currentKey: 'Ctrl+Shift+K', enabled: false });
    expect(resolved[1]).toMatchObject({ id: 'update', currentKey: 'Ctrl+U', enabled: true });
  });

  it('keeps defaults untouched for bindings without overrides', () => {
    expect(resolveBindings(defaults, {})).toEqual(defaults);
  });
});

describe('conflict detection', () => {
  const bindings = [
    binding({ id: 'commit', name: 'Commit', currentKey: 'Ctrl+S' }),
    binding({ id: 'diff', name: 'Diff', currentKey: 'ctrl+s' }),
    binding({ id: 'log', name: 'Log', currentKey: 'Ctrl+L', enabled: false }),
    binding({ id: 'update', name: 'Update', currentKey: 'Ctrl+L', enabled: false }),
  ];

  it('flags enabled bindings that normalize to the same key', () => {
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ key: 'Ctrl+S', bindingIds: ['commit', 'diff'] });
  });

  it('finds the binding a new key would collide with', () => {
    expect(findConflictingBinding(bindings, 'log', 'ctrl+s')?.id).toBe('commit');
    // Both current holders of the key are reported for either binding.
    expect(findConflictingBinding(bindings, 'commit', 'Ctrl+S')?.id).toBe('diff');
    // Disabled bindings never conflict, and keys can collide with themselves.
    expect(findConflictingBinding(bindings, 'log', 'Ctrl+L')).toBeUndefined();
    expect(findConflictingBinding(bindings, 'diff', 'Ctrl+D')).toBeUndefined();
  });
});

describe('toOverrideMap', () => {
  it('persists only the deltas from the defaults', () => {
    const map = toOverrideMap([
      binding({ id: 'commit', currentKey: 'Ctrl+Shift+K' }),
      binding({ id: 'update', defaultKey: 'Ctrl+U', currentKey: 'Ctrl+U', enabled: false }),
      binding({ id: 'log', defaultKey: 'Ctrl+L', currentKey: 'Ctrl+L' }),
    ]);
    expect(map).toEqual({
      commit: { key: 'Ctrl+Shift+K', enabled: true },
      update: { key: 'Ctrl+U', enabled: false },
    });
  });

  it('saves nothing when everything is default', () => {
    expect(toOverrideMap([binding({})])).toEqual({});
  });
});
