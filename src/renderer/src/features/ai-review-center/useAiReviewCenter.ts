import { useCallback, useEffect, useState } from 'react';
import { REVIEW_CENTER_CAPTURE_EVENT } from './reviewCenterEvents';
import {
  emptyReviewCenterWorkspace,
  parseReviewCenterWorkspace,
  reviewCenterStorageKey,
  setFindingState,
  setGroupState,
} from './reviewCenterStore';
import type { ReviewCenterWorkspace } from './types';

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
    (id: string, state: 'open' | 'dismissed') => {
      if (workspace) void persist(setFindingState(workspace, id, state));
    },
    [persist, workspace]
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

  return { workspace, isLoading, triageFinding, triageGroup, clear };
}
