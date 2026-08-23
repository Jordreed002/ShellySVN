import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarUiState } from '../useSidebarUiState';
import { SIDEBAR_UI_STATE_KEY } from '@renderer/lib/sidebarUiState';

describe('useSidebarUiState (sidebar persistence, #84 slice)', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map();
    window.api = {
      store: {
        get: vi.fn(async (key: string) => store.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
        }),
      },
    } as unknown as Window['api'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores persisted state on mount', async () => {
    store.set(SIDEBAR_UI_STATE_KEY, {
      collapsedGroups: ['g1'],
      activeGroupFilter: 'g1',
      sortMode: 'manual',
    });

    const { result } = renderHook(() => useSidebarUiState());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.state).toEqual({
      collapsedGroups: ['g1'],
      activeGroupFilter: 'g1',
      sortMode: 'manual',
    });
  });

  it('persists sort mode, collapsed groups and the group filter', async () => {
    const { result } = renderHook(() => useSidebarUiState());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.setSortMode('name'));
    act(() => result.current.toggleGroupCollapsed('g1'));
    act(() => result.current.toggleGroupCollapsed('g1'));
    act(() => result.current.toggleGroupCollapsed('g2'));
    act(() => result.current.setActiveGroupFilter('g2'));

    // The debounced write lands shortly after the burst of toggles.
    await waitFor(
      () =>
        expect(store.get(SIDEBAR_UI_STATE_KEY)).toEqual({
          collapsedGroups: ['g2'],
          activeGroupFilter: 'g2',
          sortMode: 'name',
        }),
      { timeout: 2000 }
    );
  });

  it('starts from defaults when nothing was persisted', async () => {
    const { result } = renderHook(() => useSidebarUiState());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.state.sortMode).toBe('default');
    expect(result.current.state.collapsedGroups).toEqual([]);
    expect(result.current.state.activeGroupFilter).toBeNull();
  });
});
