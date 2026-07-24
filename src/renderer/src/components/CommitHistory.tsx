import { useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useRef, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History, GitCommit, User, Clock, FileDiff } from 'lucide-react';
import type { SvnLogEntry, SvnLogPath } from '@shared/types';
import { readCachedLog } from '../utils/cachedSvnRead';
import { buildLogCacheScope } from '../hooks/useLogCache';

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
const CommitRow = memo(function CommitRow({ entry }: { entry: SvnLogEntry }) {
  const date = new Date(entry.date).toLocaleString();
  const paths = entry.paths ?? [];

  return (
    <div className="flex gap-3 px-4 py-3 mx-1.5 rounded-lg hover:bg-bg-elevated transition-fast">
      <div className="flex-shrink-0">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-xs font-mono font-medium">
          <GitCommit className="w-3 h-3" />r{entry.revision}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text line-clamp-2 whitespace-pre-wrap break-words">
          {entry.message || <span className="text-text-muted italic">No commit message</span>}
        </p>
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

export function CommitHistory() {
  const { path } = useSearch({ from: '/history/' });
  const parentRef = useRef<HTMLDivElement>(null);

  // Fetch commit history (verbose: includes changed paths per revision)
  const { data, isLoading, error } = useQuery({
    queryKey: ['svn:log', path],
    queryFn: async ({ signal }) =>
      readCachedLog(path, `${path}::${buildLogCacheScope(100, false, {})}`, () =>
        window.api.svn.log(path, 100, undefined, undefined, false, { signal })
      ),
    enabled: !!path && path !== '/',
  });

  const entries = data?.data.entries ?? [];

  // Virtualizer with dynamic row measurement (rows vary with the path list)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    getItemKey: (index) => entries[index]?.revision ?? index,
    overscan: 6,
  });

  if (!path || path === '/') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-tertiary/70 mb-4">
          <History className="w-7 h-7 text-text-faint" />
        </div>
        <p className="text-text-secondary">No working copy selected</p>
        <p className="text-sm text-text-muted mt-1 max-w-xs">
          Open a repository, then History shows its commit log.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-text-muted">
        <div className="spinner" />
        <span className="text-sm">Loading history…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-error text-sm px-6 text-center">
        {(error as Error).message}
      </div>
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
          {entries.length} commits
        </span>
      </div>

      {/* Commit list */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto scrollbar-overlay py-1">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            No commits found
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index];
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
                  <CommitRow entry={entry} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
