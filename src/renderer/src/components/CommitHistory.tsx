import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useRef, memo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History, GitCommit, User, Clock, FileDiff, GitCompare, FolderOpen } from 'lucide-react';
import type { SvnLogEntry, SvnLogPath } from '@shared/types';
import { readCachedLog } from '../utils/cachedSvnRead';
import { buildLogCacheScope } from '../hooks/useLogCache';
import { svnLog } from '../lib/queryKeys';
import { ErrorPanel } from './ui/ErrorPanel';
import { EmptyState } from './ui/EmptyState';
import { SkeletonList } from './ui/Skeleton';
import { useLogViewSurface } from './history/useLogViewState';
import { IssueKeyText } from './IssueKeyText';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';

const MAX_VISIBLE_PATHS = 8;

const ACTION_META: Record<string, { label: string; cls: string; title: string }> = {
  A: { label: 'A', cls: 'text-svn-added bg-svn-added/15', title: 'Added' },
  M: { label: 'M', cls: 'text-svn-modified bg-svn-modified/15', title: 'Modified' },
  D: { label: 'D', cls: 'text-svn-deleted bg-svn-deleted/15', title: 'Deleted' },
  R: { label: 'R', cls: 'text-svn-replaced bg-svn-replaced/15', title: 'Replaced' },
};

function ChangedPath({ change }: { change: SvnLogPath }) {
  const meta = ACTION_META[change.action] ?? {
    label: change.action || '?',
    cls: 'text-text-muted bg-bg-elevated',
    title: 'Changed',
  };
  return (
    <div className="flex items-center gap-2 text-2xs font-mono leading-relaxed">
      <span
        className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded font-semibold ${meta.cls}`}
        title={meta.title}
      >
        {meta.label}
      </span>
      <span className="truncate text-text-secondary" dir="rtl" title={change.path}>
        {change.path}
      </span>
    </div>
  );
}

// Commit row component - memoized for performance in virtualized lists
const CommitRow = memo(function CommitRow({
  entry,
  onShowChanges,
  onSelect,
  isSelected,
  issuePattern,
  issueUrlTemplate,
}: {
  entry: SvnLogEntry;
  onShowChanges?: (revision: number) => void;
  /** Row-level selection sync with the revision graph panel (#45); optional. */
  onSelect?: (revision: number) => void;
  isSelected?: boolean;
  issuePattern?: string;
  issueUrlTemplate?: string;
}) {
  const date = new Date(entry.date).toLocaleString();
  const paths = entry.paths ?? [];

  return (
    <div
      onClick={onSelect ? () => onSelect(entry.revision) : undefined}
      aria-current={isSelected ? 'true' : undefined}
      className={`flex gap-3 px-4 py-3 mx-1.5 rounded-lg hover:bg-bg-elevated transition-fast ${
        isSelected ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : ''
      } ${onSelect ? 'cursor-pointer' : ''}`}
    >
      <div className="flex-shrink-0">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-xs font-mono font-medium">
          <GitCommit className="w-3 h-3" />r{entry.revision}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <p className="flex-1 min-w-0 text-sm text-text line-clamp-2 whitespace-pre-wrap break-words">
            {entry.message ? (
              issuePattern && issueUrlTemplate ? (
                <IssueKeyText text={entry.message} pattern={issuePattern} urlTemplate={issueUrlTemplate} />
              ) : (
                entry.message
              )
            ) : (
              <span className="text-text-muted italic">No commit message</span>
            )}
          </p>
          {onShowChanges && (
            <button
              type="button"
              className="btn-icon-sm flex-shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onShowChanges(entry.revision);
              }}
              aria-label={`Show changes for r${entry.revision}`}
              title={`Diff r${entry.revision} against r${entry.revision - 1}`}
            >
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-2xs text-text-muted">
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {entry.author || 'unknown'}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {date}
          </span>
          {paths.length > 0 && (
            <span className="flex items-center gap-1">
              <FileDiff className="w-3 h-3" />
              {paths.length} file{paths.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {paths.length > 0 && (
          <div className="mt-2 pl-0.5 border-l-2 border-border-muted">
            <div className="pl-3 space-y-0.5">
              {paths.slice(0, MAX_VISIBLE_PATHS).map((change) => (
                <ChangedPath key={`${change.action}:${change.path}`} change={change} />
              ))}
              {paths.length > MAX_VISIBLE_PATHS && (
                <div className="text-2xs text-text-muted">
                  +{paths.length - MAX_VISIBLE_PATHS} more file
                  {paths.length - MAX_VISIBLE_PATHS === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export function CommitHistory({
  selectedRevision,
  onSelectRevision,
}: {
  /** Highlighted revision, shared with the revision graph panel (#45). */
  selectedRevision?: number | null;
  /** Notifies when a row is selected (click) for graph selection sync. */
  onSelectRevision?: (revision: number) => void;
} = {}) {
  const { path } = useSearch({ from: '/history/' });
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const { config: issueTrackerConfig } = useIssueTrackerConfig(
    path && path !== '/' ? path : ''
  );

  // Fetch commit history (verbose: includes changed paths per revision).
  // The queryFn runs under the app-wide IPC deadline (see lib/queryTimeout.ts),
  // so a hung `svn log` lands in the error branch instead of spinning.
  const { data, isLoading, error, isRefetching, refetch } = useQuery({
    queryKey: svnLog(path),
    queryFn: async ({ signal }) =>
      readCachedLog(path, `${path}::${buildLogCacheScope(100, false, {})}`, () =>
        window.api.svn.log(path, 100, undefined, undefined, false, { signal })
      ),
    enabled: !!path && path !== '/',
  });

  const entries = data?.data.entries ?? [];

  // Search, saved views, sort and export for the log surface (#66/#67), plus
  // the "Show changes" diff target (#72).
  const logView = useLogViewSurface({
    path: path && path !== '/' ? path : null,
    entries,
    countLabel: 'commits',
  });
  const filteredEntries = logView.filteredEntries;
  const requestShowChanges = logView.requestShowChanges;
  const handleShowChanges = useCallback(
    (revision: number) => requestShowChanges(revision, path),
    [requestShowChanges, path]
  );
  const handleSelectRevision = useCallback(
    (revision: number) => onSelectRevision?.(revision),
    [onSelectRevision]
  );

  // Virtualizer with dynamic row measurement (rows vary with the path list)
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    getItemKey: (index) => filteredEntries[index]?.revision ?? index,
    overscan: 6,
  });

  if (!path || path === '/') {
    return (
      <EmptyState
        icon={History}
        title="No working copy selected"
        description="Open a repository, then History shows its commit log."
        primaryAction={{
          label: 'Open working copy…',
          onClick: () => navigate({ to: '/' }),
          icon: FolderOpen,
        }}
        hint="the home briefing has Checkout and Open working copy"
      />
    );
  }

  if (isLoading) {
    // A skeleton shaped like the commit rows, not a bare spinner (#92).
    return (
      <div className="flex flex-1 flex-col overflow-hidden" aria-busy="true">
        <SkeletonList rows={6} label="Loading history" className="flex-1 overflow-hidden py-1" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorPanel
        title="Failed to load history"
        message={(error as Error).message}
        onRetry={() => void refetch()}
        isRetrying={isRefetching}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="h-[--toolbar-height] flex items-center gap-2 px-4 border-b border-border flex-shrink-0">
        <History className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-text">Commit History</span>
        <span className="text-xs text-text-muted truncate">· {path.split(/[/\\]/).pop()}</span>
        {data?.source === 'cache' && (
          <span
            className="text-xs text-warning"
            title={`Cached history from ${Math.floor(data.age / 60_000)} minutes ago`}
          >
            Cached
          </span>
        )}
        <span className="ml-auto text-xs text-text-muted tabular-nums">
          {filteredEntries.length === entries.length
            ? `${entries.length} commits`
            : `${filteredEntries.length} of ${entries.length} commits`}
        </span>
      </div>

      {/* Search, saved views, export (#66/#67) */}
      {logView.filterBar}

      {/* Sortable columns (#66) */}
      {logView.sortHeader}

      {/* Commit list */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto scrollbar-overlay py-1">
        {entries.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            title="No commits found"
            description={`svn log returned nothing for ${path.split(/[/\\]/).pop() ?? path}.`}
            primaryAction={{ label: 'Refresh', onClick: () => void refetch() }}
          />
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No commits match the current filters"
            description="Every loaded commit is filtered out. Clearing the filters brings the log back."
            primaryAction={{ label: 'Clear filters', onClick: logView.clearFilters }}
          />
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <CommitRow
                    entry={entry}
                    onShowChanges={handleShowChanges}
                    isSelected={selectedRevision === entry.revision}
                    onSelect={handleSelectRevision}
                    issuePattern={issueTrackerConfig.issueIdPattern}
                    issueUrlTemplate={issueTrackerConfig.issueUrlTemplate}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* "Show changes" target (#72) */}
      {logView.diffDialog}
    </div>
  );
}
