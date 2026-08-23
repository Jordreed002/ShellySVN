import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import {
  formatShelfAge,
  isShelfStale,
  loadShelfManagerConfig,
  parseShelfManagerConfig,
  saveShelfManagerConfig,
  shelfAgeDays,
  SHELF_MANAGER_CONFIG_KEY,
} from '../shelfManager';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const NOW_DATE = new Date(NOW);

describe('parseShelfManagerConfig', () => {
  it('falls back to the default for malformed payloads', () => {
    expect(parseShelfManagerConfig(undefined)).toEqual({ maxAgeDays: 30 });
    expect(parseShelfManagerConfig('nope')).toEqual({ maxAgeDays: 30 });
    expect(parseShelfManagerConfig({ maxAgeDays: 'soon' })).toEqual({ maxAgeDays: 30 });
    expect(parseShelfManagerConfig({ maxAgeDays: -5 })).toEqual({ maxAgeDays: 30 });
  });

  it('accepts null (nudges off) and positive integers', () => {
    expect(parseShelfManagerConfig({ maxAgeDays: null })).toEqual({ maxAgeDays: null });
    expect(parseShelfManagerConfig({ maxAgeDays: 14 })).toEqual({ maxAgeDays: 14 });
    expect(parseShelfManagerConfig({ maxAgeDays: 14.9 })).toEqual({ maxAgeDays: 14 });
  });
});

describe('shelfManager persistence', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = new Map();
    window.api = createMockElectronAPI();
    window.api.store.get = vi.fn(async (key: string) => store.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips the config through the store', async () => {
    await saveShelfManagerConfig({ maxAgeDays: 7 });
    expect(store.get(SHELF_MANAGER_CONFIG_KEY)).toEqual({ maxAgeDays: 7 });
    expect(await loadShelfManagerConfig()).toEqual({ maxAgeDays: 7 });
  });

  it('returns defaults when nothing is stored yet', async () => {
    expect(await loadShelfManagerConfig()).toEqual({ maxAgeDays: 30 });
  });
});

describe('shelfAgeDays / isShelfStale', () => {
  it('computes whole days since creation', () => {
    expect(shelfAgeDays('2026-08-23T12:00:00.000Z', NOW)).toBe(0);
    expect(shelfAgeDays('2026-08-22T12:00:00.000Z', NOW)).toBe(1);
    expect(shelfAgeDays('2026-08-20T18:00:00.000Z', NOW)).toBe(2);
    expect(shelfAgeDays('not-a-date', NOW)).toBe(0);
    expect(shelfAgeDays('2026-08-24T00:00:00.000Z', NOW_DATE)).toBe(-1); // future date
  });

  it('flags shelves at or past the limit and respects nudges-off', () => {
    const shelfDate = '2026-07-01T00:00:00.000Z'; // 53 days before NOW
    expect(isShelfStale(shelfDate, 30, NOW)).toBe(true);
    expect(isShelfStale(shelfDate, 60, NOW)).toBe(false);
    expect(isShelfStale(shelfDate, null, NOW)).toBe(false);
  });
});

describe('formatShelfAge', () => {
  it('formats ages compactly', () => {
    expect(formatShelfAge(0)).toBe('today');
    expect(formatShelfAge(1)).toBe('1 day');
    expect(formatShelfAge(5)).toBe('5 days');
    expect(formatShelfAge(13)).toBe('13 days');
    expect(formatShelfAge(21)).toBe('3 weeks');
    expect(formatShelfAge(90)).toBe('3 months');
    expect(formatShelfAge(800)).toBe('2 years');
  });
});
