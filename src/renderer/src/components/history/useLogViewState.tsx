/**
 * Shared state for log search surfaces (#66, #67, #72): debounced filters,
 * a memoized compiled predicate, persisted per-working-copy column sort,
 * saved named views, CSV/JSON export of the current result set, and the
 * "Show changes" diff target. LogViewer and CommitHistory both run on it, and
 * any list surface (e.g. the repo browser's RevisionLogView) can adopt the
 * same tools by rendering the nodes from `useLogViewSurface`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SvnLogEntry } from '@shared/types';
import type { IssueTrackerConfig } from '@renderer/utils/issueTracker';
import { useOptimisticMutation } from '@renderer/lib/useOptimisticMutation';
import {
  compileLogFilters,
  DEFAULT_LOG_SORT,
  EMPTY_LOG_FILTERS,
  sortLogEntries,
  toggleLogSort,
  type LogFilterState,
  type LogSortKey,
  type LogSortState,
} from '@renderer/utils/logFilters';
import {
  defaultLogViews,
  loadLogSortState,
  loadSavedLogViews,
  missingBuiltinViews,
  newLogViewId,
  resolveLogViewFilters,
  saveLogSortState,
  saveSavedLogViews,
  type SavedLogView,
} from '@renderer/lib/logViews';
import { exportLogEntries, type LogExportFormat, type ExportLogResult } from '@renderer/lib/logExport';
import { LogFilterBar } from './LogFilterBar';
import { LogSortHeader } from './LogSortHeader';
import { RevisionDiffDialog } from './RevisionDiffDialog';
import { useDebouncedValue } from './useDebouncedValue';

export { useDebouncedValue };

const DEFAULT_DEBOUNCE_MS = 200;

export interface LogDiffTarget {
  path: string;
  revision: number;
}

export interface UseLogViewStateOptions {
  /** Working-copy path the log belongs to (persistence + diff target). */
  path: string | null;
  /** Unfiltered log entries. */
  entries: readonly SvnLogEntry[];
  /** Issue tracker config for the issue-id filter. */
  issueTrackerConfig?: IssueTrackerConfig;
  /** Text-input debounce window; 0 disables debouncing. */
  debounceMs?: number;
  /**
   * Persistence identity. Undefined: derived from `path` via
   * `getWorkingCopyContext`. A string: used verbatim (tests, custom scopes).
   * `null`: persistence disabled for this surface.
   */
  storageKey?: string | null;
  /** Sortable columns offered to the header. */
  sortColumns?: readonly LogSortKey[];
}

export interface UseLogViewStateResult {
  filters: LogFilterState;
  setFilters: (next: LogFilterState) => void;
  updateFilter: (name: keyof LogFilterState, value: string | boolean) => void;
  clearFilters: () => void;
  regexError: string | null;
  activeFilterCount: number;
  sort: LogSortState;
  setSort: (next: LogSortState) => void;
  toggleSort: (key: LogSortKey) => void;
  filteredEntries: SvnLogEntry[];
  views: SavedLogView[];
  saveCurrentView: (name: string) => Promise<SavedLogView | null>;
  applyView: (view: SavedLogView) => void;
  deleteView: (id: string) => Promise<void>;
  renameView: (id: string, name: string) => Promise<void>;
  restoreDefaultViews: () => Promise<void>;
  exportEntries: (format: LogExportFormat) => Promise<ExportLogResult>;
  exportNotice: string | null;
  dismissExportNotice: () => void;
  diffTarget: LogDiffTarget | null;
  /** Open the revision-vs-predecessor diff (#72); works from buttons and keyboard. */
  requestShowChanges: (revision: number, targetPath?: string) => void;
  closeDiff: () => void;
}

/** Resolve the working-copy root that keys view/sort persistence. */
function useWorkingCopyRoot(path: string | null, storageKey: string | null | undefined) {
  const [wcRoot, setWcRoot] = useState<string | null>(storageKey ?? null);

  useEffect(() => {
    if (storageKey !== undefined) {
      setWcRoot(storageKey);
      return;
    }
    if (!path) {
      setWcRoot(null);
      return;
    }
    let cancelled = false;
    window.api.svn
      .getWorkingCopyContext(path)
      .then((context) => {
        if (!cancelled) setWcRoot(context?.workingCopyRoot || path);
      })
      .catch(() => {
        if (!cancelled) setWcRoot(path);
      });
    return () => {
      cancelled = true;
    };
  }, [path, storageKey]);

  return wcRoot;
}

export function useLogViewState({
  path,
  entries,
  issueTrackerConfig,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  storageKey,
}: UseLogViewStateOptions): UseLogViewStateResult {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<LogFilterState>(EMPTY_LOG_FILTERS);
  const [sort, setSortState] = useState<LogSortState>(DEFAULT_LOG_SORT);
  const [views, setViews] = useState<SavedLogView[]>([]);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<LogDiffTarget | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededViewsRef = useRef<string | null>(null);

  const wcRoot = useWorkingCopyRoot(path, storageKey);
  const canPersist = wcRoot !== null && wcRoot !== '';

  // --- Filtering ----------------------------------------------------------
  const debouncedFilters = useDebouncedValue(filters, debounceMs);
  const compiled = useMemo(
    () => compileLogFilters(debouncedFilters, issueTrackerConfig),
    [debouncedFilters, issueTrackerConfig]
  );
  const filteredEntries = useMemo(
    () => sortLogEntries(entries.filter(compiled.predicate), sort),
    [entries, compiled, sort]
  );

  const updateFilter = useCallback((name: keyof LogFilterState, value: string | boolean) => {
    setFilters((current) => ({ ...current, [name]: value }));
  }, []);

  const clearFilters = useCallback(() => setFilters(EMPTY_LOG_FILTERS), []);

  const setSort = useCallback(
    (next: LogSortState) => {
      setSortState(next);
      if (canPersist) void saveLogSortState(wcRoot, next).catch(() => {});
    },
    [canPersist, wcRoot]
  );

  const toggleSortForKey = useCallback(
    (key: LogSortKey) => {
      setSortState((current) => {
        const next = toggleLogSort(current, key);
        if (canPersist) void saveLogSortState(wcRoot, next).catch(() => {});
        return next;
      });
    },
    [canPersist, wcRoot]
  );

  // --- Per-working-copy sort preference -----------------------------------
  useEffect(() => {
    if (!canPersist) return;
    let cancelled = false;
    loadLogSortState(wcRoot).then((stored) => {
      if (!cancelled && stored) setSortState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [canPersist, wcRoot]);

  // --- Saved views --------------------------------------------------------
  const [loadedViewsRoot, setLoadedViewsRoot] = useState<string | null>(null);
  // True once this session has mutated the views; a still-in-flight initial
  // store read must then not clobber the newer state.
  const viewsDirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    viewsDirtyRef.current = false;
    setViews([]);
    setLoadedViewsRoot(null);
    if (!canPersist) return;
    loadSavedLogViews(wcRoot).then((stored) => {
      if (cancelled || viewsDirtyRef.current) return;
      setViews(stored);
      setLoadedViewsRoot(wcRoot);
    });
    return () => {
      cancelled = true;
    };
  }, [canPersist, wcRoot]);

  // Seed the built-in views the first time a working copy with a log has no
  // saved views. Not persisted until the user edits them, so shipped defaults
  // never go stale in storage.
  useEffect(() => {
    if (!canPersist || loadedViewsRoot !== wcRoot || seededViewsRef.current === wcRoot) return;
    if (views.length > 0) {
      seededViewsRef.current = wcRoot;
      return;
    }
    if (entries.length === 0) return;
    seededViewsRef.current = wcRoot;
    setViews(defaultLogViews(entries));
  }, [canPersist, entries, loadedViewsRoot, views, wcRoot]);

  const persistViews = useCallback(
    async (next: SavedLogView[]) => {
      viewsDirtyRef.current = true;
      setViews(next);
      if (!canPersist) return;
      try {
        await saveSavedLogViews(wcRoot, next);
      } catch {
        // Storage failure keeps the in-memory views usable for this session.
      }
    },
    [canPersist, wcRoot]
  );

  const saveCurrentView = useCallback(
    async (name: string): Promise<SavedLogView | null> => {
      const trimmed = name.trim();
      if (!trimmed || compiled.regexError) return null;
      const now = new Date().toISOString();
      const existing = views.find((view) => view.name.toLowerCase() === trimmed.toLowerCase());
      const view: SavedLogView = existing
        ? { ...existing, name: trimmed, filters: { ...filters }, sort, updatedAt: now }
        : {
            id: newLogViewId(),
            name: trimmed,
            filters: { ...filters },
            sort: { ...sort },
            createdAt: now,
            updatedAt: now,
          };
      await persistViews(
        existing ? views.map((item) => (item.id === view.id ? view : item)) : [view, ...views]
      );
      return view;
    },
    [compiled.regexError, filters, persistViews, sort, views]
  );

  const applyView = useCallback((view: SavedLogView) => {
    setFilters(resolveLogViewFilters(view));
    setSortState(view.sort);
  }, []);

  /* --- Optimistic saved-view delete (#92 exemplar) -------------------------
   *
   * The views list is store-backed, not query-backed, so it is mirrored into
   * the query cache under `['log-views', wcRoot]`. `useOptimisticMutation`
   * then owns deletes: the view disappears from the dropdown the frame the
   * button is clicked, the store write runs behind it, and a failed write
   * rolls the list (cache and state) back to exactly what was there before.
   */
  const viewsCacheKey = useMemo(() => ['log-views', wcRoot] as const, [wcRoot]);

  useEffect(() => {
    if (!canPersist) return;
    queryClient.setQueryData<SavedLogView[]>(viewsCacheKey, views);
  }, [canPersist, queryClient, views, viewsCacheKey]);

  const deleteViewMutation = useOptimisticMutation<
    { id: string; current: SavedLogView[]; next: SavedLogView[] },
    SavedLogView[],
    void
  >({
    queryKey: viewsCacheKey,
    optimisticValue: (current, variables) =>
      [...(current ?? variables.current)].filter((view) => view.id !== variables.id),
    mutationFn: async (variables) => {
      if (!canPersist) return;
      await saveSavedLogViews(wcRoot, variables.next);
    },
    // Mirror cache changes into the hook's state so the dropdown and the cache
    // can never disagree — also on rollback.
    onApplied: (value) => {
      viewsDirtyRef.current = true;
      setViews(value);
    },
  });

  const deleteView = useCallback(
    async (id: string) => {
      const current =
        (queryClient.getQueryData(viewsCacheKey) as SavedLogView[] | undefined) ?? views;
      const next = current.filter((view) => view.id !== id);
      // Rollback is handled by the helper; a rejected write is surfaced by the
      // restored list, so the fire-and-forget callers stay clean.
      await deleteViewMutation.mutateAsync({ id, current, next }).catch(() => undefined);
    },
    [deleteViewMutation, queryClient, views, viewsCacheKey]
  );

  const renameView = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      await persistViews(
        views.map((view) => (view.id === id ? { ...view, name: trimmed, updatedAt: now } : view))
      );
    },
    [persistViews, views]
  );

  const restoreDefaultViews = useCallback(async () => {
    const missing = missingBuiltinViews(views, entries);
    if (missing.length === 0) return;
    await persistViews([...missing, ...views]);
  }, [entries, persistViews, views]);

  // --- Export ---------------------------------------------------------------
  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setExportNotice(message);
    noticeTimerRef.current = setTimeout(() => setExportNotice(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const exportEntries = useCallback(
    async (format: LogExportFormat) => {
      const result = await exportLogEntries(filteredEntries, format, { path });
      if (result.status !== 'cancelled') showNotice(result.message);
      return result;
    },
    [filteredEntries, path, showNotice]
  );

  const dismissExportNotice = useCallback(() => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setExportNotice(null);
  }, []);

  // --- Show changes (#72) ---------------------------------------------------
  const requestShowChanges = useCallback(
    (revision: number, targetPath?: string) => {
      const safeRevision = Math.floor(revision);
      if (!Number.isFinite(safeRevision) || safeRevision < 1) return;
      setDiffTarget({ path: targetPath || path || '', revision: safeRevision });
    },
    [path]
  );

  const closeDiff = useCallback(() => setDiffTarget(null), []);

  return {
    filters,
    setFilters,
    updateFilter,
    clearFilters,
    regexError: compiled.regexError,
    activeFilterCount: compiled.activeCount,
    sort,
    setSort,
    toggleSort: toggleSortForKey,
    filteredEntries,
    views,
    saveCurrentView,
    applyView,
    deleteView,
    renameView,
    restoreDefaultViews,
    exportEntries,
    exportNotice,
    dismissExportNotice,
    diffTarget,
    requestShowChanges,
    closeDiff,
  };
}

export interface UseLogViewSurfaceOptions extends UseLogViewStateOptions {
  /** Label for the search input; surfaces differ (revisions vs commits). */
  searchPlaceholder?: string;
  /** Counter wording, e.g. "revisions" or "commits". */
  countLabel?: string;
}

export interface UseLogViewSurfaceResult extends UseLogViewStateResult {
  /** The filter bar: search + regex toggle, field filters, views, export. */
  filterBar: ReactNode;
  /** Sortable column headers (keys from `sortColumns`, default all four). */
  sortHeader: ReactNode;
  /** The mounted revision-diff dialog (#72); opens via `requestShowChanges`. */
  diffDialog: ReactNode;
}

/**
 * `useLogViewState` plus the three pre-wired nodes, so a log surface adopts
 * the whole #66/#67/#72 toolset in a couple of lines:
 *
 * ```tsx
 * const logView = useLogViewSurface({ path, entries });
 * return (<>{logView.filterBar}{logView.sortHeader}<LogList …/>{logView.diffDialog}</>);
 * ```
 */
export function useLogViewSurface(options: UseLogViewSurfaceOptions): UseLogViewSurfaceResult {
  const state = useLogViewState(options);

  const filterBar = (
    <LogFilterBar
      logView={state}
      searchPlaceholder={options.searchPlaceholder}
      countLabel={options.countLabel}
    />
  );

  const sortHeader = (
    <LogSortHeader sort={state.sort} onToggle={state.toggleSort} columns={options.sortColumns} />
  );

  const diffDialog = (
    <RevisionDiffDialog
      isOpen={state.diffTarget !== null}
      onClose={state.closeDiff}
      path={state.diffTarget?.path ?? null}
      revision={state.diffTarget?.revision ?? null}
    />
  );

  return { ...state, filterBar, sortHeader, diffDialog };
}
