import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  isDiffComparisonSide,
  loadSavedComparisons,
  newComparisonId,
  parseSavedComparisons,
  SAVED_COMPARISONS_KEY,
  saveSavedComparisons,
} from '../savedComparisons';

const validSide = { kind: 'url', target: '^/trunk', revision: 'HEAD' };

describe('parseSavedComparisons', () => {
  it('accepts a valid saved list', () => {
    const parsed = parseSavedComparisons([
      {
        id: 'cmp-1',
        name: 'trunk vs payments',
        left: validSide,
        right: { kind: 'working-copy', target: '/Users/jordan/dev/repo', revision: 'BASE' },
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].right.kind).toBe('working-copy');
  });

  it('drops malformed entries and non-array payloads', () => {
    expect(parseSavedComparisons('nope')).toEqual([]);
    expect(parseSavedComparisons(null)).toEqual([]);
    expect(
      parseSavedComparisons([
        { id: 1, name: 'x', left: validSide, right: validSide },
        { id: 'ok', name: 'fine', left: validSide, right: validSide },
        { id: 'bad', name: 'bad left', left: { kind: 'nope' }, right: validSide },
      ])
    ).toEqual([{ id: 'ok', name: 'fine', left: validSide, right: validSide, createdAt: expect.any(String) }]);
  });

  it('defaults a missing createdAt to now', () => {
    const parsed = parseSavedComparisons([
      { id: 'a', name: 'a', left: validSide, right: validSide },
    ]);
    expect(Number.isNaN(Date.parse(parsed[0].createdAt))).toBe(false);
  });
});

describe('isDiffComparisonSide', () => {
  it('requires a known kind and non-empty strings', () => {
    expect(isDiffComparisonSide(validSide)).toBe(true);
    expect(isDiffComparisonSide({ ...validSide, target: '' })).toBe(false);
    expect(isDiffComparisonSide({ ...validSide, revision: '' })).toBe(false);
    expect(isDiffComparisonSide({ kind: 'both', target: 'x', revision: 'HEAD' })).toBe(false);
    expect(isDiffComparisonSide(null)).toBe(false);
  });
});

describe('loadSavedComparisons / saveSavedComparisons', () => {
  const store = {
    get: vi.fn<(key: string) => Promise<unknown>>(),
    set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
  };

  beforeEach(() => {
    vi.stubGlobal('window', { api: { store } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips through the store bridge', async () => {
    store.get.mockResolvedValue([
      { id: 'cmp-1', name: 'mine', left: validSide, right: validSide, createdAt: '2026-08-01' },
    ]);
    await expect(loadSavedComparisons()).resolves.toHaveLength(1);
    expect(store.get).toHaveBeenCalledWith(SAVED_COMPARISONS_KEY);

    await saveSavedComparisons([]);
    expect(store.set).toHaveBeenCalledWith(SAVED_COMPARISONS_KEY, []);
  });

  it('degrades to an empty list when storage throws', async () => {
    store.get.mockRejectedValue(new Error('disk gone'));
    await expect(loadSavedComparisons()).resolves.toEqual([]);
  });
});

describe('newComparisonId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newComparisonId()));
    expect(ids.size).toBe(50);
  });
});
