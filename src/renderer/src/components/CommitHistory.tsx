import { useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useRef, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History, GitCommit, User, Clock } from 'lucide-react';
import type { SvnLogEntry } from '@shared/types';

// Commit row component - memoized for performance in virtualized lists
const CommitRow = memo(function CommitRow({ entry }: { entry: SvnLogEntry }) {
  const date = new Date(entry.date).toLocaleString();

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
        </div>
      </div>
    </div>
  );
});

export function CommitHistory() {
  const { path } = useSearch({ from: '/history/' });
  const parentRef = useRef<HTMLDivElement>(null);

  // Fetch commit history
  const { data, isLoading, error } = useQuery({
    queryKey: ['svn:log', path],
    queryFn: ({ signal }) => window.api.svn.log(path, 100, undefined, undefined, false, { signal }),
    enabled: !!path && path !== '/',
  });

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: data?.entries.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    getItemKey: (index) => data?.entries[index]?.revision ?? index,
    overscan: 8,
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

  const entries = data?.entries || [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="h-[--toolbar-height] flex items-center gap-2 px-4 border-b border-border flex-shrink-0">
        <History className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-text">Commit History</span>
        <span className="text-xs text-text-muted truncate">· {path.split(/[/\\]/).pop()}</span>
        <span className="ml-auto text-xs text-text-muted tabular-nums">{entries.length} commits</span>
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
