import { useCallback, useState } from 'react';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { RevisionDiffDialog } from '@renderer/components/history/RevisionDiffDialog';
import { CommitHistory } from '@renderer/components/CommitHistory';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';
import {
  HistoryViewToggle,
  RevisionGraphPanel,
  type HistoryViewMode,
} from '@renderer/components/history/RevisionGraphPanel';

/** List and graph are separate views; graph rows own their commit metadata. */

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
  const [diffRevision, setDiffRevision] = useState<number | null>(null);
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
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden flex-col">
      <div className="flex min-w-0 h-[--toolbar-height] flex-shrink-0 items-center gap-3 overflow-hidden border-b border-border px-4">
        <HistoryViewToggle value={viewMode} onChange={handleViewModeChange} />
        {showGraph && (
          <span className="truncate text-xs text-text-muted">
            Select a revision to read its message and show changes
          </span>
        )}
      </div>
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {showGraph ? (
          <RevisionGraphPanel
            key={path}
            path={path}
            selectedRevision={selectedRevision}
            onSelectRevision={handleSelectRevision}
            onShowChanges={setDiffRevision}
          />
        ) : (
          <CommitHistory
            selectedRevision={selectedRevision}
            onSelectRevision={handleSelectRevision}
          />
        )}
      </div>
      {diffRevision !== null && (
        <RevisionDiffDialog
          key={path}
          isOpen
          path={path}
          revision={diffRevision}
          onClose={() => setDiffRevision(null)}
        />
      )}
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
