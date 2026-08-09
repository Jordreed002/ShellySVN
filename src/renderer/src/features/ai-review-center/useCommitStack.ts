import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REVIEW_CENTER_CAPTURE_EVENT } from './reviewCenterEvents';
import {
  commitStackStorageKey,
  diagnoseCommitStack,
  emptyCommitStack,
  markCommitStackChangelist,
  markCommitStackCommitted,
  moveCommitStackPath,
  parseCommitStack,
  reorderCommitStack,
  updateCommitStackMessage,
  type CommitStackWorkspace,
} from './commitStackStore';

export function useCommitStack(workingCopyPath: string) {
  const [stack, setStack] = useState(() => emptyCommitStack(workingCopyPath));
  const stackRef = useRef(stack);
  const persistenceQueueRef = useRef(Promise.resolve());
  const [isLoading, setIsLoading] = useState(true);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const stored = await window.api.store.get(commitStackStorageKey(workingCopyPath));
      const restored = parseCommitStack(stored, workingCopyPath);
      stackRef.current = restored;
      setStack(restored);
    } finally {
      setIsLoading(false);
    }
  }, [workingCopyPath]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    const handleCapture = (event: Event) => {
      const capture = (event as CustomEvent<{ kind: string; workingCopyPath: string }>).detail;
      if (capture?.kind === 'plan' && capture.workingCopyPath === workingCopyPath) void load();
    };
    window.addEventListener(REVIEW_CENTER_CAPTURE_EVENT, handleCapture);
    return () => window.removeEventListener(REVIEW_CENTER_CAPTURE_EVENT, handleCapture);
  }, [load, workingCopyPath]);

  const persist = useCallback((next: CommitStackWorkspace) => {
    stackRef.current = next;
    setStack(next);
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => window.api.store.set(commitStackStorageKey(next.workingCopyPath), next));
    return persistenceQueueRef.current;
  }, []);

  const transform = useCallback(
    (apply: (current: CommitStackWorkspace) => CommitStackWorkspace) => {
      void persist(apply(stackRef.current));
    },
    [persist]
  );

  const reorder = (groupId: string, direction: -1 | 1) =>
    transform((current) => reorderCommitStack(current, groupId, direction));
  const updateMessage = (groupId: string, message: string) =>
    transform((current) => updateCommitStackMessage(current, groupId, message));
  const movePath = (path: string, destinationGroupId: string | null) =>
    transform((current) => moveCommitStackPath(current, path, destinationGroupId));

  const createChangelist = async (groupId: string) => {
    const group = stack.groups.find((candidate) => candidate.id === groupId);
    if (!group || group.paths.length === 0 || busyGroupId) return;
    const safeName = `stack-${group.order + 1}-${group.title}`
      .replace(/[^\p{L}\p{N}_. -]+/gu, '-')
      .trim()
      .slice(0, 80);
    setBusyGroupId(groupId);
    setError(null);
    try {
      const result = await window.api.svn.changelist.add(group.paths, safeName);
      if (!result.success) throw new Error(result.error || 'SVN could not update the changelist.');
      await persist(markCommitStackChangelist(stackRef.current, groupId, safeName));
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Changelist failed.');
    } finally {
      setBusyGroupId(null);
    }
  };

  const commitGroup = async (groupId: string) => {
    const group = stack.groups.find((candidate) => candidate.id === groupId);
    if (!group || group.status !== 'ready' || busyGroupId) return;
    setBusyGroupId(groupId);
    setError(null);
    try {
      const result = await window.api.svn.commit(group.paths, group.draftMessage.trim());
      if (!result.success) throw new Error('SVN could not commit this group.');
      await persist(markCommitStackCommitted(stackRef.current, groupId, result.revision));
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Commit failed.');
    } finally {
      setBusyGroupId(null);
    }
  };

  const clear = async () => {
    await window.api.store.delete(commitStackStorageKey(workingCopyPath));
    const empty = emptyCommitStack(workingCopyPath);
    stackRef.current = empty;
    setStack(empty);
  };

  const diagnostics = useMemo(() => diagnoseCommitStack(stack), [stack]);
  return {
    stack,
    diagnostics,
    isLoading,
    busyGroupId,
    error,
    reorder,
    updateMessage,
    movePath,
    createChangelist,
    commitGroup,
    clear,
  };
}
