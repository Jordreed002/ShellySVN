import { describe, expect, it, vi } from 'vitest';
import {
  loadPaletteUsage,
  parsePaletteUsage,
  recordPaletteUsage,
  savePaletteUsage,
} from '../commandPaletteUsage';

describe('parsePaletteUsage', () => {
  it('keeps numeric timestamps and drops everything else', () => {
    expect(
      parsePaletteUsage({ a: 10, b: 'nope', c: -1, d: 0, e: Number.NaN })
    ).toEqual({ a: 10 });
  });

  it('returns an empty map for non-object payloads', () => {
    expect(parsePaletteUsage(null)).toEqual({});
    expect(parsePaletteUsage('x')).toEqual({});
    expect(parsePaletteUsage([1, 2])).toEqual({});
  });
});

describe('recordPaletteUsage', () => {
  it('records an execution timestamp', () => {
    expect(recordPaletteUsage({}, 'commit', 5)).toEqual({ commit: 5 });
  });

  it('caps the map, evicting the stalest entries', () => {
    let usage: Record<string, number> = {};
    for (let index = 0; index < 14; index += 1) {
      usage = recordPaletteUsage(usage, `cmd-${index}`, index);
    }
    const ids = Object.keys(usage);
    expect(ids).toHaveLength(12);
    expect(ids).not.toContain('cmd-0');
    expect(ids).not.toContain('cmd-1');
    expect(ids).toContain('cmd-13');
  });
});

describe('store bridge', () => {
  it('loads persisted usage and degrades to empty on failure', async () => {
    const get = vi.fn().mockResolvedValue({ commit: 7 });
    window.api = { store: { get, set: vi.fn() } } as unknown as Window['api'];
    await expect(loadPaletteUsage()).resolves.toEqual({ commit: 7 });
    expect(get).toHaveBeenCalledWith('shellysvn:palette-recent-usage');

    window.api = undefined as unknown as Window['api'];
    await expect(loadPaletteUsage()).resolves.toEqual({});
  });

  it('persists usage and swallows store failures', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    window.api = { store: { get: vi.fn(), set } } as unknown as Window['api'];
    await savePaletteUsage({ commit: 7 });
    expect(set).toHaveBeenCalledWith('shellysvn:palette-recent-usage', { commit: 7 });

    window.api = undefined as unknown as Window['api'];
    await expect(savePaletteUsage({ commit: 7 })).resolves.toBeUndefined();
  });
});
