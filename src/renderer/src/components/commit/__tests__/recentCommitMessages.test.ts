import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  MAX_RECENT_MESSAGES_PER_WC,
  addRecentMessageToStore,
  loadRecentMessages,
  parseRecentMessageStore,
  pruneWorkingCopies,
  trimRecentMessages,
} from '../recentCommitMessages';
import { useRecentCommitMessages } from '../useRecentCommitMessages';

describe('recentCommitMessages store', () => {
  it('parses a valid payload and drops junk entries', () => {
    const store = parseRecentMessageStore({
      '/repo/a': [
        { message: 'fix: one', timestamp: 10 },
        { message: '', timestamp: 20 },
        'nonsense',
        { message: '  fix: two  ', timestamp: 30 },
      ],
      notAnArray: { message: 'x' },
    });
    expect(store['/repo/a']).toEqual([
      { message: 'fix: two', timestamp: 30 },
      { message: 'fix: one', timestamp: 10 },
    ]);
    expect(store.notAnArray).toBeUndefined();
  });

  it('rejects non-object payloads', () => {
    expect(parseRecentMessageStore(null)).toEqual({});
    expect(parseRecentMessageStore('nope')).toEqual({});
    expect(parseRecentMessageStore([1, 2])).toEqual({});
  });

  it('dedupes by message (keeping the newest) and caps at 20', () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      message: `msg ${index}`,
      timestamp: index,
    }));
    entries.push({ message: 'msg 10', timestamp: 999 });

    const trimmed = trimRecentMessages(entries);
    expect(trimmed).toHaveLength(MAX_RECENT_MESSAGES_PER_WC);
    expect(trimmed[0]).toEqual({ message: 'msg 10', timestamp: 999 });
    expect(trimmed.filter((entry) => entry.message === 'msg 10')).toHaveLength(1);
    // Oldest entries beyond the cap are dropped.
    expect(trimmed.some((entry) => entry.message === 'msg 0')).toBe(false);
  });

  it('normalizes working copy keys so path spelling does not fork the list', () => {
    let store = addRecentMessageToStore({}, '/Repo/A/', 'first', 100);
    store = addRecentMessageToStore(store, '\\Repo\\a', 'second', 200);

    expect(Object.keys(store)).toEqual(['/repo/a']);
    expect(store['/repo/a'].map((entry) => entry.message)).toEqual(['second', 'first']);
  });

  it('evicts the least recently used working copies beyond the cap', () => {
    const store: Record<string, { message: string; timestamp: number }[]> = {};
    for (let index = 0; index < 60; index++) {
      store[`/repo/${index}`] = [{ message: 'm', timestamp: index }];
    }
    const pruned = pruneWorkingCopies(store);
    expect(Object.keys(pruned)).toHaveLength(50);
    // Newest working copies survive; the oldest go.
    expect(pruned['/repo/59']).toBeDefined();
    expect(pruned['/repo/0']).toBeUndefined();
  });

  it('re-adding an existing message moves it to the front without duplicates', () => {
    let store = addRecentMessageToStore({}, '/repo', 'first', 100);
    store = addRecentMessageToStore(store, '/repo', 'second', 200);
    store = addRecentMessageToStore(store, '/repo', 'first', 300);

    expect(store['/repo'].map((entry) => entry.message)).toEqual(['first', 'second']);
    expect(store['/repo'][0].timestamp).toBe(300);
  });
});

describe('useRecentCommitMessages hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupStore(initial: unknown) {
    const saved: unknown[] = [];
    const get = vi.fn().mockResolvedValue(initial);
    const set = vi.fn().mockImplementation((_key: string, value: unknown) => {
      saved.push(value);
      return Promise.resolve();
    });
    window.api = { store: { get, set } } as unknown as Window['api'];
    return { get, set, saved };
  }

  it('loads the per-working-copy list on mount', async () => {
    setupStore({
      '/repo': [
        { message: 'fix: crash', timestamp: 5 },
        { message: 'feat: panel', timestamp: 4 },
      ],
    });
    const { result } = renderHook(() => useRecentCommitMessages('/repo'));
    await waitFor(() => expect(result.current.recentMessages).toHaveLength(2));
    expect(result.current.recentMessages[0].message).toBe('fix: crash');
  });

  it('persists a new message and keeps it deduped and capped', async () => {
    const stored: Record<string, unknown> = {
      'shellysvn:recent-commit-messages:v1': {
        '/repo': Array.from({ length: MAX_RECENT_MESSAGES_PER_WC }, (_, index) => ({
          message: `old ${index}`,
          timestamp: index,
        })),
      },
    };
    const get = vi.fn().mockImplementation((key: string) => Promise.resolve(stored[key]));
    const set = vi.fn().mockImplementation((key: string, value: unknown) => {
      stored[key] = value;
      return Promise.resolve();
    });
    window.api = { store: { get, set } } as unknown as Window['api'];

    const { result } = renderHook(() => useRecentCommitMessages('/repo'));
    await waitFor(() => expect(result.current.recentMessages).toHaveLength(20));

    await act(async () => {
      await result.current.addRecentMessage('fix: brand new');
    });

    expect(result.current.recentMessages[0].message).toBe('fix: brand new');
    expect(result.current.recentMessages).toHaveLength(MAX_RECENT_MESSAGES_PER_WC);
    expect(set).toHaveBeenCalled();
    const persisted = stored['shellysvn:recent-commit-messages:v1'] as Record<
      string,
      { message: string }[]
    >;
    expect(persisted['/repo'][0].message).toBe('fix: brand new');
    expect(persisted['/repo']).toHaveLength(MAX_RECENT_MESSAGES_PER_WC);
  });

  it('degrades to an empty list when storage fails', async () => {
    window.api = {
      store: {
        get: vi.fn().mockRejectedValue(new Error('boom')),
        set: vi.fn(),
      },
    } as unknown as Window['api'];
    const { result } = renderHook(() => useRecentCommitMessages('/repo'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.recentMessages).toEqual([]);
  });
});

describe('loadRecentMessages', () => {
  it('returns an empty list for an empty working copy path', async () => {
    window.api = { store: { get: vi.fn(), set: vi.fn() } } as unknown as Window['api'];
    await expect(loadRecentMessages('')).resolves.toEqual([]);
  });
});
