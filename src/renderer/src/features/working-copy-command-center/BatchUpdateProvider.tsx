import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings } from '@renderer/hooks/useSettings';
import { confirmAppAction } from '@renderer/utils/dialogs';
import { invalidateAfterSvnMutation } from '@renderer/utils/mutationInvalidation';
import {
  workingCopyHeadQueryKey,
  workingCopyIncomingQueryKey,
} from '@renderer/features/repo-browser/hooks/queryKeys';
import {
  deriveEligibility,
  mapWithConcurrency,
  measureLocalStatus,
  resetAfterExternalMutation,
  summarizeBatch,
  workingCopyName,
} from './model';
import type { BatchUpdateController, BatchUpdateItem } from './types';

const BatchContext = createContext<BatchUpdateController | null>(null);
const READ_CONCURRENCY = 4;
const UPDATE_CONCURRENCY = 2;
const MAX_INCOMING_REVISIONS = 500;

function mutationIdentity(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function initialItem(path: string): BatchUpdateItem {
  return {
    path,
    name: workingCopyName(path),
    selected: false,
    requiresDirtyConfirmation: false,
    status: 'idle',
    filesProcessed: 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyReadError(
  message: string
): Pick<BatchUpdateItem, 'blockedKind' | 'blockedReason'> {
  if (/E155004|cleanup|working copy.*locked/i.test(message)) {
    return { blockedKind: 'cleanup-required', blockedReason: 'Run cleanup before updating.' };
  }
  if (/auth|credential|E170001|E215004/i.test(message)) {
    return { blockedKind: 'authentication', blockedReason: 'Authentication is required.' };
  }
  if (/not a working copy|E155007|ENOENT|not found/i.test(message)) {
    return { blockedKind: 'missing', blockedReason: 'This path is not currently a working copy.' };
  }
  return { blockedKind: 'unreachable', blockedReason: 'The repository could not be reached.' };
}

export function BatchUpdateProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const paths = useMemo(() => settings.recentRepositories ?? [], [settings.recentRepositories]);
  const [items, setItems] = useState<BatchUpdateItem[]>(() => paths.map(initialItem));
  const [isChecking, setIsChecking] = useState(false);
  const checkingRef = useRef(false);
  const itemsRef = useRef(items);
  const dirtyConfirmedRef = useRef(false);
  const activeMutationPathsRef = useRef(new Set<string>());
  const ownedMutationPathsRef = useRef(new Set<string>());
  const configuredPathsRef = useRef(paths);
  configuredPathsRef.current = paths;

  const commitItems = useCallback((updater: (current: BatchUpdateItem[]) => BatchUpdateItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    commitItems((current) => {
      const byPath = new Map(current.map((item) => [item.path, item]));
      const configured = paths.map((path) => byPath.get(path) ?? initialItem(path));
      const detachedActive = current.filter(
        (item) =>
          !paths.includes(item.path) && (item.status === 'queued' || item.status === 'running')
      );
      return [...configured, ...detachedActive];
    });
  }, [commitItems, paths]);

  useEffect(() => {
    const apply = (activePaths: string[]) => {
      const active = new Set(activePaths.map(mutationIdentity));
      activeMutationPathsRef.current = active;
      commitItems((current) =>
        current.map((item) => {
          const identity = mutationIdentity(item.path);
          const isActive = active.has(identity);
          if (
            isActive &&
            !ownedMutationPathsRef.current.has(identity) &&
            item.status !== 'running' &&
            item.status !== 'queued'
          ) {
            return {
              ...item,
              selected: false,
              status: 'blocked',
              blockedKind: 'active-mutation',
              blockedReason: 'Another SVN operation is active for this working copy.',
            };
          }
          if (!isActive && item.blockedKind === 'active-mutation') {
            return resetAfterExternalMutation(item);
          }
          return item;
        })
      );
    };
    void window.api.svn
      .getActiveWorkingCopyMutations()
      .then(apply)
      .catch(() => undefined);
    return window.api.svn.onWorkingCopyMutationStateChanged(apply);
  }, [commitItems]);

  const patchItem = useCallback(
    (path: string, patch: Partial<BatchUpdateItem>) => {
      commitItems((current) =>
        current.map((item) => (item.path === path ? { ...item, ...patch } : item))
      );
    },
    [commitItems]
  );

  const measureItems = useCallback(
    async (
      candidates: readonly BatchUpdateItem[],
      { autoSelect, ignoreActive = false }: { autoSelect: boolean; ignoreActive?: boolean }
    ): Promise<BatchUpdateItem[]> => {
      const local = await mapWithConcurrency(candidates, READ_CONCURRENCY, async (item) => {
        try {
          const status = await window.api.svn.status(item.path);
          if (status.error)
            throw new Error([status.errorCode, status.error].filter(Boolean).join(' '));
          const info = await window.api.svn.info(item.path);
          if (!info?.url) throw new Error('Not a working copy');
          const measured = measureLocalStatus(status);
          let blocked: Pick<BatchUpdateItem, 'blockedKind' | 'blockedReason'> = {};
          if (!ignoreActive && activeMutationPathsRef.current.has(mutationIdentity(item.path)))
            blocked = {
              blockedKind: 'active-mutation',
              blockedReason: 'Another SVN operation is active for this working copy.',
            };
          else if (measured.conflicts > 0)
            blocked = {
              blockedKind: 'conflicted',
              blockedReason: 'Resolve conflicts before using batch update.',
            };
          else if (measured.cleanupRequired)
            blocked = {
              blockedKind: 'cleanup-required',
              blockedReason: 'Run cleanup before updating.',
            };
          else if (measured.staleLock)
            blocked = {
              blockedKind: 'stale-lock',
              blockedReason: 'Clear the stale working-copy lock first.',
            };
          return {
            ...item,
            repositoryUrl: info.url,
            repositoryRoot: info.repositoryRoot,
            baseRevision: typeof info.revision === 'number' ? info.revision : undefined,
            localChangeCount: measured.changes,
            conflictCount: measured.conflicts,
            measurementSource: 'fresh' as const,
            verificationError: undefined,
            error: undefined,
            blockedKind: undefined,
            blockedReason: undefined,
            ...blocked,
          };
        } catch (error) {
          const message = errorMessage(error);
          return { ...item, error: message, ...classifyReadError(message) };
        }
      });

      return mapWithConcurrency(local, READ_CONCURRENCY, async (item) => {
        if (item.blockedKind || !item.repositoryUrl || item.baseRevision === undefined)
          return deriveEligibility(item, { autoSelect });
        try {
          const info = await window.api.svn.infoUrl(item.repositoryUrl);
          const head = info?.revision;
          if (typeof head !== 'number') throw new Error('Repository HEAD was not reported');
          queryClient.setQueryData(workingCopyHeadQueryKey(item.repositoryUrl), head);
          let incomingCount = 0;
          let incomingCapped = false;
          if (head > item.baseRevision) {
            const log = await window.api.svn.log(
              item.repositoryUrl,
              MAX_INCOMING_REVISIONS,
              head,
              item.baseRevision + 1,
              false
            );
            if (log.error) throw new Error(log.error);
            incomingCount = log.entries.length;
            incomingCapped = incomingCount >= MAX_INCOMING_REVISIONS;
            queryClient.setQueryData(
              workingCopyIncomingQueryKey(item.repositoryUrl, item.baseRevision, head),
              incomingCount
            );
          }
          return deriveEligibility(
            {
              ...item,
              headRevision: head,
              incomingCount,
              incomingCapped,
              checkedAt: Date.now(),
              measurementSource: 'fresh',
              error: undefined,
            },
            { autoSelect }
          );
        } catch (error) {
          const message = errorMessage(error);
          return deriveEligibility(
            { ...item, error: message, ...classifyReadError(message) },
            { autoSelect }
          );
        }
      });
    },
    [queryClient]
  );

  const checkAll = useCallback(async () => {
    if (
      checkingRef.current ||
      itemsRef.current.some((item) => item.status === 'running' || item.status === 'queued')
    )
      return;
    checkingRef.current = true;
    setIsChecking(true);
    dirtyConfirmedRef.current = false;
    const candidates = itemsRef.current;
    commitItems((current) =>
      current.map((item) => ({
        ...item,
        status: 'checking',
        selected: false,
        error: undefined,
        blockedKind: undefined,
        blockedReason: undefined,
        operationId: undefined,
        cancellationRequested: false,
      }))
    );
    try {
      const measured = await measureItems(candidates, { autoSelect: true });
      commitItems(() =>
        measured.map((item) =>
          activeMutationPathsRef.current.has(mutationIdentity(item.path)) &&
          !ownedMutationPathsRef.current.has(mutationIdentity(item.path))
            ? {
                ...item,
                selected: false,
                status: 'blocked',
                blockedKind: 'active-mutation',
                blockedReason: 'Another SVN operation is active for this working copy.',
              }
            : item
        )
      );
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, [commitItems, measureItems]);

  const toggleSelection = useCallback(
    async (path: string) => {
      const item = itemsRef.current.find((candidate) => candidate.path === path);
      if (!item || item.status !== 'ready' || item.blockedKind === 'at-head') return;
      if (!item.selected && item.requiresDirtyConfirmation && !dirtyConfirmedRef.current) {
        const confirmed = await confirmAppAction({
          type: 'warning',
          message: 'Update a working copy with local changes?',
          detail:
            'Subversion may merge incoming changes into your edits or create conflicts. This confirmation applies only to this batch.',
          confirmLabel: 'Include working copy',
        });
        if (!confirmed) return;
        dirtyConfirmedRef.current = true;
      }
      patchItem(path, { selected: !item.selected });
    },
    [patchItem]
  );

  const runPaths = useCallback(
    async (selectedPaths: readonly string[]) => {
      const selectedSet = new Set(selectedPaths);
      commitItems((current) =>
        current.map((item) =>
          selectedSet.has(item.path)
            ? {
                ...item,
                status: 'queued',
                selected: false,
                filesProcessed: 0,
                error: undefined,
                verificationError: undefined,
                operationId: undefined,
                cancellationRequested: false,
              }
            : item
        )
      );
      await mapWithConcurrency(selectedPaths, UPDATE_CONCURRENCY, async (path) => {
        const queued = itemsRef.current.find((item) => item.path === path);
        if (!queued || queued.status !== 'queued') return;
        const identity = mutationIdentity(path);
        const activeElsewhere = activeMutationPathsRef.current.has(identity);
        if (activeElsewhere) {
          patchItem(path, {
            status: 'blocked',
            blockedKind: 'active-mutation',
            blockedReason: 'Another SVN operation is active for this working copy.',
          });
          return;
        }
        ownedMutationPathsRef.current.add(identity);
        try {
          const operation = window.api.svn.updateWithProgress(path, (progress) => {
            patchItem(path, {
              filesProcessed: progress.filesProcessed,
            });
          });
          patchItem(path, { status: 'running', operationId: operation.operationId });
          const result = await operation;
          if (!result.success) {
            const cancelled = /cancel/i.test(result.error ?? '');
            patchItem(path, {
              status: cancelled ? 'cancelled' : 'failed',
              revision: result.revision,
              error: result.error ?? 'Update failed',
              operationId: undefined,
              cancellationRequested: false,
            });
            return;
          }
          const item = itemsRef.current.find((candidate) => candidate.path === path);
          let invalidationError: string | undefined;
          try {
            await invalidateAfterSvnMutation(queryClient, {
              localPaths: [path],
              repositoryUrls: item?.repositoryUrl ? [item.repositoryUrl] : [],
            });
          } catch (error) {
            invalidationError = errorMessage(error);
          }
          const [verified] = await measureItems(item ? [item] : [], {
            autoSelect: false,
            ignoreActive: true,
          });
          const verificationSucceeded = verified?.status === 'ready';
          const verificationBlocked =
            verified?.blockedKind === 'conflicted' ||
            verified?.blockedKind === 'cleanup-required' ||
            verified?.blockedKind === 'stale-lock';
          commitItems((current) =>
            current.map((candidate) => {
              if (candidate.path !== path) return candidate;
              const measured = verificationSucceeded || verificationBlocked ? verified : candidate;
              return {
                ...measured,
                selected: false,
                status: verificationBlocked ? 'blocked' : 'completed',
                operationId: undefined,
                cancellationRequested: false,
                revision:
                  (verificationSucceeded || verificationBlocked) &&
                  verified.baseRevision !== undefined
                    ? verified.baseRevision
                    : result.revision,
                error: undefined,
                verificationError:
                  !verificationBlocked && (invalidationError || !verificationSucceeded)
                    ? `Update completed, but verification failed: ${
                        verified?.error ?? invalidationError ?? 'working copy could not be re-read'
                      }`
                    : undefined,
                blockedKind: verificationBlocked ? verified.blockedKind : undefined,
                blockedReason: verificationBlocked ? verified.blockedReason : undefined,
              };
            })
          );
        } catch (error) {
          const message = errorMessage(error);
          patchItem(path, {
            status: /cancel/i.test(message) ? 'cancelled' : 'failed',
            error: message,
            revision: null,
            operationId: undefined,
            cancellationRequested: false,
          });
        } finally {
          ownedMutationPathsRef.current.delete(identity);
          if (!configuredPathsRef.current.includes(path)) {
            commitItems((current) => current.filter((item) => item.path !== path));
          }
        }
      });
      dirtyConfirmedRef.current = false;
    },
    [commitItems, measureItems, patchItem, queryClient]
  );

  const startSelected = useCallback(async () => {
    const selected = itemsRef.current
      .filter((item) => item.selected && item.status === 'ready')
      .map((item) => item.path);
    if (selected.length) await runPaths(selected);
  }, [runPaths]);

  const cancelItem = useCallback(
    async (path: string) => {
      const item = itemsRef.current.find((candidate) => candidate.path === path);
      if (!item) return;
      if (item.status === 'queued') {
        patchItem(path, { status: 'cancelled', selected: false });
        return;
      }
      if (item.status === 'running' && item.operationId) {
        const result = await window.api.svn.cancelUpdate(item.operationId);
        if (result.success) {
          patchItem(path, { cancellationRequested: true, selected: false });
        } else {
          patchItem(path, { error: result.error ?? 'Cancellation could not be requested.' });
        }
      }
    },
    [patchItem]
  );

  const cancelAll = useCallback(async () => {
    const active = itemsRef.current.filter((item) => item.status === 'running');
    commitItems((current) =>
      current.map((item) =>
        item.status === 'queued' ? { ...item, status: 'cancelled', selected: false } : item
      )
    );
    await Promise.all(active.map((item) => cancelItem(item.path)));
  }, [cancelItem, commitItems]);

  const retryFailed = useCallback(async () => {
    if (itemsRef.current.some((item) => item.status === 'queued' || item.status === 'running'))
      return;
    const failed = itemsRef.current.filter((item) => item.status === 'failed');
    if (!failed.length) return;
    const measured = await measureItems(failed, { autoSelect: false });
    commitItems((current) => {
      const replacements = new Map(measured.map((item) => [item.path, item]));
      return current.map((item) => replacements.get(item.path) ?? item);
    });
    const retryable = measured.filter(
      (item) => item.status === 'ready' && item.blockedKind !== 'at-head'
    );
    if (!retryable.length) return;
    if (retryable.some((item) => item.requiresDirtyConfirmation)) {
      const confirmed = await confirmAppAction({
        type: 'warning',
        message: 'Retry updates with local changes?',
        detail:
          'The failed update may have changed the working copy. Subversion may merge changes or create conflicts. This confirmation applies only to this retry batch.',
        confirmLabel: 'Retry eligible updates',
      });
      if (!confirmed) return;
      dirtyConfirmedRef.current = true;
    }
    await runPaths(retryable.map((item) => item.path));
  }, [commitItems, measureItems, runPaths]);

  const clearCompleted = useCallback(() => {
    commitItems((current) =>
      current.map((item) =>
        item.status === 'completed' && item.verificationError
          ? resetAfterExternalMutation(item)
          : item.status === 'completed'
            ? deriveEligibility(
                {
                  ...item,
                  status: 'ready',
                  selected: false,
                  operationId: undefined,
                  cancellationRequested: false,
                  revision: undefined,
                  verificationError: undefined,
                },
                { autoSelect: false }
              )
            : item.status === 'cancelled'
              ? resetAfterExternalMutation(item)
              : item
      )
    );
  }, [commitItems]);

  /**
   * Sidebar "Update All" / "Update group" entry point (#58).
   *
   * Measures the requested paths, runs every ready member that is not already
   * at HEAD, and folds all dirty members into the single confirmation the
   * batch flow already uses. It deliberately reuses `measureItems`/`runPaths`
   * — the sidebar enqueues into the one pipeline the command center renders,
   * not a second one.
   */
  const updatePaths = useCallback(
    async (requested: readonly string[]) => {
      if (
        checkingRef.current ||
        itemsRef.current.some((item) => item.status === 'running' || item.status === 'queued')
      ) {
        return;
      }
      const requestedSet = new Set(requested);
      // Paths the provider has not reconciled yet still get a one-shot item so
      // the sidebar can update a working copy added in this tick.
      commitItems((current) => {
        const missing = [...requestedSet].filter((path) => !current.some((i) => i.path === path));
        return missing.length > 0 ? [...current, ...missing.map(initialItem)] : current;
      });
      const candidates = itemsRef.current.filter((item) => requestedSet.has(item.path));
      if (candidates.length === 0) return;

      checkingRef.current = true;
      setIsChecking(true);
      let measured: BatchUpdateItem[] = [];
      try {
        measured = await measureItems(candidates, { autoSelect: false });
        const replacements = new Map(measured.map((item) => [item.path, item]));
        commitItems((current) => current.map((item) => replacements.get(item.path) ?? item));
      } finally {
        checkingRef.current = false;
        setIsChecking(false);
      }

      const eligible = measured.filter(
        (item) => item.status === 'ready' && item.blockedKind !== 'at-head' && !item.blockedKind
      );
      if (eligible.length === 0) return;

      const dirty = eligible.filter((item) => item.requiresDirtyConfirmation);
      let runSet: Set<string> | null = null;
      if (dirty.length > 0) {
        const includeDirty = await confirmAppAction({
          type: 'warning',
          message: `Update ${dirty.length} working cop${dirty.length === 1 ? 'y' : 'ies'} with local changes?`,
          detail:
            'Subversion may merge incoming changes into local edits or create conflicts. Clean working copies are always included.',
          confirmLabel: 'Update all selected',
        });
        runSet = new Set(
          includeDirty
            ? eligible.map((item) => item.path)
            : eligible.filter((item) => !item.requiresDirtyConfirmation).map((item) => item.path)
        );
      } else {
        runSet = new Set(eligible.map((item) => item.path));
      }
      if (runSet.size === 0) return;
      await runPaths([...runSet]);
    },
    [commitItems, measureItems, runPaths]
  );

  const updateAll = useCallback(
    () => updatePaths(configuredPathsRef.current),
    [updatePaths]
  );

  const summary = useMemo(() => summarizeBatch(items), [items]);
  const value = useMemo<BatchUpdateController>(
    () => ({
      items,
      summary,
      isChecking,
      checkAll,
      toggleSelection,
      startSelected,
      cancelItem,
      cancelAll,
      retryFailed,
      clearCompleted,
      updatePaths,
      updateAll,
    }),
    [
      items,
      summary,
      isChecking,
      checkAll,
      toggleSelection,
      startSelected,
      cancelItem,
      cancelAll,
      retryFailed,
      clearCompleted,
      updatePaths,
      updateAll,
    ]
  );
  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}

export function useBatchUpdate(): BatchUpdateController {
  const value = useContext(BatchContext);
  if (!value) throw new Error('useBatchUpdate must be used inside BatchUpdateProvider');
  return value;
}
