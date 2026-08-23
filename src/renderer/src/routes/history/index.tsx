import { useCallback, useState } from 'react';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { CommitHistory } from '@renderer/components/CommitHistory';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';
import {
  HistoryViewToggle,
  RevisionGraphPanel,
  type HistoryViewMode,
} from '@renderer/components/history/RevisionGraphPanel';

/**
 * History surface (#45): the commit list, optionally flanked by the visual
 * revision graph. The mode is owned here (persisted per app session) and the
 * selected revision is shared both ways — clicking a graph dot highlights the
 * log row, clicking a log row highlights the dot. Scroll sync between the two
 * independently virtualized panes is approximate (proportional) and handled
 * inside the graph panel, so the commit list stays untouched by it.
 */

const VIEW_MODE_STORAGE_KEY = 'shellysvn:history:view-mode';

function loadViewMode(): HistoryViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'graph' ? 'graph' : 'list';
  } catch {
    return 'list';
  }
}

/** Exported for the route wiring above and integration tests. */
export function HistorySurface() {
  const { path } = useSearch({ from: '/history/' });
  const [viewMode, setViewMode] = useState<HistoryViewMode>(loadViewMode);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);

  const handleViewModeChange = useCallback((mode: HistoryViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private mode, disabled): the in-memory mode still applies.
    }
  }, []);

  const handleSelectRevision = useCallback((revision: number) => {
    setSelectedRevision(revision);
  }, []);

  const showGraph = viewMode === 'graph' && !!path && path !== '/';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex h-[--toolbar-height] flex-shrink-0 items-center gap-3 border-b border-border px-4">
        <HistoryViewToggle value={viewMode} onChange={handleViewModeChange} />
        {showGraph && (
          <span className="truncate text-xs text-text-muted">
            Branch and merge history beside the log — click a dot or a row to select a revision
          </span>
        )}
      </div>
      <div className="flex flex-1 min-h-0">
        {showGraph && (
          <RevisionGraphPanel
            path={path}
            selectedRevision={selectedRevision}
            onSelectRevision={handleSelectRevision}
          />
        )}
        <CommitHistory
          selectedRevision={selectedRevision}
          onSelectRevision={handleSelectRevision}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/history/')({
  component: () => (
    <RouteErrorBoundary routeName="History">
      <HistorySurface />
    </RouteErrorBoundary>
  ),
  validateSearch: (search: Record<string, unknown>) => {
    return {
      path: (search.path as string) || '/',
    };
  },
});
