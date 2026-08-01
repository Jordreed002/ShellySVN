import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeDeep, mergeSettings } from '../settings-defaults';

/**
 * J11 — Settings & configuration.
 *
 * Stored settings are partials persisted across versions, so `mergeSettings`
 * must deep-merge a user's slice over the defaults without dropping nested
 * fields, concatenating arrays, or mutating the canonical defaults. A subtle
 * regression here silently corrupts every user's config on next load.
 */
describe('mergeDeep', () => {
  it('deep-merges nested objects', () => {
    const target = { a: 1, nested: { x: 1, y: 2 } };
    const out = mergeDeep(target, { nested: { y: 9, z: 3 } });
    expect(out).toEqual({ a: 1, nested: { x: 1, y: 9, z: 3 } });
  });

  it('overrides primitives at the top level', () => {
    expect(mergeDeep({ a: 1, b: 2 }, { b: 99 })).toEqual({ a: 1, b: 99 });
  });

  it('replaces arrays rather than merging them', () => {
    const out = mergeDeep({ list: [1, 2, 3] } as Record<string, unknown>, { list: [9] });
    expect(out.list).toEqual([9]);
  });

  it('does not mutate the target', () => {
    const target = { nested: { x: 1 } };
    mergeDeep(target, { nested: { y: 2 } });
    expect(target.nested).toEqual({ x: 1 });
  });

  it('returns a copy of target when source is undefined or non-object', () => {
    const target = { a: 1 };
    expect(mergeDeep(target, undefined)).toEqual({ a: 1 });
    expect(mergeDeep(target, null as unknown as undefined)).toEqual({ a: 1 });
  });
});

describe('mergeSettings', () => {
  it('returns the full defaults when called with no updates', () => {
    expect(mergeSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides a top-level primitive and leaves the rest default', () => {
    const merged = mergeSettings({ theme: 'dark' });
    expect(merged.theme).toBe('dark');
    expect(merged.updateChannel).toBe(DEFAULT_SETTINGS.updateChannel);
  });

  it('deep-merges a nested settings group, preserving sibling fields', () => {
    const merged = mergeSettings({ diffMerge: { contextLines: 10 } });
    expect(merged.diffMerge.contextLines).toBe(10);
    // Sibling fields in the same group are NOT dropped.
    expect(merged.diffMerge.ignoreWhitespace).toBe(DEFAULT_SETTINGS.diffMerge.ignoreWhitespace);
    expect(merged.diffMerge.externalDiffTool).toBe(DEFAULT_SETTINGS.diffMerge.externalDiffTool);
  });

  it('replaces array settings instead of concatenating', () => {
    const merged = mergeSettings({ recentRepositories: ['/a', '/b'] });
    expect(merged.recentRepositories).toEqual(['/a', '/b']);
  });

  it('does not mutate the canonical DEFAULT_SETTINGS', () => {
    const original = { ...DEFAULT_SETTINGS.diffMerge };
    mergeSettings({ diffMerge: { contextLines: 99 } });
    expect(DEFAULT_SETTINGS.diffMerge).toEqual(original);
  });

  it('produces a result with every default key present', () => {
    const merged = mergeSettings({ theme: 'light' });
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(merged).toHaveProperty(key);
    }
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('pins security- and behavior-sensitive defaults', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.updateChannel).toBe('stable');
    expect(DEFAULT_SETTINGS.confirmDestructiveOps).toBe(true);
    expect(DEFAULT_SETTINGS.sslVerify).toBe(true);
    expect(DEFAULT_SETTINGS.connectionTimeout).toBe(30);
    expect(DEFAULT_SETTINGS.hasCompletedTutorial).toBe(false);
  });

  it('starts with empty credential and history stores', () => {
    expect(DEFAULT_SETTINGS.savedCredentials).toEqual([]);
    expect(DEFAULT_SETTINGS.recentRepositories).toEqual([]);
    expect(DEFAULT_SETTINGS.bookmarks).toEqual([]);
  });
});
