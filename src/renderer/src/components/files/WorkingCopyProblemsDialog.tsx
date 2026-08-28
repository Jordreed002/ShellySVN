import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, RefreshCw } from 'lucide-react';
import type { SvnStatusEntry, SvnStatusResult } from '@shared/types';

import { AccessibleDialog } from '../AccessibleDialog';
import { StatusIcon } from '../ui/StatusIcon';

const MAX_VISIBLE_PROBLEMS = 1_000;

interface WorkingCopyProblemsDialogProps {
  path: string;
  onClose: () => void;
}

export interface WorkingCopyProblemRow {
  entry: SvnStatusEntry;
  upstreamDeleted: boolean;
  collapsedDescendants: number;
}

export function needsAttention(entry: SvnStatusEntry): boolean {
  return entry.status === 'C' || entry.status === '!' || !!entry.treeConflict || !!entry.lock;
}

export function relativePath(root: string, target: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = target.replace(/\\/g, '/');
  return normalizedTarget.startsWith(`${normalizedRoot}/`)
    ? normalizedTarget.slice(normalizedRoot.length + 1)
    : normalizedTarget;
}

export function limitVisibleProblems(entries: SvnStatusEntry[]): SvnStatusEntry[] {
  return entries.slice(0, MAX_VISIBLE_PROBLEMS);
}

function normalizedPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

/** Merge local and repository status, then collapse descendants of a missing parent. */
export function deriveProblemRows(
  localEntries: SvnStatusEntry[],
  remoteEntries: SvnStatusEntry[] = []
): WorkingCopyProblemRow[] {
  const remoteByPath = new Map(
    remoteEntries.map((entry) => [normalizedPath(entry.path), entry] as const)
  );
  const candidates = localEntries.filter(needsAttention).map((entry) => {
    const remoteEntry = remoteByPath.get(normalizedPath(entry.path));
    return {
      entry,
      upstreamDeleted:
        entry.status === '!' && (entry.remoteStatus === 'D' || remoteEntry?.remoteStatus === 'D'),
      collapsedDescendants: 0,
    } satisfies WorkingCopyProblemRow;
  });
  const missingPaths = new Set(
    candidates
      .filter((candidate) => candidate.entry.status === '!')
      .map((candidate) => normalizedPath(candidate.entry.path))
  );
  const missingByPath = new Map(
    candidates
      .filter((candidate) => candidate.entry.status === '!')
      .map((candidate) => [normalizedPath(candidate.entry.path), candidate] as const)
  );
  const treeConflictPaths = new Set(
    candidates
      .filter((candidate) => candidate.entry.treeConflict)
      .map((candidate) => normalizedPath(candidate.entry.path))
  );
  const collapsedByRoot = new Map<string, number>();

  return candidates.filter((candidate) => {
    if (candidate.entry.status !== '!') return true;
    const path = normalizedPath(candidate.entry.path);
    let parentPath = path;
    let rootPath: string | undefined;
    while (parentPath.includes('/')) {
      parentPath = parentPath.slice(0, parentPath.lastIndexOf('/'));
      if (treeConflictPaths.has(parentPath)) return false;
      if (missingPaths.has(parentPath)) rootPath = parentPath;
    }
    if (!rootPath) {
      candidate.collapsedDescendants = collapsedByRoot.get(path) ?? 0;
      return true;
    }
    collapsedByRoot.set(rootPath, (collapsedByRoot.get(rootPath) ?? 0) + 1);
    const root = missingByPath.get(rootPath);
    if (root) root.collapsedDescendants = collapsedByRoot.get(rootPath) ?? 0;
    return false;
  });
}

/** Focused, bounded view behind the sidebar's "Needs attention" insight. */
export function WorkingCopyProblemsDialog({ path, onClose }: WorkingCopyProblemsDialogProps) {
  const queryClient = useQueryClient();
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string>();
  const [confirmRepositoryState, setConfirmRepositoryState] = useState(false);
  const localQuery = useQuery<SvnStatusResult>({
    queryKey: ['svn:working-copy-problems', path],
    queryFn: ({ signal }) => window.api.svn.status(path, { signal }),
    staleTime: 10_000,
  });
  const remoteQuery = useQuery<SvnStatusResult>({
    queryKey: ['svn:working-copy-problems-remote', path],
    queryFn: ({ signal }) => window.api.svn.statusRemote(path, { signal }),
    staleTime: 10_000,
    retry: false,
  });
  const problems = useMemo(
    () => deriveProblemRows(localQuery.data?.entries ?? [], remoteQuery.data?.entries),
    [localQuery.data?.entries, remoteQuery.data?.entries]
  );
  const visibleProblems = problems.slice(0, MAX_VISIBLE_PROBLEMS);
  const isFetching = localQuery.isFetching || remoteQuery.isFetching;
  const hasMissingPaths = problems.some((problem) => problem.entry.status === '!');
  const treeConflicts = problems.filter((problem) => problem.entry.treeConflict);

  const refresh = async () => {
    await Promise.allSettled([localQuery.refetch(), remoteQuery.refetch()]);
  };

  const updateWorkingCopy = async () => {
    setIsResolving(true);
    setResolveError(undefined);
    try {
      const result = await window.api.svn.update(path, 'infinity');
      if (!result.success) {
        setResolveError(result.error || 'SVN update could not reconcile the working copy.');
        return;
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['sidebar:overview'] }),
        queryClient.invalidateQueries({ queryKey: ['sidebar:status-remote'] }),
        localQuery.refetch(),
        remoteQuery.refetch(),
      ]);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : 'SVN update failed.');
    } finally {
      setIsResolving(false);
    }
  };

  const acceptRepositoryState = async () => {
    setIsResolving(true);
    setResolveError(undefined);
    try {
      for (const conflict of treeConflicts) {
        const result = await window.api.svn.resolve(conflict.entry.path, 'incoming-deletion');
        if (!result.success) {
          throw new Error(result.error || `SVN did not resolve ${conflict.entry.path}.`);
        }
      }
      setConfirmRepositoryState(false);
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['sidebar:overview'] }),
        queryClient.invalidateQueries({ queryKey: ['sidebar:status-remote'] }),
        localQuery.refetch(),
        remoteQuery.refetch(),
      ]);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : 'Tree-conflict resolution failed.');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <AccessibleDialog
      isOpen
      onClose={onClose}
      title="Needs attention"
      description={`Conflicts, missing paths, tree conflicts, and locks reported in ${path}.`}
      icon={AlertTriangle}
      tone="warning"
      size="xl"
      className="h-[78vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-bg-tertiary/45 px-5 py-3">
          <span className="flex-1 text-xs text-text-secondary" aria-live="polite">
            {localQuery.isLoading
              ? 'Checking working copy…'
              : `${problems.length.toLocaleString()} item${problems.length === 1 ? '' : 's'} need attention${remoteQuery.isFetching ? ' · checking repository…' : ''}`}
          </span>
          {treeConflicts.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1.5"
              onClick={() => setConfirmRepositoryState(true)}
              disabled={isResolving || localQuery.isFetching}
              title="Resolve the tree conflict by accepting the repository's structure"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Resolve tree conflict
            </button>
          ) : hasMissingPaths ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1.5"
              onClick={() => void updateWorkingCopy()}
              disabled={isResolving || localQuery.isFetching}
              title="Run svn update to apply upstream deletions and restore paths missing only on disk"
            >
              <ArrowDownToLine className={`h-3.5 w-3.5 ${isResolving ? 'animate-pulse' : ''}`} />
              {isResolving ? 'Resolving…' : 'Update & resolve'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1.5"
            onClick={() => void refresh()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {confirmRepositoryState && (
          <div className="mx-5 mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text">Accept the repository state?</p>
            <p className="mt-1">
              This resolves the tree conflict using the repository version. If the repository
              deleted this folder, its pending local copied/add state will be discarded. This cannot
              be undone by ShellySVN.
            </p>
            {isResolving && (
              <p className="mt-2 font-medium text-warning">
                SVN is tracing the deletion through repository history. This can take a minute on a
                large repository.
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmRepositoryState(false)}
                disabled={isResolving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void acceptRepositoryState()}
                disabled={isResolving}
              >
                {isResolving ? 'Resolving…' : 'Accept repository state'}
              </button>
            </div>
          </div>
        )}

        {resolveError && (
          <div
            role="alert"
            className="mx-5 mt-4 rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
          >
            <p className="font-semibold">Could not resolve the working-copy problem</p>
            <p className="mt-1 whitespace-pre-wrap">{resolveError}</p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {localQuery.error ? (
            <div
              role="alert"
              className="m-5 rounded-lg border border-error/40 bg-error/10 p-4 text-sm text-error"
            >
              {localQuery.error instanceof Error
                ? localQuery.error.message
                : 'Unable to read working-copy status.'}
            </div>
          ) : !localQuery.isLoading && problems.length === 0 ? (
            <p className="p-8 text-center text-sm text-text-muted">
              No current problems were found.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {visibleProblems.map(({ entry, upstreamDeleted, collapsedDescendants }) => (
                <div
                  key={entry.path}
                  className="flex min-h-11 items-center gap-3 px-5 py-2 hover:bg-bg-tertiary/55"
                >
                  {upstreamDeleted ? (
                    <span className="inline-flex shrink-0 items-center rounded-md border border-info/40 bg-info/10 px-2 py-0.5 text-2xs font-semibold text-info">
                      DELETED UPSTREAM
                    </span>
                  ) : (
                    <StatusIcon status={entry.status} size="sm" showLabel />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
                    title={entry.path}
                  >
                    {relativePath(path, entry.path)}
                  </span>
                  {collapsedDescendants > 0 && (
                    <span className="text-2xs text-text-muted">
                      +{collapsedDescendants.toLocaleString()} nested
                    </span>
                  )}
                  {upstreamDeleted && (
                    <span className="text-2xs font-medium text-info">Update to reconcile</span>
                  )}
                  {entry.treeConflict && (
                    <span className="text-2xs font-semibold text-svn-conflict">TREE CONFLICT</span>
                  )}
                  {entry.lock && (
                    <span className="text-2xs font-semibold text-warning">LOCKED</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {problems.length > MAX_VISIBLE_PROBLEMS && (
          <p className="border-t border-border px-5 py-2 text-2xs text-text-muted">
            Showing the first {MAX_VISIBLE_PROBLEMS.toLocaleString()} items to keep this view
            responsive.
          </p>
        )}
      </div>
    </AccessibleDialog>
  );
}
