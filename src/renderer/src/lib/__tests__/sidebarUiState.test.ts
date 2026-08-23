import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SIDEBAR_UI_STATE,
  SIDEBAR_UI_STATE_KEY,
  loadSidebarUiState,
  parseSidebarUiState,
  saveSidebarUiState,
} from '../sidebarUiState';

describe('parseSidebarUiState', () => {
  it('degrades unknown payloads to the defaults', () => {
    expect(parseSidebarUiState(undefined)).toEqual(DEFAULT_SIDEBAR_UI_STATE);
    expect(parseSidebarUiState('x')).toEqual(DEFAULT_SIDEBAR_UI_STATE);
    expect(parseSidebarUiState([])).toEqual(DEFAULT_SIDEBAR_UI_STATE);
  });

  it('keeps valid fields and drops invalid ones', () => {
    expect(
      parseSidebarUiState({
        collapsedGroups: ['g1', 'g1', 42, ''],
        activeGroupFilter: 'g2',
        sortMode: 'manual',
      })
    ).toEqual({ collapsedGroups: ['g1'], activeGroupFilter: 'g2', sortMode: 'manual' });

    expect(parseSidebarUiState({ activeGroupFilter: 7, sortMode: 'bogus' })).toEqual({
      collapsedGroups: [],
      activeGroupFilter: null,
      sortMode: 'default',
    });
  });
});

describe('sidebar ui state persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips through the store under the v1 key', async () => {
    const store = new Map<string, unknown>();
    window.api = {
      store: {
        get: vi.fn(async (key: string) => store.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
        }),
      },
    } as unknown as Window['api'];

    const state = { collapsedGroups: ['g1', 'g2'], activeGroupFilter: 'g1', sortMode: 'name' };
    await saveSidebarUiState(state);
    expect(window.api.store.set).toHaveBeenCalledWith(SIDEBAR_UI_STATE_KEY, state);
    await expect(loadSidebarUiState()).resolves.toEqual(state);
  });

  it('storage failures degrade to the defaults', async () => {
    window.api = {
      store: {
        get: vi.fn(async () => {
          throw new Error('store offline');
        }),
        set: vi.fn(),
      },
    } as unknown as Window['api'];
    await expect(loadSidebarUiState()).resolves.toEqual(DEFAULT_SIDEBAR_UI_STATE);
  });
});
