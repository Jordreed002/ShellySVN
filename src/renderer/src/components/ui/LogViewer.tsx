import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  History,
  Loader,
  User,
  Calendar,
  GitCommit,
  RefreshCw,
  ExternalLink,
  Filter,
  Search,
  RotateCcw,
} from 'lucide-react';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';
import { useCachedLog } from '@renderer/hooks/useLogCache';
import {
  EMPTY_LOG_FILTERS,
  countActiveLogFilters,
  filterLogEntries,
  type LogFilterState,
} from '@renderer/utils/logFilters';
import { extractIssueLinks, type IssueLink } from '@renderer/utils/issueTracker';
import type { SvnLogResult, SvnLogEntry } from '@shared/types';

interface LogViewerProps {
  isOpen: boolean;
  path: string;
  onClose: () => void;
  onSelectRevision?: (revision: number, path: string) => void;
}

export function LogViewer({ isOpen, path, onClose, onSelectRevision }: LogViewerProps) {
  const [log, setLog] = useState<SvnLogResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SvnLogEntry | null>(null);
  const [limit, setLimit] = useState(50);
  const [configPath, setConfigPath] = useState(path);
  const [filters, setFilters] = useState<LogFilterState>(EMPTY_LOG_FILTERS);
  const listRef = useRef<HTMLDivElement>(null);
  const { config: issueTrackerConfig } = useIssueTrackerConfig(configPath, path);
  const { cachedLog, cacheInfo, hasCachedData, isRefreshing, refreshLog, clearCache } =
    useCachedLog(isOpen ? path : null, limit);
  const filteredEntries = useMemo(
    () => filterLogEntries(log?.entries || [], filters, issueTrackerConfig),
    [log, filters, issueTrackerConfig]
  );
  const activeFilterCount = countActiveLogFilters(filters);
  const selectedIssueLinks = useMemo(
    () => (selectedEntry ? extractIssueLinks(selectedEntry.message, issueTrackerConfig) : []),
    [selectedEntry, issueTrackerConfig]
  );

  const loadLog = useCallback(async () => {
    if (!path) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await refreshLog();
      if (result) {
        setLog(result);
      }
    } catch (err) {
      setError(
        hasCachedData
          ? 'Failed to refresh log; showing cached history.'
          : (err as Error).message || 'Failed to load log'
      );
    } finally {
      setIsLoading(false);
    }
  }, [hasCachedData, path, refreshLog]);

  useEffect(() => {
    if (isOpen && path) {
      loadLog();
      setSelectedEntry(null);
    }
  }, [isOpen, path, loadLog]);

  useEffect(() => {
    if (isOpen && cachedLog && !log) {
      setLog(cachedLog);
    }
  }, [cachedLog, isOpen, log]);

  useEffect(() => {
    if (
      selectedEntry &&
      !filteredEntries.some((entry) => entry.revision === selectedEntry.revision)
    ) {
      setSelectedEntry(null);
    }
  }, [filteredEntries, selectedEntry]);

  useEffect(() => {
    let cancelled = false;

    async function resolveConfigPath() {
      if (!isOpen || !path) return;

      try {
        const context = await window.api.svn.getWorkingCopyContext(path);
        if (!cancelled) {
          setConfigPath(context?.workingCopyRoot || path);
        }
      } catch {
        if (!cancelled) {
          setConfigPath(path);
        }
      }
    }

    resolveConfigPath();

    return () => {
      cancelled = true;
    };
  }, [isOpen, path]);

  // Keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const pathName = path.split(/[/\\]/).pop() || path;
  const updateFilter = (name: keyof LogFilterState, value: string) => {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-[1000px] max-w-[95vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <History className="w-5 h-5 text-accent" />
            Log: {pathName}
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="input text-sm py-1"
            >
              <option value={25}>25 entries</option>
              <option value={50}>50 entries</option>
              <option value={100}>100 entries</option>
              <option value={200}>200 entries</option>
            </select>
            {cacheInfo && (
              <span className="text-xs text-text-muted" title="Cached log entries">
                Cached {cacheInfo.entryCount}
              </span>
            )}
            {hasCachedData && (
              <button
                type="button"
                onClick={async () => {
                  await clearCache();
                  setLog(null);
                  await loadLog();
                }}
                className="btn btn-secondary btn-sm text-xs"
                title="Clear cached log"
              >
                Clear cache
              </button>
            )}
            <button onClick={loadLog} disabled={isLoading} className="btn-icon-sm" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${isLoading || isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex-shrink-0 border-b border-border bg-bg-secondary px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
              <Filter className="h-4 w-4 text-text-muted" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_LOG_FILTERS)}
                className="btn btn-secondary btn-sm text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <FilterInput
              label="Author"
              value={filters.author}
              onChange={(value) => updateFilter('author', value)}
              placeholder="author"
            />
            <FilterInput
              label="Message"
              value={filters.message}
              onChange={(value) => updateFilter('message', value)}
              placeholder="message"
            />
            <FilterInput
              label="Path"
              value={filters.path}
              onChange={(value) => updateFilter('path', value)}
              placeholder="path"
            />
            <FilterInput
              label="Issue"
              value={filters.issueId}
              onChange={(value) => updateFilter('issueId', value)}
              placeholder="issue ID"
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <FilterInput
              label="Revision from"
              type="number"
              value={filters.revisionFrom}
              onChange={(value) => updateFilter('revisionFrom', value)}
              placeholder="rev from"
            />
            <FilterInput
              label="Revision to"
              type="number"
              value={filters.revisionTo}
              onChange={(value) => updateFilter('revisionTo', value)}
              placeholder="rev to"
            />
            <FilterInput
              label="Date from"
              type="date"
              value={filters.dateFrom}
              onChange={(value) => updateFilter('dateFrom', value)}
            />
            <FilterInput
              label="Date to"
              type="date"
              value={filters.dateTo}
              onChange={(value) => updateFilter('dateTo', value)}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Log entries list */}
          <div ref={listRef} className="w-80 flex-shrink-0 border-r border-border overflow-auto">
            {isLoading && !log && (
              <div className="flex items-center justify-center h-full">
                <Loader className="w-6 h-6 text-accent animate-spin" />
              </div>
            )}

            {error && !log && (
              <div className="flex items-center justify-center h-full p-4 text-center">
                <div className="text-error">{error}</div>
              </div>
            )}
            {error && log && (
              <div className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {error}
              </div>
            )}

            {log && log.entries.length === 0 && (
              <div className="flex items-center justify-center h-full text-text-muted">
                No history found
              </div>
            )}

            {log && log.entries.length > 0 && filteredEntries.length === 0 && (
              <div className="flex items-center justify-center h-full p-4 text-center text-text-muted">
                No revisions match the current filters
              </div>
            )}

            {log && filteredEntries.length > 0 && (
              <div className="divide-y divide-border">
                <div className="sticky top-0 z-10 grid grid-cols-[1fr_6rem] gap-2 bg-bg-secondary px-3 py-1.5 text-[10px] font-medium uppercase text-text-faint">
                  <span>Revision</span>
                  <span>Issues</span>
                </div>
                {filteredEntries.map((entry) => {
                  const issueLinks = extractIssueLinks(entry.message, issueTrackerConfig);

                  return (
                    <div
                      key={entry.revision}
                      onClick={() => setSelectedEntry(entry)}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedEntry?.revision === entry.revision
                          ? 'bg-accent/10 border-l-2 border-l-accent'
                          : 'hover:bg-bg-elevated border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_6rem] gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm text-accent font-medium">
                              r{entry.revision}
                            </span>
                            <span className="text-xs text-text-muted flex-1 truncate">
                              {entry.author}
                            </span>
                          </div>
                          <div className="text-xs text-text-secondary line-clamp-2">
                            {entry.message || (
                              <span className="italic text-text-faint">No message</span>
                            )}
                          </div>
                          <div className="text-xs text-text-faint mt-1">
                            {formatDate(entry.date)}
                          </div>
                        </div>
                        <IssueSummary issues={issueLinks} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected entry details */}
          <div className="flex-1 overflow-auto bg-bg">
            {selectedEntry ? (
              <div className="p-4">
                {/* Revision header */}
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center">
                    <GitCommit className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <div className="text-xl font-mono font-medium text-text">
                      Revision {selectedEntry.revision}
                    </div>
                    <div className="text-sm text-text-secondary">{pathName}</div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary">Author:</span>
                    <span className="text-text font-medium">{selectedEntry.author}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary">Date:</span>
                    <span className="text-text font-medium">
                      {formatDateFull(selectedEntry.date)}
                    </span>
                  </div>
                </div>

                {/* Message */}
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-text-secondary mb-2">Message</h4>
                  <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text whitespace-pre-wrap">
                    {selectedEntry.message || (
                      <span className="italic text-text-faint">No commit message</span>
                    )}
                  </div>
                </div>

                {selectedIssueLinks.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-text-secondary mb-2">Issues</h4>
                    <IssueLinkList issues={selectedIssueLinks} onOpen={handleOpenIssue} />
                  </div>
                )}

                {/* Changed paths */}
                {selectedEntry.paths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-secondary mb-2">
                      Changed Paths ({selectedEntry.paths.length})
                    </h4>
                    <div className="bg-bg-secondary rounded-lg overflow-hidden">
                      {selectedEntry.paths.slice(0, 20).map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border last:border-0"
                        >
                          <span
                            className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                              p.action === 'A'
                                ? 'bg-svn-added/20 text-svn-added'
                                : p.action === 'D'
                                  ? 'bg-svn-deleted/20 text-svn-deleted'
                                  : p.action === 'R'
                                    ? 'bg-svn-replaced/20 text-svn-replaced'
                                    : 'bg-svn-modified/20 text-svn-modified'
                            }`}
                          >
                            {p.action}
                          </span>
                          <span className="text-text-secondary truncate flex-1">{p.path}</span>
                        </div>
                      ))}
                      {selectedEntry.paths.length > 20 && (
                        <div className="px-3 py-2 text-sm text-text-muted text-center">
                          ...and {selectedEntry.paths.length - 20} more
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                {onSelectRevision && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <button
                      onClick={() => onSelectRevision(selectedEntry.revision, path)}
                      className="btn btn-secondary"
                    >
                      View Diff for this Revision
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted">
                <div className="text-center">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Select a revision to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {log && log.entries.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-t border-border text-sm text-text-secondary">
            Showing {filteredEntries.length} of {log.entries.length} revisions (r
            {log.startRevision} - r{log.endRevision})
          </div>
        )}
      </div>
    </div>
  );
}

function handleOpenIssue(url?: string) {
  if (!url) return;
  void window.api.app.openExternal(url);
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'date' | 'number' | 'text';
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div className="relative">
        {type === 'text' && (
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
            aria-hidden="true"
          />
        )}
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`input h-8 text-xs ${type === 'text' ? 'pl-7' : ''}`}
          placeholder={placeholder || label}
          aria-label={label}
        />
      </div>
    </label>
  );
}

function IssueSummary({ issues }: { issues: IssueLink[] }) {
  if (issues.length === 0) {
    return <div className="pt-0.5 text-xs text-text-faint">-</div>;
  }

  return (
    <div className="flex flex-col items-start gap-1 pt-0.5">
      {issues.slice(0, 3).map((issue) => (
        <span
          key={issue.id}
          className="max-w-full truncate rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-accent"
          title={issue.id}
        >
          {issue.id}
        </span>
      ))}
    </div>
  );
}

function IssueLinkList({
  issues,
  onOpen,
}: {
  issues: IssueLink[];
  onOpen: (url?: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {issues.map((issue) =>
        issue.url ? (
          <button
            key={issue.id}
            type="button"
            onClick={() => onOpen(issue.url)}
            className="inline-flex items-center gap-1 rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-accent hover:bg-bg-tertiary"
            title={issue.url}
          >
            {issue.id}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span
            key={issue.id}
            className="rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-secondary"
          >
            {issue.id}
          </span>
        )
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function formatDateFull(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
