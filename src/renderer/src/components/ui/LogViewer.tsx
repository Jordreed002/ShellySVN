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
  GitCompare,
  RotateCcw,
  GitMerge,
  Sparkles,
  Copy,
  AlertCircle,
} from 'lucide-react';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';
import { useCachedLog } from '@renderer/hooks/useLogCache';
import { withIpcTimeout } from '@renderer/lib/queryTimeout';
import { AiPromptPreviewDialog } from '../ai/AiPromptPreviewDialog';
import { ErrorPanel } from './ErrorPanel';
import { SkeletonBlock, SkeletonLine, SkeletonList } from './Skeleton';
import { extractIssueLinks, type IssueLink } from '@renderer/utils/issueTracker';
import { useLogViewSurface } from '../history/useLogViewState';
import type {
  AiReleaseNotesResult,
  AiPromptPreviewResult,
  RevisionImpactReport,
  SvnLogResult,
  SvnLogEntry,
} from '@shared/types';

const LOG_PAGE_SIZE = 25;

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
  const [revisionImpact, setRevisionImpact] = useState<RevisionImpactReport | null>(null);
  const [revisionImpactError, setRevisionImpactError] = useState<string | null>(null);
  const [isLoadingRevisionImpact, setIsLoadingRevisionImpact] = useState(false);
  const [revisionImpactNonce, setRevisionImpactNonce] = useState(0);
  const [limit, setLimit] = useState(50);
  const [configPath, setConfigPath] = useState(path);
  const [currentPage, setCurrentPage] = useState(1);
  const [showMergeHistory, setShowMergeHistory] = useState(false);
  const [stopOnCopy, setStopOnCopy] = useState(false);
  const [strictNodeHistory, setStrictNodeHistory] = useState(false);
  const [includeAllRevisionProperties, setIncludeAllRevisionProperties] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<AiReleaseNotesResult | null>(null);
  const [releaseNotesError, setReleaseNotesError] = useState<string | null>(null);
  const [isGeneratingReleaseNotes, setIsGeneratingReleaseNotes] = useState(false);
  const [releasePromptPreview, setReleasePromptPreview] = useState<AiPromptPreviewResult | null>(
    null
  );
  const [pendingReleaseRange, setPendingReleaseRange] = useState<{
    startRevision: number;
    endRevision: number;
  } | null>(null);
  const releaseNotesAbortRef = useRef<AbortController | null>(null);
  const [revisionPropertyInput, setRevisionPropertyInput] = useState('');
  const revisionProperties = useMemo(
    () =>
      Array.from(
        new Set(
          revisionPropertyInput
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
        )
      ),
    [revisionPropertyInput]
  );
  const listRef = useRef<HTMLDivElement>(null);
  const { config: issueTrackerConfig } = useIssueTrackerConfig(configPath, path);
  const logRequestOptions = useMemo(
    () => ({
      stopOnCopy,
      strictNodeHistory,
      includeAllRevisionProperties,
      revisionProperties: includeAllRevisionProperties ? [] : revisionProperties,
    }),
    [includeAllRevisionProperties, revisionProperties, stopOnCopy, strictNodeHistory]
  );
  const { cachedLog, cacheInfo, hasCachedData, isRefreshing, refreshLog, clearCache } =
    useCachedLog(isOpen ? path : null, limit, showMergeHistory, logRequestOptions);
  const logView = useLogViewSurface({
    path: isOpen ? path : null,
    entries: log?.entries ?? [],
    issueTrackerConfig,
    sortColumns: ['revision', 'date', 'author'],
    countLabel: 'revisions',
  });
  const { filters, filteredEntries, requestShowChanges } = logView;
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / LOG_PAGE_SIZE));
  const pageStartIndex = (currentPage - 1) * LOG_PAGE_SIZE;
  const pagedEntries = filteredEntries.slice(pageStartIndex, pageStartIndex + LOG_PAGE_SIZE);
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
    if (!isOpen || !selectedEntry) {
      setRevisionImpact(null);
      setRevisionImpactError(null);
      return;
    }
    let cancelled = false;
    setIsLoadingRevisionImpact(true);
    setRevisionImpact(null);
    setRevisionImpactError(null);
    withIpcTimeout(
      () => window.api.svn.revisionImpact(path, 1, selectedEntry.revision),
      undefined,
      'svn:revisionImpact'
    )
      .then((report) => {
        if (!cancelled) setRevisionImpact(report);
      })
      .catch((impactError) => {
        if (!cancelled) {
          setRevisionImpactError(
            impactError instanceof Error ? impactError.message : 'Impact evidence is unavailable.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRevisionImpact(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, path, selectedEntry, revisionImpactNonce]);

  useEffect(() => {
    setCurrentPage(1);
    listRef.current?.scrollTo?.({ top: 0 });
  }, [filters, log]);
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

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
        const target = e.target as HTMLElement | null;
        if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      releaseNotesAbortRef.current?.abort();
    },
    []
  );

  // Keyboard navigation over the entry list (#72): arrows move the selection
  // (following it across pages), Enter opens "Show changes" for the selected
  // revision.
  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (filteredEntries.length === 0) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;

      const currentIndex = selectedEntry
        ? filteredEntries.findIndex((entry) => entry.revision === selectedEntry.revision)
        : -1;

      if (event.key === 'Enter') {
        if (currentIndex >= 0) {
          event.preventDefault();
          requestShowChanges(filteredEntries[currentIndex].revision, path);
        }
        return;
      }

      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        currentIndex === -1
          ? event.key === 'ArrowDown'
            ? 0
            : filteredEntries.length - 1
          : Math.min(filteredEntries.length - 1, Math.max(0, currentIndex + delta));
      const nextEntry = filteredEntries[nextIndex];
      setSelectedEntry(nextEntry);

      // Keep the focused row visible even across page boundaries.
      setCurrentPage(Math.floor(nextIndex / LOG_PAGE_SIZE) + 1);
      const focusRow = () => {
        const row = listRef.current?.querySelector<HTMLElement>(`[data-revision="${nextEntry.revision}"]`);
        if (!row) return;
        row.focus({ preventScroll: true });
        try {
          row.scrollIntoView({ block: 'nearest' });
        } catch {
          // scrollIntoView is not implemented in every host (e.g. jsdom).
        }
      };
      // jsdom and reduced-capability hosts may not provide rAF.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusRow);
      else setTimeout(focusRow, 0);
    },
    [filteredEntries, path, requestShowChanges, selectedEntry]
  );

  const selectedReleaseRange = () => {
    if (filteredEntries.length === 0) return;
    const revisions = filteredEntries.map((entry) => entry.revision);
    const requestedFrom = Number.parseInt(filters.revisionFrom, 10);
    const requestedTo = Number.parseInt(filters.revisionTo, 10);
    const requestedStart = Number.isFinite(requestedFrom) ? requestedFrom : Math.min(...revisions);
    const requestedEnd = Number.isFinite(requestedTo) ? requestedTo : Math.max(...revisions);
    return {
      startRevision: Math.min(requestedStart, requestedEnd),
      endRevision: Math.max(requestedStart, requestedEnd),
    };
  };

  const prepareReleaseNotes = async () => {
    const range = selectedReleaseRange();
    if (!range) return;
    setReleaseNotesError(null);
    try {
      setPendingReleaseRange(range);
      setReleasePromptPreview(
        await window.api.ai.preparePrompt({
          task: 'release-notes',
          request: { operationId: window.crypto.randomUUID(), path, ...range },
        })
      );
    } catch (previewError) {
      setReleaseNotesError(
        previewError instanceof Error ? previewError.message : 'Prompt preview failed.'
      );
    }
  };

  const generateReleaseNotes = async () => {
    if (!pendingReleaseRange) return;
    releaseNotesAbortRef.current?.abort();
    const controller = new AbortController();
    releaseNotesAbortRef.current = controller;
    setIsGeneratingReleaseNotes(true);
    setReleaseNotesError(null);
    try {
      setReleaseNotes(
        await window.api.ai.generateReleaseNotes(
          {
            operationId: window.crypto.randomUUID(),
            path,
            ...pendingReleaseRange,
          },
          { signal: controller.signal }
        )
      );
      setReleasePromptPreview(null);
    } catch (generationError) {
      if (!controller.signal.aborted) {
        setReleaseNotesError(
          generationError instanceof Error
            ? generationError.message
            : 'Release-note generation failed.'
        );
      }
    } finally {
      if (releaseNotesAbortRef.current === controller) {
        releaseNotesAbortRef.current = null;
        setIsGeneratingReleaseNotes(false);
      }
    }
  };

  if (!isOpen) return null;

  const pathName = path.split(/[/\\]/).pop() || path;

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
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={showMergeHistory}
                onChange={(event) => {
                  setShowMergeHistory(event.target.checked);
                  setLog(null);
                  setSelectedEntry(null);
                }}
                disabled={isLoading}
              />
              <GitMerge className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
              Merged revisions
            </label>
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={stopOnCopy}
                onChange={(event) => setStopOnCopy(event.target.checked)}
              />
              Stop on copy
            </label>
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={strictNodeHistory}
                onChange={(event) => setStrictNodeHistory(event.target.checked)}
              />
              Strict history
            </label>
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={includeAllRevisionProperties}
                onChange={(event) => setIncludeAllRevisionProperties(event.target.checked)}
              />
              All revision properties
            </label>
            <button
              onClick={loadLog}
              disabled={isLoading}
              className="btn-icon-sm"
              title="Refresh"
              aria-label="Refresh revision history"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading || isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={() =>
                isGeneratingReleaseNotes
                  ? releaseNotesAbortRef.current?.abort()
                  : void prepareReleaseNotes()
              }
              disabled={!isGeneratingReleaseNotes && filteredEntries.length === 0}
              className="btn btn-primary btn-sm text-xs"
              title="Generate structured notes for the filtered revision range"
            >
              {isGeneratingReleaseNotes ? (
                <Loader
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGeneratingReleaseNotes ? 'Cancel' : 'Release notes'}
            </button>
            <button onClick={onClose} className="btn-icon-sm" aria-label="Close revision history">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Filters, saved views, export (#66/#67) */}
        <div className="flex-shrink-0 border-b border-border bg-bg-secondary px-4 pt-3">
          <label className="mb-3 block text-xs text-text-secondary">
            Revision properties
            <input
              type="text"
              value={revisionPropertyInput}
              onChange={(event) => setRevisionPropertyInput(event.target.value)}
              disabled={includeAllRevisionProperties}
              className="input ml-2 h-8 min-w-64 text-xs"
              placeholder="e.g. review:status, build:id"
              aria-label="Revision properties"
            />
          </label>
        </div>
        {logView.filterBar}

        {releaseNotesError && (
          <div
            className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error"
            role="alert"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {releaseNotesError}
          </div>
        )}

        {releaseNotes && (
          <section
            className="max-h-72 flex-shrink-0 overflow-auto border-b border-accent/25 bg-bg-sunk px-4 py-3"
            aria-live="polite"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <div className="text-10 font-semibold uppercase tracking-caps text-accent">
                  AI release draft · r{releaseNotes.startRevision}–r{releaseNotes.endRevision}
                </div>
                <h3 className="mt-1 text-base font-semibold text-text">{releaseNotes.title}</h3>
                <p className="text-10.5 text-text-faint">
                  {releaseNotes.provider}
                  {releaseNotes.model ? ` · ${releaseNotes.model}` : ''} ·{' '}
                  {(releaseNotes.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-xs"
                  onClick={() =>
                    void navigator.clipboard.writeText(formatReleaseNotes(releaseNotes))
                  }
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                <button
                  type="button"
                  className="btn-icon-sm"
                  onClick={() => setReleaseNotes(null)}
                  aria-label="Close release-note draft"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReleaseNoteSection title="User-facing" items={releaseNotes.userFacing} />
              <ReleaseNoteSection title="Technical" items={releaseNotes.technical} />
              <ReleaseNoteSection
                title="Breaking changes"
                items={releaseNotes.breakingChanges}
                empty="None identified"
              />
              <ReleaseNoteSection
                title="Upgrade notes"
                items={releaseNotes.upgradeNotes}
                empty="No upgrade steps identified"
              />
            </div>
            {releaseNotes.references.length > 0 && (
              <p className="mt-3 text-10.5 text-text-faint">
                References: {releaseNotes.references.join(' · ')}
              </p>
            )}
          </section>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Log entries list */}
          <div
            ref={listRef}
            className="w-80 flex-shrink-0 border-r border-border overflow-auto"
            onKeyDown={handleListKeyDown}
          >
            {isLoading && !log && (
              // Full-surface loading: a skeleton shaped like the revision
              // column, not a bare spinner (#92).
              <SkeletonList
                rows={7}
                label="Loading revision history"
                className="h-full overflow-hidden"
                row={(index) => (
                  <div className="flex items-start gap-2 p-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <SkeletonBlock className="h-3.5 w-16" />
                        <SkeletonBlock className="h-5 w-5 rounded-5" />
                      </div>
                      <SkeletonLine className={`h-2.5 ${index % 3 === 0 ? 'w-full' : 'w-4/5'}`} />
                      <SkeletonLine className="h-2 w-24" />
                    </div>
                  </div>
                )}
              />
            )}

            {error && !log && (
              <ErrorPanel
                title="Failed to load log"
                message={error}
                onRetry={loadLog}
                isRetrying={isLoading}
              />
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
              <div>
                <div className="sticky top-0 z-10">
                  {logView.sortHeader}
                </div>
                <div className="divide-y divide-border">
                  {pagedEntries.map((entry, index) => {
                    const issueLinks = extractIssueLinks(entry.message, issueTrackerConfig);
                    const selected = selectedEntry?.revision === entry.revision;

                    return (
                      <div
                        key={entry.revision}
                        data-revision={entry.revision}
                        tabIndex={selected || (!selectedEntry && index === 0) ? 0 : -1}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => setSelectedEntry(entry)}
                        onDoubleClick={() => requestShowChanges(entry.revision, path)}
                        onKeyDown={(event) => {
                          if (event.key === ' ') {
                            event.preventDefault();
                            setSelectedEntry(entry);
                          }
                        }}
                        className={`p-3 cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                          selected
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
                              <button
                                type="button"
                                className="btn-icon-sm flex-none"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  requestShowChanges(entry.revision, path);
                                }}
                                onKeyDown={(event) => event.stopPropagation()}
                                aria-label={`Show changes for r${entry.revision}`}
                                title={`Show changes for r${entry.revision} (vs r${entry.revision - 1})`}
                              >
                                <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
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

                <section className="mb-4 overflow-hidden rounded-lg border border-border bg-bg-secondary">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Revision impact evidence
                    </h4>
                    {revisionImpact && (
                      <span className="font-mono text-[10px] text-text-faint">
                        {revisionImpact.changedPathCount} paths
                      </span>
                    )}
                  </div>
                  {isLoadingRevisionImpact && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                      <Loader className="h-3.5 w-3.5 animate-spin" /> Classifying changed paths…
                    </div>
                  )}
                  {revisionImpactError && (
                    <div className="flex items-start gap-2 px-3 py-3 text-xs text-error">
                      <span className="min-w-0 flex-1">{revisionImpactError}</span>
                      <button
                        type="button"
                        onClick={() => setRevisionImpactNonce((nonce) => nonce + 1)}
                        className="btn btn-secondary btn-sm flex-none text-xs"
                        aria-label="Retry impact classification"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Retry
                      </button>
                    </div>
                  )}
                  {revisionImpact && (
                    <div className="grid grid-cols-2 gap-px bg-border">
                      {revisionImpact.groups.map((group) => (
                        <div key={group.category} className="min-w-0 bg-bg-secondary p-3">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium capitalize text-text">
                              {group.category.replace('branch-or-tag', 'Branches / tags')}
                            </span>
                            <span className="font-mono text-[10px] text-text-faint">
                              {group.evidence.length}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {group.evidence.slice(0, 4).map((evidence) => {
                              const content = (
                                <>
                                  <span className="text-accent">{evidence.action}</span>{' '}
                                  {evidence.path}
                                </>
                              );
                              return onSelectRevision ? (
                                <button
                                  type="button"
                                  key={`${evidence.revision}-${evidence.path}`}
                                  onClick={() => onSelectRevision(evidence.revision, evidence.path)}
                                  className="block w-full truncate text-left font-mono text-[10px] text-text-secondary hover:text-accent"
                                  title={`Open r${evidence.revision}: ${evidence.path}`}
                                >
                                  {content}
                                </button>
                              ) : (
                                <div
                                  key={`${evidence.revision}-${evidence.path}`}
                                  className="truncate font-mono text-[10px] text-text-secondary"
                                  title={evidence.path}
                                >
                                  {content}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {selectedEntry.revisionProperties &&
                  Object.keys(selectedEntry.revisionProperties).length > 0 && (
                    <div className="mb-4">
                      <h4 className="mb-2 text-sm font-medium text-text-secondary">
                        Revision Properties
                      </h4>
                      <dl className="overflow-hidden rounded-lg bg-bg-secondary">
                        {Object.entries(selectedEntry.revisionProperties).map(([name, value]) => (
                          <div
                            key={name}
                            className="grid grid-cols-[12rem_1fr] gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
                          >
                            <dt className="truncate font-mono text-text-secondary">{name}</dt>
                            <dd className="whitespace-pre-wrap break-words text-text">
                              {value || <span className="italic text-text-faint">Empty</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
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
                <div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
                  <button
                    onClick={() => requestShowChanges(selectedEntry.revision, path)}
                    className="btn btn-primary"
                    title={`Diff r${selectedEntry.revision} against r${selectedEntry.revision - 1}`}
                  >
                    <GitCompare className="h-4 w-4" aria-hidden="true" />
                    Show changes
                  </button>
                  {onSelectRevision && (
                    <button
                      onClick={() => onSelectRevision(selectedEntry.revision, path)}
                      className="btn btn-secondary"
                    >
                      View Diff for this Revision
                    </button>
                  )}
                </div>
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
            <div className="flex items-center justify-between gap-3">
              <span>
                Showing {filteredEntries.length === 0 ? 0 : pageStartIndex + 1}-
                {Math.min(pageStartIndex + LOG_PAGE_SIZE, filteredEntries.length)} of{' '}
                {filteredEntries.length} matching revisions ({log.entries.length} loaded, r
                {log.startRevision} - r{log.endRevision})
              </span>
              {filteredEntries.length > LOG_PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm text-xs"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-muted">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm text-xs"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {releasePromptPreview && (
        <AiPromptPreviewDialog
          preview={releasePromptPreview}
          title="Review release-note prompt"
          isSending={isGeneratingReleaseNotes}
          onCancel={() => {
            setReleasePromptPreview(null);
            setPendingReleaseRange(null);
          }}
          onConfirm={() => void generateReleaseNotes()}
        />
      )}
      {/* "Show changes" target (#72): revision against its predecessor */}
      {logView.diffDialog}
    </div>
  );
}

function handleOpenIssue(url?: string) {
  if (!url) return;
  void window.api.app.openExternal(url);
}

function ReleaseNoteSection({
  title,
  items,
  empty = 'No items',
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <div className="rounded-8 border border-border bg-bg-secondary/70 p-3">
      <h4 className="text-11 font-semibold uppercase tracking-caps text-text-muted">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-11.5 text-text-secondary">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-11 text-text-faint">{empty}</p>
      )}
    </div>
  );
}

function formatReleaseNotesSection(title: string, items: string[]): string {
  return items.length > 0
    ? `\n## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`
    : '';
}

function formatReleaseNotes(notes: AiReleaseNotesResult): string {
  return `# ${notes.title}\n${formatReleaseNotesSection('User-facing changes', notes.userFacing)}${formatReleaseNotesSection('Technical changes', notes.technical)}${formatReleaseNotesSection('Breaking changes', notes.breakingChanges)}${formatReleaseNotesSection('Upgrade notes', notes.upgradeNotes)}${formatReleaseNotesSection('References', notes.references)}`;
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
