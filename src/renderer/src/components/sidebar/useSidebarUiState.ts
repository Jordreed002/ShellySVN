/**
 * Sidebar UI state, restored from `window.api.store` on mount and persisted on
 * every change (#84, sidebar slice). See `lib/sidebarUiState.ts` for what is
 * stored and why it stops at the sidebar's own chrome.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_SIDEBAR_UI_STATE,
  loadSidebarUiState,
  saveSidebarUiState,
  type SidebarSortMode,
  type SidebarUiState,
} from '@renderer/lib/sidebarUiState';

export interface UseSidebarUiStateResult {
  state: SidebarUiState;
  isLoaded: boolean;
  setSortMode: (mode: SidebarSortMode) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  setActiveGroupFilter: (groupId: string | null) => void;
}

export function useSidebarUiState(): UseSidebarUiStateResult {
  const [state, setState] = useState<SidebarUiState>(DEFAULT_SIDEBAR_UI_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSidebarUiState()
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const update = useCallback((patch: Partial<SidebarUiState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      // Debounced write: collapse-all style interactions fire one event per
      // group and there is no reason to hit the store for each.
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void saveSidebarUiState(next).catch(() => undefined);
      }, 150);
      return next;
    });
  }, []);

  const setSortMode = useCallback((mode: SidebarSortMode) => update({ sortMode: mode }), [update]);

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      setState((current) => {
        const collapsed = current.collapsedGroups.includes(groupId)
          ? current.collapsedGroups.filter((id) => id !== groupId)
          : [...current.collapsedGroups, groupId];
        const next = { ...current, collapsedGroups: collapsed };
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void saveSidebarUiState(next).catch(() => undefined);
        }, 150);
        return next;
      });
    },
    []
  );

  const setActiveGroupFilter = useCallback(
    (groupId: string | null) => update({ activeGroupFilter: groupId }),
    [update]
  );

  return { state, isLoaded, setSortMode, toggleGroupCollapsed, setActiveGroupFilter };
}
