import { useCallback, useEffect, useState } from 'react';
import { REVIEW_CENTER_CAPTURE_EVENT } from './reviewCenterEvents';
import {
  emptyReviewCenterWorkspace,
  parseReviewCenterWorkspace,
  reviewCenterStorageKey,
  setFindingState,
  setFindingsState,
  setGroupState,
} from './reviewCenterStore';
import type { ReviewCenterWorkspace, ReviewFindingState } from './types';

export function useAiReviewCenter(workingCopyPath: string | undefined) {
  const [workspace, setWorkspace] = useState<ReviewCenterWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workingCopyPath) {
      setWorkspace(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const stored = await window.api.store.get(reviewCenterStorageKey(workingCopyPath));
      setWorkspace(parseReviewCenterWorkspace(stored, workingCopyPath));
    } finally {
      setIsLoading(false);
    }
  }, [workingCopyPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleCapture = (event: Event) => {
      const detail = (event as CustomEvent<{ workingCopyPath: string }>).detail;
      if (detail?.workingCopyPath === workingCopyPath) void load();
    };
    window.addEventListener(REVIEW_CENTER_CAPTURE_EVENT, handleCapture);
    return () => window.removeEventListener(REVIEW_CENTER_CAPTURE_EVENT, handleCapture);
  }, [load, workingCopyPath]);

  const persist = useCallback(async (next: ReviewCenterWorkspace) => {
    setWorkspace(next);
    await window.api.store.set(reviewCenterStorageKey(next.workingCopyPath), next);
  }, []);

  const triageFinding = useCallback(
    (id: string, state: ReviewFindingState) => {
      if (workspace) void persist(setFindingState(workspace, id, state));
    },
    [persist, workspace]
  );

  /** Bulk accept/dismiss (#112). Returns false when nothing matched. */
  const triageFindings = useCallback(
    (ids: ReadonlySet<string> | readonly string[], state: ReviewFindingState) => {
      if (!workspace) return false;
      const idSet = ids instanceof Set ? ids : new Set(ids);
      if (idSet.size === 0) return false;
      const next = setFindingsState(workspace, idSet, state);
      if (next === workspace) return false;
      void persist(next);
      return true;
    },
    [persist, workspace]
  );  /** Undo support (#112): persist a previous snapshot back over the current one. */
  const restoreWorkspace = useCallback(
    (snapshot: ReviewCenterWorkspace) => {
      if (snapshot.workingCopyPath !== workingCopyPath) return;
      void persist({ ...snapshot, updatedAt: new Date().toISOString() });
    },
    [persist, workingCopyPath]
  );

  const triageGroup = useCallback(
    (id: string, state: 'open' | 'dismissed') => {
      if (workspace) void persist(setGroupState(workspace, id, state));
    },
    [persist, workspace]
  );

  const clear = useCallback(async () => {
    if (!workingCopyPath) return;
    await window.api.store.delete(reviewCenterStorageKey(workingCopyPath));
    setWorkspace(emptyReviewCenterWorkspace(workingCopyPath));
  }, [workingCopyPath]);

  return { workspace, isLoading, triageFinding, triageFindings, restoreWorkspace, triageGroup, clear };
}
