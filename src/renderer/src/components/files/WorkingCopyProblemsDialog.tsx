import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SvnStatusEntry, SvnStatusResult } from '@shared/types';

import { AccessibleDialog } from '../AccessibleDialog';
import { StatusIcon } from '../ui/StatusIcon';

const MAX_VISIBLE_PROBLEMS = 1_000;

interface WorkingCopyProblemsDialogProps {
  path: string;
  onClose: () => void;
}

function needsAttention(entry: SvnStatusEntry): boolean {
  return entry.status === 'C' || entry.status === '!' || !!entry.treeConflict || !!entry.lock;
}

function relativePath(root: string, target: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = target.replace(/\\/g, '/');
  return normalizedTarget.startsWith(`${normalizedRoot}/`)
    ? normalizedTarget.slice(normalizedRoot.length + 1)
    : normalizedTarget;
}

/** Focused, bounded view behind the sidebar's "Needs attention" insight. */
export function WorkingCopyProblemsDialog({ path, onClose }: WorkingCopyProblemsDialogProps) {
  const { data, error, isLoading, isFetching, refetch } = useQuery<SvnStatusResult>({
    queryKey: ['svn:working-copy-problems', path],
    queryFn: () => window.api.svn.status(path),
    staleTime: 10_000,
  });
  const problems = useMemo(() => data?.entries.filter(needsAttention) ?? [], [data]);
  const visibleProblems = problems.slice(0, MAX_VISIBLE_PROBLEMS);

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
            {isLoading
              ? 'Checking working copy…'
              : `${problems.length.toLocaleString()} item${problems.length === 1 ? '' : 's'} need attention`}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1.5"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div role="alert" className="m-5 rounded-lg border border-error/40 bg-error/10 p-4 text-sm text-error">
              {error instanceof Error ? error.message : 'Unable to read working-copy status.'}
            </div>
          ) : !isLoading && problems.length === 0 ? (
            <p className="p-8 text-center text-sm text-text-muted">No current problems were found.</p>
          ) : (
            <div className="divide-y divide-border">
              {visibleProblems.map((entry) => (
                <div key={entry.path} className="flex min-h-11 items-center gap-3 px-5 py-2 hover:bg-bg-tertiary/55">
                  <StatusIcon status={entry.status} size="sm" showLabel />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" title={entry.path}>
                    {relativePath(path, entry.path)}
                  </span>
                  {entry.treeConflict && <span className="text-2xs font-semibold text-svn-conflict">TREE CONFLICT</span>}
                  {entry.lock && <span className="text-2xs font-semibold text-warning">LOCKED</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {problems.length > MAX_VISIBLE_PROBLEMS && (
          <p className="border-t border-border px-5 py-2 text-2xs text-text-muted">
            Showing the first {MAX_VISIBLE_PROBLEMS.toLocaleString()} items to keep this view responsive.
          </p>
        )}
      </div>
    </AccessibleDialog>
  );
}
