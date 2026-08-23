/**
 * React binding for the working-copy groups store (#59).
 *
 * Same shape as the sidebar's existing `usePinnedRepos`: load from
 * `window.api.store` once on mount, keep an optimistic in-memory copy, and
 * persist on every mutation. All decisions live in the pure
 * `lib/workingCopyGroups.ts` helpers, so this hook is wiring only.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  EMPTY_WORKING_COPY_GROUPS,
  assignWorkingCopy,
  createGroup,
  deleteGroup,
  loadWorkingCopyGroups,
  moveWorkingCopy,
  nudgeGroup,
  renameGroup,
  reorderGroups,
  saveWorkingCopyGroups,
  type WorkingCopyGroupsState,
} from '@renderer/lib/workingCopyGroups';

export interface UseWorkingCopyGroupsResult {
  state: WorkingCopyGroupsState;
  isLoaded: boolean;
  create: (name: string) => Promise<string | null>;
  rename: (groupId: string, name: string) => void;
  remove: (groupId: string) => void;
  reorder: (orderedIds: readonly string[]) => void;
  nudge: (groupId: string, direction: -1 | 1) => void;
  assign: (path: string, groupId: string | null) => void;
  move: (path: string, beforePath: string | null) => void;
}

export function useWorkingCopyGroups(): UseWorkingCopyGroupsResult {
  const [state, setState] = useState<WorkingCopyGroupsState>(EMPTY_WORKING_COPY_GROUPS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWorkingCopyGroups()
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      let createdId: string | null = null;
      setState((current) => {
        const result = createGroup(current, name);
        if (!result) return current;
        createdId = result.group.id;
        void saveWorkingCopyGroups(result.state).catch(() => undefined);
        return result.state;
      });
      return createdId;
    },
    []
  );

  const rename = useCallback(
    (groupId: string, name: string) => {
      setState((current) => {
        const next = renameGroup(current, groupId, name);
        if (next === current) return current;
        void saveWorkingCopyGroups(next).catch(() => undefined);
        return next;
      });
    },
    []
  );

  const remove = useCallback(
    (groupId: string) => {
      setState((current) => {
        const next = deleteGroup(current, groupId);
        if (next === current) return current;
        void saveWorkingCopyGroups(next).catch(() => undefined);
        return next;
      });
    },
    []
  );

  const reorder = useCallback(
    (orderedIds: readonly string[]) => {
      setState((current) => {
        const next = reorderGroups(current, orderedIds);
        if (next === current) return current;
        void saveWorkingCopyGroups(next).catch(() => undefined);
        return next;
      });
    },
    []
  );

  const nudge = useCallback(
    (groupId: string, direction: -1 | 1) => {
      setState((current) => {
        const next = nudgeGroup(current, groupId, direction);
        if (next === current) return current;
        void saveWorkingCopyGroups(next).catch(() => undefined);
        return next;
      });
    },
    []
  );

  const assign = useCallback((path: string, groupId: string | null) => {
    setState((current) => {
      const next = assignWorkingCopy(current, path, groupId);
      if (next === current) return current;
      void saveWorkingCopyGroups(next).catch(() => undefined);
      return next;
    });
  }, []);

  const move = useCallback((path: string, beforePath: string | null) => {
    setState((current) => {
      const next = moveWorkingCopy(current, path, beforePath);
      if (next === current) return current;
      void saveWorkingCopyGroups(next).catch(() => undefined);
      return next;
    });
  }, []);

  return {
    state,
    isLoaded,
    create,
    rename,
    remove,
    reorder,
    nudge,
    assign,
    move,
  };
}
