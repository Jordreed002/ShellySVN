/**
 * Per-repository sort persistence (#68): strict parsing, read-modify-write
 * persistence, and the toggle rule the header clicks rely on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  DEFAULT_REPO_SORT,
  loadRepoSort,
  loadRepoSortMap,
  normalizeRepoSort,
  nextSortAfter,
  parseRepoSortMap,
  persistRepoSort,
  REPO_BROWSER_SORT_KEY,
} from '../lib/repoSortStore';
import { useRepoSort } from '../hooks/useRepoSort';

const storeGet = vi.fn<() => Promise<unknown>>(async () => undefined);
const storeSet = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  storeGet.mockImplementation(async () => undefined);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { store: { get: storeGet, set: storeSet } },
  });
});

describe('normalizeRepoSort', () => {
  it('accepts every sortable column with either direction', () => {
    expect(normalizeRepoSort({ key: 'name', direction: 'asc' })).toEqual({
      key: 'name',
      direction: 'asc',
    });
    expect(normalizeRepoSort({ key: 'date', direction: 'desc' })).toEqual({
      key: 'date',
      direction: 'desc',
    });
    expect(normalizeRepoSort({ key: 'size', direction: 'asc' })).not.toBeNull();
    expect(normalizeRepoSort({ key: 'author', direction: 'desc' })).not.toBeNull();
    expect(normalizeRepoSort({ key: 'revision', direction: 'asc' })).not.toBeNull();
    expect(normalizeRepoSort({ key: 'status', direction: 'desc' })).not.toBeNull();
  });

  it('rejects unknown keys, directions and non-objects', () => {
    expect(normalizeRepoSort({ key: 'kind', direction: 'asc' })).toBeNull();
    expect(normalizeRepoSort({ key: 'name', direction: 'ascending' })).toBeNull();
    expect(normalizeRepoSort(null)).toBeNull();
    expect(normalizeRepoSort('name')).toBeNull();
  });
});

describe('parseRepoSortMap', () => {
  it('keeps valid entries and drops invalid ones', () => {
    const map = parseRepoSortMap({
      'https://a': { key: 'date', direction: 'desc' },
      'https://b': { key: 'bogus', direction: 'asc' },
      'https://c': 'name',
    });
    expect(map).toEqual({ 'https://a': { key: 'date', direction: 'desc' } });
  });

  it('treats arrays and null as an empty map', () => {
    expect(parseRepoSortMap([1, 2])).toEqual({});
    expect(parseRepoSortMap(null)).toEqual({});
  });
});

describe('persistence', () => {
  it('loads a stored sort for the repository', async () => {
    storeGet.mockImplementation(async (key: string) =>
      key === REPO_BROWSER_SORT_KEY
        ? { 'https://svn.example.com/repo': { key: 'author', direction: 'desc' } }
        : undefined
    );
    await expect(loadRepoSort('https://svn.example.com/repo')).resolves.toEqual({
      key: 'author',
      direction: 'desc',
    });
    await expect(loadRepoSort('https://other')).resolves.toBeNull();
  });

  it('degrades to an empty map when the store throws', async () => {
    storeGet.mockRejectedValue(new Error('store locked'));
    await expect(loadRepoSortMap()).resolves.toEqual({});
  });

  it('persists one repository without clobbering another (read-modify-write)', async () => {
    storeGet.mockImplementation(async () => ({
      'https://keep': { key: 'size', direction: 'asc' },
    }));
    await persistRepoSort('https://new', { key: 'name', direction: 'desc' });
    expect(storeSet).toHaveBeenCalledWith(REPO_BROWSER_SORT_KEY, {
      'https://keep': { key: 'size', direction: 'asc' },
      'https://new': { key: 'name', direction: 'desc' },
    });
  });
});

describe('nextSortAfter', () => {
  it('reverses the active column and switches to a new one ascending', () => {
    expect(nextSortAfter({ key: 'name', direction: 'asc' }, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    });
    expect(nextSortAfter({ key: 'name', direction: 'desc' }, 'name')).toEqual({
      key: 'name',
      direction: 'asc',
    });
    expect(nextSortAfter({ key: 'name', direction: 'desc' }, 'date')).toEqual({
      key: 'date',
      direction: 'asc',
    });
  });
});

describe('useRepoSort', () => {
  it('applies the stored sort once it loads', async () => {
    storeGet.mockImplementation(async () => ({
      'https://svn.example.com/repo': { key: 'date', direction: 'desc' },
    }));
    const { result } = renderHook(() => useRepoSort('https://svn.example.com/repo'));
    expect(result.current.sort).toEqual(DEFAULT_REPO_SORT);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.sort).toEqual({ key: 'date', direction: 'desc' });
  });

  it('persists user choices and never lets a late store read overwrite them', async () => {
    // Only the initial load hangs; the read-modify-write inside persist must
    // be allowed to resolve, so every later get returns immediately.
    let firstRead = true;
    let releaseStored: ((value: unknown) => void) | null = null;
    storeGet.mockImplementation(() => {
      if (!firstRead) return Promise.resolve(undefined);
      firstRead = false;
      return new Promise((resolve) => {
        releaseStored = resolve;
      });
    });

    const { result } = renderHook(() => useRepoSort('https://svn.example.com/repo'));
    // The user sorts before the store answers.
    act(() => result.current.setSortKey('author'));
    expect(result.current.sort).toEqual({ key: 'author', direction: 'asc' });

    releaseStored?.({ 'https://svn.example.com/repo': { key: 'date', direction: 'desc' } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    // The click wins over the stored value.
    expect(result.current.sort).toEqual({ key: 'author', direction: 'asc' });

    await waitFor(() =>
      expect(storeSet).toHaveBeenCalledWith(REPO_BROWSER_SORT_KEY, {
        'https://svn.example.com/repo': { key: 'author', direction: 'asc' },
      })
    );
  });

  it('reloads when the repository changes', async () => {
    storeGet.mockImplementation(async () => ({
      'https://two': { key: 'size', direction: 'desc' },
    }));
    const { result, rerender } = renderHook((url: string) => useRepoSort(url), {
      initialProps: 'https://one',
    });
    act(() => result.current.setSortKey('revision'));

    rerender('https://two');
    await waitFor(() => expect(result.current.sort).toEqual({ key: 'size', direction: 'desc' }));
  });
});
