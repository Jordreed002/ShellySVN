import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  lazy,
  Suspense,
  useDeferredValue,
} from 'react';
import {
  FolderX,
  AlertCircle,
  ClipboardCopy,
  FolderDown,
  Loader,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type {
  DeepStatusProgress,
  SvnListResult,
  SvnOperationRevision,
  SvnStatusEntry,
  SvnStatusChar,
} from '@shared/types';
import { PathAddressBar } from './ui/Breadcrumb';
import { MillerColumns } from './files/MillerColumns';
import { BranchSwitcher } from '../features/branches/BranchSwitcher';
import { SVN_EVENTS } from '../lib/svnOperationEvents';
import { RouteState } from './ui/RouteState';
import { Toolbar } from './ui/Toolbar';
import { ProgressIndicator } from './ui/ProgressIndicator';
import { FILE_ROW_HEIGHT, FILE_ROW_HEIGHT_COMPACT, FileRow, FileListHeader } from './ui/FileRow';
import { FilterBar, useFileFilters } from './ui/FilterBar';
import { confirmAppAction, promptAppInput, showAppMessage } from '../utils/dialogs';
import { assertSuccessfulSvnRead } from '../utils/svnReadResult';
import { readCachedList } from '../utils/cachedSvnRead';
import { useDualPane } from './ui/DualPaneView';
import { useFileExplorerActions } from '../hooks/useSvnActions';
import { useSettings } from '../hooks/useSettings';
import { useHomePath } from '../hooks/useHomePath';
import { useFolderSizes } from '../hooks/useFolderSizes';
import { useCodeEditors } from '../hooks/useCodeEditors';
import {
  applyDeepStatus,
  buildFolderChangeCounts,
  fileInfoToEntry,
} from '../features/files/fileStatus';
import { appendExcludedChildren, isInsideWorkingCopy } from '../features/files/excludedChildren';
import { createSvnListQueryKey, getAuthPresenceKey } from '../features/files/authQueryKeys';
import { compileIgnorePatterns, filterAndSortEntries } from '../features/files/fileListTransforms';
import { invalidateWorkingCopyViews } from '../features/files/useInvalidateStatus';
import { SettingsDialog } from './ui/SettingsDialog';
import {
  DraggableFileRow,
  performSvnOperation,
  type DragDropOperation,
} from '../hooks/useDragDrop';
import { FileExplorerAuthPrompt } from './files/FileExplorerAuthPrompt';
import { useFileExplorerAuthPrompt } from './files/useFileExplorerAuthPrompt';
import {
  useFileExplorerKeyboardNavigation,
  useFileExplorerSelection,
} from './files/useFileExplorerSelection';
import { useFileExplorerDialogState } from './files/useFileExplorerDialogState';
import {
  FILE_CACHE_TIME,
  STATUS_STALE_TIME,
  useFileExplorerDirectoryData,
} from './files/useFileExplorerDirectoryData';
import { resolveRemoteUpdateTarget } from './files/remoteUpdateTarget';
import { isNotOnDisk } from './files/entryPresence';
import { resolveRemoteUrlToLocalPath } from '../utils/pathResolution';
import { useFileExplorerCommandEvents } from './files/useFileExplorerCommandEvents';
import {
  ApplyPatchDialog,
  BlameViewer,
  BranchTagCompareDialog,
  BranchTagDialog,
  ChangelistDialog,
  CommitDialog,
  CommitDialogLoader,
  CreatePatchDialog,
  DialogLoader,
  DiffViewer,
  ExportDialog,
  FilePreview,
  IgnoreDialog,
  ImportDialog,
  LockManagementDialog,
  LogViewer,
  MergeWizard,
  ModificationsView,
  MoveRenameDialog,
  PropertiesDialog,
  QuickNotesPanel,
  RelocateDialog,
  RepoDiagnosticsPanel,
  ResolveDialog,
  RevisionGraph,
  ShelveDialog,
  SwitchDialog,
  UpdateToRevisionDialog,
  loadCommitDialog,
} from './files/FileExplorerLazyDialogs';
import {
  TREE_PANE_MAX_WIDTH,
  TREE_PANE_MIN_WIDTH,
  useWorkingCopyTreePane,
} from './files/useWorkingCopyTreePane';

/**
 * The folder tree pulls in the repository browser's `RepoTree`. Loading it on
 * demand keeps that code out of the renderer's initial chunk, which is already
 * at its budget, and costs nothing when the pane is collapsed.
 */
const WorkingCopyTree = lazy(() =>
  import('./files/WorkingCopyTree').then((m) => ({ default: m.WorkingCopyTree }))
);
const WorkingCopyProblemsDialog = lazy(() =>
  import('./files/WorkingCopyProblemsDialog').then((m) => ({
    default: m.WorkingCopyProblemsDialog,
  }))
);

function WorkingCopyTreeFallback() {
  return (
    <div className="flex-1 space-y-1 px-2 pt-2" aria-hidden="true">
      {[70, 88, 54, 76, 62, 84, 58].map((width) => (
        <div
          key={width}
          className="h-[27px] rounded-md bg-bg-elevated/50 animate-pulse"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Buttons inside the floating selection bar. The bar sits on an elevated surface
 * like every other panel in the app, so these are the app's own small buttons —
 * the previous pair (`text-bg` on `bg-text`) inverted the whole strip to near
 * white, which is the one thing in the window that did not look like the app.
 */
const SELECTION_BUTTON =
  'inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-bg-secondary px-2.5 text-xs font-semibold text-text-secondary transition-fast hover:border-accent/40 hover:bg-bg-tertiary hover:text-text disabled:pointer-events-none disabled:opacity-50';

function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = globalThis.setTimeout(callback, timeout);
  return () => globalThis.clearTimeout(id);
}

export function FileExplorer() {
  const { path, dialog } = useSearch({ from: '/files/' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: svnCapabilities } = useQuery({
    queryKey: ['svn:capabilities'],
    queryFn: () => window.api.svn.capabilities(),
    staleTime: Infinity,
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const homePath = useHomePath();
  const { settings, updateSettings, addRecentPath, addBookmark, removeBookmark } = useSettings();
  const explorerViewMode = settings.explorerViewMode ?? 'miller';

  // Track recent paths on navigation
  useEffect(() => {
    if (path && path !== 'DRIVES://') {
      addRecentPath(path);
    }
  }, [path, addRecentPath]);

  // Check if current path is bookmarked
  const isBookmarked = settings.bookmarks?.some((b) => b.path === path) ?? false;

  const handleToggleBookmark = useCallback(() => {
    if (!path || path === 'DRIVES://') return;
    if (isBookmarked) {
      removeBookmark(path);
    } else {
      const name = path.split(/[/\\]/).pop() || path;
      addBookmark(path, name);
    }
  }, [path, isBookmarked, addBookmark, removeBookmark]);

  /**
   * Include the repository's entries that are not on disk here — presence
   * `none` in the repository browser's vocabulary. They are server facts, so
   * they carry no `svn status`.
   */
  const [showNotCheckedOut, setShowNotCheckedOut] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isUpgradingWorkingCopy, setIsUpgradingWorkingCopy] = useState(false);
  const [isAddingToWorkingCopy, setIsAddingToWorkingCopy] = useState(false);
  const [problemsPath, setProblemsPath] = useState<string | null>(null);

  const {
    applyPatchPath,
    blamePath,
    branchTagCompareOpen,
    branchTagMode,
    branchTagPath,
    changelistPath,
    createPatchPath,
    diagnosticsOpen,
    diffViewerPath,
    exportPath,
    ignoreEntry,
    isImportDialogOpen,
    lockManagementPath,
    logViewerPath,
    mergePath,
    modificationsPath,
    moveRenameTarget,
    pendingUpdateEntry,
    propertiesPath,
    relocatePath,
    resolveEntry,
    revisionGraphPath,
    setApplyPatchPath,
    setBlamePath,
    setBranchTagCompareOpen,
    setBranchTagMode,
    setBranchTagPath,
    setChangelistPath,
    setCreatePatchPath,
    setDiagnosticsOpen,
    setDiffViewerPath,
    setExportPath,
    setIgnoreEntry,
    setIsImportDialogOpen,
    setLockManagementPath,
    setLogViewerPath,
    setMergePath,
    setModificationsPath,
    setMoveRenameTarget,
    setPendingUpdateEntry,
    setPropertiesPath,
    setRelocatePath,
    setResolveEntry,
    setRevisionGraphPath,
    setSettingsDialogOpen,
    setShelveDialogPath,
    setShowNotes,
    setShowPreview,
    setSwitchPath,
    setUpdateDialogOpen,
    settingsDialogOpen,
    shelveDialogPath,
    showNotes,
    showPreview,
    switchPath,
    updateDialogOpen,
  } = useFileExplorerDialogState();

  // Sidebar insight rows can target a dialog even when their working-copy path
  // is already the active route. Consume the transient route intent so the
  // same row remains actionable after the dialog is closed.
  useEffect(() => {
    if (dialog !== 'problems') return;
    setProblemsPath(path);
    void navigate({ to: '/files', search: { path }, replace: true });
  }, [dialog, navigate, path]);
  /* Editors on PATH, for the context menu's "Open in" section. */
  const codeEditors = useCodeEditors();
  const [deepStatusProgress, setDeepStatusProgress] = useState<DeepStatusProgress | null>(null);

  const openRepositoryBrowser = useCallback(
    async (localPath: string) => {
      const context = await window.api.svn.getWorkingCopyContext(localPath);
      navigate({
        to: '/repo-browser',
        search: {
          url: context?.url || context?.repositoryRoot || '',
          localPath,
        },
      });
    },
    [navigate]
  );
  const setRepoBrowserUrl = useCallback(
    (next: React.SetStateAction<string | null>) => {
      if (typeof next === 'string') void openRepositoryBrowser(next);
    },
    [openRepositoryBrowser]
  );

  const authPrompt = useFileExplorerAuthPrompt();

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showFilters, setShowFilters] = useState(true);

  // Column width state
  const [columnWidths, setColumnWidths] = useState({
    name: 300,
    status: 80,
    revision: 70,
    author: 100,
    date: 100,
    size: 80,
  });

  const handleColumnWidthChange = useCallback((column: string, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [column]: width }));
  }, []);

  // Dual-pane state
  const { isDualPane, toggleDualPane } = useDualPane(path || '');

  const {
    childCommits,
    deepStatusData,
    effectiveRepoRoot,
    effectiveUrl,
    error,
    isLoadingDeep,
    isLoadingFiles,
    isLoadingStatus,
    isVersioned,
    parentPath,
    rawFiles,
    refetch,
    statusData,
    svnInfo,
    workingCopyContext,
    workingCopyUpgradeStatus,
  } = useFileExplorerDirectoryData(path);

  useEffect(() => {
    setDeepStatusProgress(null);
    if (!path || path === 'DRIVES://') return;

    return window.api.fs.onDeepStatusProgress((progress) => {
      if (progress.path !== path) return;
      setDeepStatusProgress(progress);
    });
  }, [path]);

  const invalidateCurrentPath = useCallback(() => {
    invalidateWorkingCopyViews(queryClient, path);
  }, [path, queryClient]);

  const handleUpgradeWorkingCopy = useCallback(async () => {
    if (!path || path === 'DRIVES://') return;

    const confirmed = await confirmAppAction({
      type: 'warning',
      message:
        'Upgrade this working copy metadata? Older SVN clients may no longer be able to use it after the upgrade.',
      confirmLabel: 'Upgrade',
    });
    if (!confirmed) return;

    setIsUpgradingWorkingCopy(true);
    try {
      const result = await window.api.svn.upgradeWorkingCopy(path);
      if (result.success) {
        await showAppMessage({
          type: 'info',
          message: 'Working copy upgraded successfully.',
        });
        queryClient.invalidateQueries({ queryKey: ['svn:workingCopyUpgradeStatus', path] });
        queryClient.invalidateQueries({ queryKey: ['svn:info', path] });
        invalidateCurrentPath();
      } else {
        await showAppMessage({
          type: 'error',
          message: 'Working copy upgrade failed',
          detail: result.error || 'Unknown error',
        });
      }
    } finally {
      setIsUpgradingWorkingCopy(false);
    }
  }, [path, queryClient, invalidateCurrentPath]);

  /**
   * Local → Online.
   *
   * This route is about your disk. The server is the repository browser's
   * subject, and it is strictly the better tool for it — folder tree, peg
   * revisions, diff/blame/log/properties, presence marking, "Add to working
   * copy" — so choosing Online goes there rather than listing the server twice.
   *
   * The URL handed over is the one the old online mode would have listed: the
   * **repository root** behind this folder, which is an `svn info` fact
   * (`svnInfo.repositoryRoot`, or the working-copy context when the folder is
   * inside a checkout but is not itself its root). When neither has resolved
   * yet, ask `svn info` directly rather than assembling a URL from the path.
   * If Subversion has no answer, stay here and say so — a browser opened on a
   * guessed URL is worse than not opening.
   */
  const handleBrowseOnline = useCallback(async () => {
    let repositoryRoot = effectiveRepoRoot ?? '';
    let checkoutPath = svnInfo?.workingCopyRoot ?? workingCopyContext?.workingCopyRoot;

    if (!repositoryRoot && path && path !== 'DRIVES://') {
      const context = await window.api.svn.getWorkingCopyContext(path);
      repositoryRoot = context?.repositoryRoot || context?.url || '';
      checkoutPath = checkoutPath ?? context?.workingCopyRoot;
    }

    if (!repositoryRoot) {
      await showAppMessage({
        type: 'info',
        title: 'No repository to browse',
        message: 'This folder is not in a working copy, so there is no repository URL to open.',
        detail:
          'svn info reports no repository for this path. Open a checked-out folder, or open the repository browser and type the URL.',
      });
      return;
    }

    navigate({
      to: '/repo-browser',
      search: { url: repositoryRoot, localPath: checkoutPath ?? (isVersioned ? path : undefined) },
    });
  }, [
    effectiveRepoRoot,
    isVersioned,
    navigate,
    path,
    svnInfo?.workingCopyRoot,
    workingCopyContext?.workingCopyRoot,
  ]);

  const { data: storedCreds } = useQuery({
    queryKey: ['auth', effectiveRepoRoot],
    queryFn: async () => {
      if (!effectiveRepoRoot) return null;
      try {
        return await window.api.auth.resumeSession(effectiveRepoRoot);
      } catch {
        return null;
      }
    },
    enabled: !!effectiveRepoRoot,
    staleTime: FILE_CACHE_TIME,
  });
  const svnListAuthKey = getAuthPresenceKey(storedCreds);

  /*
   * The repository's own listing of this folder, so entries that exist on the
   * server but are not on disk here can be shown alongside the ones that are.
   * `svn list` is the only source for them — `svn status` cannot see a path it
   * never fetched — so they arrive with presence and no status.
   */
  const { data: notCheckedOutItems, isFetching: isLoadingNotCheckedOut } = useQuery({
    queryKey: createSvnListQueryKey('remote', effectiveUrl ?? '', svnListAuthKey),
    queryFn: async () => {
      if (!effectiveUrl) {
        return {
          data: { path: '', entries: [] },
          source: 'network' as const,
          cachedAt: Date.now(),
          age: 0,
        };
      }
      try {
        return await readCachedList(
          effectiveUrl,
          'HEAD',
          'immediates',
          storedCreds?.username ?? '',
          () => window.api.svn.list(effectiveUrl, 'HEAD', 'immediates', storedCreds?.id)
        );
      } catch (err) {
        const errorMsg = (err as Error)?.message || '';
        const category = (err as Error & { commandError?: { category?: string } }).commandError
          ?.category;
        if (
          category === 'authentication' ||
          errorMsg.includes('credentials') ||
          errorMsg.includes('Authentication') ||
          errorMsg.includes('E215004')
        ) {
          if (effectiveRepoRoot) {
            authPrompt.requestAuthentication(effectiveRepoRoot);
          }
        }
        throw err;
      }
    },
    enabled: !!effectiveUrl && !authPrompt.isOpen && showNotCheckedOut && isVersioned === true,
    staleTime: STATUS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const files = useMemo(() => {
    const notCheckedOutData =
      notCheckedOutItems?.data ?? (notCheckedOutItems as unknown as SvnListResult | undefined);

    let result = rawFiles || [];

    if (statusData) {
      result = result.map((file) => {
        const directStatus = statusData.directStatus[file.name];
        if (directStatus) {
          return {
            ...file,
            svnStatus: {
              path: file.path,
              status: directStatus.status,
              revision: directStatus.revision,
              author: directStatus.author,
              isDirectory: file.isDirectory,
            },
          };
        }
        return file;
      });
    }

    if (deepStatusData) {
      result = applyDeepStatus(result, deepStatusData);
    }

    /*
     * Folders excluded from this checkout. They are absent from disk but still
     * part of the working copy, and `svn info --depth immediates` reports them
     * offline — so unlike the server-side listing below, this needs no network
     * and no toggle. Without it, excluding a folder removes the only row that
     * could bring it back.
     */
    result = appendExcludedChildren(result, childCommits, path);

    /*
     * Entries the server has here and the disk does not. Presence, never
     * status: `svn status` has nothing to say about a path it never fetched,
     * so these carry only what `svn list` reported plus the URL they came from.
     */
    if (showNotCheckedOut && notCheckedOutData?.entries && svnInfo?.url) {
      const onDiskNames = new Set(result.map((f) => f.name));
      const notOnDiskItems = notCheckedOutData.entries
        .filter((entry) => !onDiskNames.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          path: path ? `${path}${path.includes('\\') ? '\\' : '/'}${entry.name}` : entry.name,
          isDirectory: entry.kind === 'dir',
          size: entry.size || 0,
          modifiedTime: entry.date || '',
          svnStatus: {
            path: path ? `${path}${path.includes('\\') ? '\\' : '/'}${entry.name}` : entry.name,
            remoteUrl: entry.url,
            status: 'O' as SvnStatusChar,
            revision: entry.revision,
            author: entry.author,
            isDirectory: entry.kind === 'dir',
          },
        }));
      result = [...result, ...notOnDiskItems];
    }

    return result;
  }, [
    rawFiles,
    statusData,
    deepStatusData,
    childCommits,
    path,
    showNotCheckedOut,
    notCheckedOutItems,
    svnInfo?.url,
  ]);

  // Convert to entries for virtualizer
  // Base directory for Miller columns: the working-copy root (or home) when the
  // current path is inside it, so we don't render empty unapproved /…/ columns.
  const millerBase = useMemo(() => {
    const isUnder = (root?: string) => {
      if (!root) return false;
      const base = root.replace(/[\\/]+$/, '');
      return path === root || path.startsWith(base + '/') || path.startsWith(base + '\\');
    };
    const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot;
    if (isUnder(wcRoot)) return wcRoot ?? null;
    // Fall back to the recent repository that contains the current path, so the
    // columns start at the repo root rather than walking up from home.
    const repo = (settings?.recentRepositories || []).find(isUnder);
    if (repo) return repo;
    if (isUnder(homePath)) return homePath;
    return null;
  }, [
    path,
    svnInfo?.workingCopyRoot,
    workingCopyContext?.workingCopyRoot,
    settings?.recentRepositories,
    homePath,
  ]);

  // The folder tree is rooted at the same place the Miller columns start from —
  // the working-copy root when we are inside one — falling back to the folder on
  // screen so the pane is never rootless.
  const treeRootPath = useMemo(() => {
    if (!path || path === 'DRIVES://') return '';
    return millerBase ?? path;
  }, [millerBase, path]);

  const treePane = useWorkingCopyTreePane();
  const showTreePane = !treePane.collapsed && treeRootPath !== '';

  const handleTreeResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        treePane.nudgeWidth(-treePane.keyboardStep);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        treePane.nudgeWidth(treePane.keyboardStep);
      }
    },
    [treePane]
  );

  const folderChangeCounts = useMemo(
    () => (deepStatusData ? buildFolderChangeCounts(files || [], deepStatusData) : null),
    [files, deepStatusData]
  );

  const entries = useMemo(() => {
    let list = (files || []).map(fileInfoToEntry);

    // Merge last-commit info (revision/author/date) for clean items.
    if (childCommits) {
      list = list.map((entry) => {
        const name = entry.path.split(/[\\/]/).filter(Boolean).pop() || '';
        const commit = childCommits[name];
        if (!commit) return entry;
        return {
          ...entry,
          revision: entry.revision ?? commit.revision,
          author: entry.author || commit.author,
          date: entry.date || commit.date,
        };
      });
    }

    // Attach recursive change-count rollups to folders.
    if (folderChangeCounts && folderChangeCounts.size > 0) {
      list = list.map((entry) => {
        if (!entry.isDirectory) return entry;
        const key = entry.path.replace(/\\/g, '/').replace(/\/+$/, '');
        const count = folderChangeCounts.get(key);
        return count ? { ...entry, childChangeCount: count } : entry;
      });
    }

    return list;
  }, [files, childCommits, folderChangeCounts]);

  // Calculate folder sizes when enabled
  const { folderSizes } = useFolderSizes(entries, settings.showFolderSizes);

  // Use filter hook for type/status filtering
  const {
    filteredEntries: typeFilteredEntries,
    fileTypeFilter,
    setFileTypeFilter,
    statusFilter,
    setStatusFilter,
    hasActiveFilters,
  } = useFileFilters(entries);

  const ignoreRegexes = useMemo(
    () => compileIgnorePatterns(settings?.globalIgnorePatterns ?? []),
    [settings?.globalIgnorePatterns]
  );

  // Apply search and sorting
  const filteredEntries = useMemo(() => {
    return filterAndSortEntries({
      entries: typeFilteredEntries,
      searchQuery: deferredSearchQuery,
      ignoreRegexes,
      sortColumn,
      sortDirection,
    });
  }, [typeFilteredEntries, deferredSearchQuery, ignoreRegexes, sortColumn, sortDirection]);

  // Sort handler
  const handleSort = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(column);
        setSortDirection('asc');
      }
    },
    [sortColumn]
  );

  const {
    selectedPaths,
    focusedIndex,
    setSelectedPaths,
    setFocusedIndex,
    clearSelection,
    handleSelect,
    selectedEntryFallback,
  } = useFileExplorerSelection(filteredEntries);

  const filteredEntryByPath = useMemo(() => {
    const map = new Map<string, SvnStatusEntry>();
    for (const entry of filteredEntries) {
      map.set(entry.path, entry);
    }
    return map;
  }, [filteredEntries]);

  // SVN Actions - get first selected entry for single-file actions
  const selectedEntry = useMemo(() => {
    const firstSelected = Array.from(selectedPaths)[0];
    if (!firstSelected) return null;
    return (
      filteredEntryByPath.get(firstSelected) ||
      (selectedEntryFallback?.path === firstSelected ? selectedEntryFallback : null)
    );
  }, [selectedPaths, filteredEntryByPath, selectedEntryFallback]);

  const actions = useFileExplorerActions(
    path || '',
    selectedEntry,
    invalidateCurrentPath,
    selectedPaths
  );
  const operationContextRef = useRef({ actions, path, queryClient, selectedEntry });

  useEffect(() => {
    operationContextRef.current = { actions, path, queryClient, selectedEntry };
  }, [actions, path, queryClient, selectedEntry]);

  useFileExplorerCommandEvents({
    operationContextRef,
    setApplyPatchPath,
    setBlamePath,
    setBranchTagCompareOpen,
    setBranchTagMode,
    setBranchTagPath,
    setChangelistPath,
    setCreatePatchPath,
    setExportPath,
    setImportDialogOpen: setIsImportDialogOpen,
    setLockManagementPath,
    setMergePath,
    setMoveRenameTarget,
    setPropertiesPath,
    setRelocatePath,
    setRepoBrowserUrl,
    setResolveEntry,
    setRevisionGraphPath,
    setShelveDialogPath,
    setSwitchPath,
  });

  // Virtualizer — row height matches the prototype's `.crow` (38px, 30px compact)
  const rowHeight = settings.compactFileRows ? FILE_ROW_HEIGHT_COMPACT : FILE_ROW_HEIGHT;
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => filteredEntries[index]?.path ?? index,
    overscan: 15,
  });

  const handleNavigate = useCallback(
    (newPath: string) => {
      navigate({ to: '/files', search: { path: newPath } });
    },
    [navigate]
  );

  const handleNavigateToEntry = useCallback(
    (entry: SvnStatusEntry) => {
      if (entry.isDirectory) {
        navigate({ to: '/files', search: { path: entry.path } });
      }
    },
    [navigate]
  );

  useFileExplorerKeyboardNavigation({
    entries: filteredEntries,
    selectedPaths,
    focusedIndex,
    virtualizer,
    disabled: !!diffViewerPath || !!logViewerPath || actions.commitDialogOpen,
    onNavigateToEntry: handleNavigateToEntry,
    setSelectedPaths,
    setFocusedIndex,
  });

  // Clear selection when path changes
  useEffect(() => {
    clearSelection();
  }, [path, clearSelection]);

  // FileRow actions - works with multi-select
  const fileRowActions = useMemo(
    () => ({
      onUpdate: async () => {
        if (selectedEntry) await actions.handleUpdate();
      },
      onDownload: (entry: SvnStatusEntry) => {
        setPendingUpdateEntry(entry);
        setUpdateDialogOpen(true);
      },
      onCommit: () => {
        // Commit all selected paths
        const paths = Array.from(selectedPaths);
        if (paths.length > 0) {
          // Open commit dialog with all selected paths
          // For now, use single selection
          actions.handleCommitSelected();
        }
      },
      onRevert: async () => {
        // Revert all selected
        const paths = Array.from(selectedPaths);
        if (paths.length > 0) {
          // Actions now supports batch operations
          await actions.handleRevertSelected();
        }
      },
      onUnversion: async (entry: SvnStatusEntry) => {
        const name = entry.path.split(/[/\\]/).pop() || entry.path;
        const confirmed = await confirmAppAction({
          type: 'warning',
          title: 'Unversion item',
          message: `Undo the pending add for "${name}"?`,
          detail: 'The files stay on disk and become unversioned again — nothing is deleted.',
          confirmLabel: 'Unversion',
        });
        if (!confirmed) return;
        await window.api.svn.unversion([entry.path]);
        invalidateCurrentPath();
        queryClient.invalidateQueries({ queryKey: ['svn:list'] });
      },
      onExclude: async (entry: SvnStatusEntry) => {
        // A right-click inside a multi-selection removes the whole selection,
        // the way Commit and Revert already behave.
        const targets =
          selectedPaths.size > 1 && selectedPaths.has(entry.path)
            ? Array.from(selectedPaths)
            : [entry.path];
        const name = entry.path.split(/[/\\]/).pop() || entry.path;
        const subject = targets.length > 1 ? `${targets.length} items` : `"${name}"`;
        const confirmed = await confirmAppAction({
          type: 'warning',
          title: targets.length > 1 ? 'Remove items locally' : 'Remove locally',
          message: `Remove ${subject} from this working copy?`,
          detail:
            'The repository is not changed, and SVN stops reporting them as missing. They can be brought back with "Add to working copy…". Any unversioned or ignored files left inside are moved to the OS trash — those cannot be brought back from SVN.',
          confirmLabel: 'Remove locally',
        });
        if (!confirmed) return;

        const result = await window.api.svn.exclude(targets);
        if (!result.success) {
          await showAppMessage({
            type: 'error',
            title: 'Remove locally failed',
            message: `Could not remove ${subject} from the working copy.`,
            detail: result.error || 'Unknown SVN error',
          });
          return;
        }
        clearSelection();
        // Leaving the removed folder behind would show an empty column, so step
        // out to its parent. A removed file leaves the listing standing.
        if (entry.isDirectory && targets.length === 1) {
          const exclusionParentPath = await window.api.fs.getParent(entry.path);
          if (exclusionParentPath) {
            handleNavigate(exclusionParentPath);
          }
        }
        invalidateCurrentPath();
        queryClient.invalidateQueries({ queryKey: ['svn:list'] });
        queryClient.invalidateQueries({ queryKey: ['fs:listDirectory'] });
        // Re-read which children are excluded, so what was just removed comes
        // back as a "Not checked out" row instead of vanishing from the view.
        queryClient.invalidateQueries({ queryKey: ['svn:childCommits'] });
      },
      onAdd: async () => {
        if (selectedEntry) await actions.handleAddSelected();
      },
      onDelete: async () => {
        if (selectedEntry) await actions.handleDeleteSelected();
      },
      onMove: (entry: SvnStatusEntry) => {
        setMoveRenameTarget({ path: entry.path, mode: 'move' });
      },
      onCopy: async (entry: SvnStatusEntry) => {
        const destination = await promptAppInput({
          title: 'Copy item',
          message: 'Destination path:',
          confirmLabel: 'Copy',
        });
        if (!destination) return;
        const result = await window.api.svn.copyLocal(entry.path, destination);
        if (result.success) {
          invalidateCurrentPath();
        }
      },
      onRename: (entry: SvnStatusEntry) => {
        setMoveRenameTarget({ path: entry.path, mode: 'rename' });
      },
      onShowLog: (entry: SvnStatusEntry) => setLogViewerPath(entry.path),
      onDiff: (entry: SvnStatusEntry) => setDiffViewerPath(entry.path),
      onOpenInExplorer: (entry: SvnStatusEntry) => {
        void window.api.external.revealPath(entry.path);
      },
      editors: codeEditors,
      onConfigureOpenWith: () => setSettingsDialogOpen(true),
      onOpenInEditor: async (entry: SvnStatusEntry, editorId: string) => {
        const result = await window.api.external.openInEditor(editorId, entry.path);
        if (!result?.success) {
          await showAppMessage({
            type: 'error',
            title: 'Could not open the editor',
            message: `${codeEditors.find((editor) => editor.id === editorId)?.label ?? editorId} did not start.`,
            detail: result?.error || 'Unknown error',
          });
        }
      },
      onCopyPath: (entry: SvnStatusEntry) => {
        const paths = selectedPaths.size > 1 ? Array.from(selectedPaths).join('\n') : entry.path;
        navigator.clipboard.writeText(paths);
      },
      onPreview: (entry: SvnStatusEntry) => {
        if (!entry.isDirectory) {
          setShowPreview(true);
        }
      },
      // Context menu dialog actions
      onBranchTag: (entry: SvnStatusEntry) => {
        setBranchTagPath(entry.path);
        setBranchTagMode('branch');
      },
      onTag: (entry: SvnStatusEntry) => {
        setBranchTagPath(entry.path);
        setBranchTagMode('tag');
      },
      onSwitch: (entry: SvnStatusEntry) => setSwitchPath(entry.path),
      onMerge: (entry: SvnStatusEntry) => setMergePath(entry.path),
      onRelocate: (entry: SvnStatusEntry) => setRelocatePath(entry.path),
      onBlame: (entry: SvnStatusEntry) => setBlamePath(entry.path),
      onProperties: (entry: SvnStatusEntry) => setPropertiesPath(entry.path),
      onChangelist: (entry: SvnStatusEntry) => setChangelistPath(entry.path),
      onCreatePatch: (entry: SvnStatusEntry) => setCreatePatchPath(entry.path),
      onApplyPatch: (entry: SvnStatusEntry) => setApplyPatchPath(entry.path),
      onAddToIgnore: (entry: SvnStatusEntry) => {
        const fileName = entry.path.split(/[/\\]/).pop();
        setIgnoreEntry({ path: entry.path, fileName });
      },
      onShelve: svnCapabilities?.shelving
        ? (entry: SvnStatusEntry) => {
            if (entry.isDirectory) setShelveDialogPath(entry.path);
          }
        : undefined,
      // Direct lock/unlock actions
      onGetLock: async (entry: SvnStatusEntry) => {
        if (!entry.isDirectory) {
          const message = await promptAppInput({
            title: 'Lock file',
            message: 'Lock message (optional):',
            confirmLabel: 'Lock',
          });
          if (message === null) {
            return;
          }
          const result = await actions.lock(entry.path, message || undefined);
          if (result.success) {
            invalidateWorkingCopyViews(queryClient, path, {
              includeParents: false,
              scope: 'status',
            });
          } else {
            await showAppMessage({
              type: 'error',
              message: 'Lock failed',
              detail: result.message || 'Unknown error',
            });
          }
        }
      },
      onReleaseLock: async (entry: SvnStatusEntry) => {
        if (!entry.isDirectory) {
          const result = await actions.unlock(entry.path);
          if (result.success) {
            invalidateWorkingCopyViews(queryClient, path, {
              includeParents: false,
              scope: 'status',
            });
          } else {
            await showAppMessage({
              type: 'error',
              message: 'Unlock failed',
              detail: result.message || 'Unknown error',
            });
          }
        }
      },
      onManageLocks: (entry: SvnStatusEntry) => setLockManagementPath(entry.path),
      onExport: (entry: SvnStatusEntry) => setExportPath(entry.path),
      onImport: () => setIsImportDialogOpen(true),
      onRepoBrowser: async (entry: SvnStatusEntry) => {
        await openRepositoryBrowser(entry.path);
      },
      onRevisionGraph: (entry: SvnStatusEntry) => setRevisionGraphPath(entry.path),
      // Resolve - only for conflicted files
      onResolve: (entry: SvnStatusEntry) => {
        if (entry.status === 'C') {
          setResolveEntry(entry);
        }
      },
      // Cleanup - for directories with working copy issues
      onCleanup: async (entry: SvnStatusEntry) => {
        if (
          entry.isDirectory &&
          (await confirmAppAction({
            type: 'warning',
            message: `Run cleanup on "${entry.path}"?`,
            confirmLabel: 'Cleanup',
          }))
        ) {
          const result = await actions.cleanup(entry.path);
          if (result.success) {
            await showAppMessage({
              type: 'info',
              message: 'Cleanup completed successfully.',
            });
            invalidateWorkingCopyViews(queryClient, path, {
              includeParents: false,
              scope: 'status',
            });
          } else {
            await showAppMessage({
              type: 'error',
              message: 'Cleanup failed',
              detail: result.message || 'Unknown error',
            });
          }
        }
      },
      onCheckForModifications: (entry: SvnStatusEntry) => setModificationsPath(entry.path),
    }),
    [
      codeEditors,
      selectedEntry,
      selectedPaths,
      actions,
      path,
      openRepositoryBrowser,
      queryClient,
      invalidateCurrentPath,
      clearSelection,
      handleNavigate,
      setBranchTagPath,
      setBranchTagMode,
      setDiffViewerPath,
      setIsImportDialogOpen,
      setLogViewerPath,
      setSwitchPath,
      setMergePath,
      setModificationsPath,
      setSettingsDialogOpen,
      setMoveRenameTarget,
      setPendingUpdateEntry,
      setRelocatePath,
      setBlamePath,
      setPropertiesPath,
      setShowPreview,
      setUpdateDialogOpen,
      setChangelistPath,
      setCreatePatchPath,
      setApplyPatchPath,
      setIgnoreEntry,
      setShelveDialogPath,
      setLockManagementPath,
      setExportPath,
      setRevisionGraphPath,
      setResolveEntry,
      svnCapabilities?.shelving,
    ]
  );

  const handleUpdateToRevision = useCallback(
    async (depth: 'empty' | 'files' | 'immediates' | 'infinity', setDepthSticky: boolean) => {
      if (!pendingUpdateEntry) {
        return { success: false, revision: null, error: 'No entry selected' };
      }

      const entry = pendingUpdateEntry;
      const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot || path;
      /* Not on disk: there is nothing here to `svn update`, so the fetch has to
         be aimed at the repository URL and the local path it will fill. */
      if (isNotOnDisk(entry) && effectiveRepoRoot) {
        const target = resolveRemoteUpdateTarget({
          entry,
          repositoryRoot: effectiveRepoRoot,
          workingCopyUrl: effectiveUrl,
          workingCopyRoot: wcRoot,
          currentPath: path,
        });
        /* Miller columns can show a not-fetched folder from a column above the
           current one, where anchoring on this folder's URL cannot reach it. Its
           row already knows the local path it stands for, so use that. */
        const localPath =
          target.localPath ?? (isInsideWorkingCopy(entry.path, wcRoot) ? entry.path : null);
        if (!localPath) {
          return {
            success: false as const,
            revision: null,
            error:
              'The selected repository item is outside this working-copy subtree. Open its matching switched path or external before updating it.',
          };
        }

        try {
          const result = await window.api.svn.updateToRevision(
            wcRoot,
            target.repoUrl,
            localPath,
            depth,
            setDepthSticky
          );
          if (result.success) {
            invalidateCurrentPath();
            queryClient.invalidateQueries({ queryKey: ['svn:list'] });
          }
          return result;
        } catch (err) {
          return {
            success: false as const,
            revision: null,
            error: (err as Error).message || 'Update failed',
          };
        }
      } else {
        try {
          const result = await window.api.svn.updateItem(entry.path);
          if (result.success) {
            invalidateCurrentPath();
            queryClient.invalidateQueries({ queryKey: ['svn:list'] });
          }
          return result;
        } catch (err) {
          return {
            success: false as const,
            revision: null,
            error: (err as Error).message || 'Update failed',
          };
        }
      }
    },
    [
      pendingUpdateEntry,
      svnInfo?.workingCopyRoot,
      workingCopyContext?.workingCopyRoot,
      path,
      effectiveRepoRoot,
      effectiveUrl,
      queryClient,
      invalidateCurrentPath,
    ]
  );

  /**
   * Fetch repository URLs chosen from the tree in the update dialog. The dialog
   * only has URLs; mapping each one onto the local path it fills needs the open
   * folder and its URL, which live here.
   */
  const handleUpdateRepoUrls = useCallback(
    async (
      repoUrls: string[],
      depth: 'empty' | 'files' | 'immediates' | 'infinity',
      setDepthSticky: boolean
    ) => {
      const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot || path;
      if (!effectiveRepoRoot || !effectiveUrl) {
        return { success: false as const, revision: null, error: 'This folder has no SVN URL.' };
      }

      const targets = repoUrls.map((url) => ({
        url,
        localPath: resolveRemoteUrlToLocalPath(url, path, effectiveRepoRoot, effectiveUrl),
      }));
      const unreachable = targets.filter((target) => !target.localPath);
      if (unreachable.length > 0) {
        return {
          success: false as const,
          revision: null,
          error: `Outside this working-copy subtree: ${unreachable
            .map((target) => target.url)
            .join(', ')}`,
        };
      }

      let revision: SvnOperationRevision = null;
      for (const target of targets) {
        try {
          const result = await window.api.svn.updateToRevision(
            wcRoot,
            target.url,
            target.localPath!,
            depth,
            setDepthSticky
          );
          if (!result.success) {
            return { success: false as const, revision: null, error: result.error };
          }
          revision = result.revision ?? revision;
        } catch (err) {
          return {
            success: false as const,
            revision: null,
            error: (err as Error).message || 'Update failed',
          };
        }
      }

      invalidateCurrentPath();
      queryClient.invalidateQueries({ queryKey: ['svn:list'] });
      return { success: true as const, revision };
    },
    [
      svnInfo?.workingCopyRoot,
      workingCopyContext?.workingCopyRoot,
      path,
      effectiveRepoRoot,
      effectiveUrl,
      queryClient,
      invalidateCurrentPath,
    ]
  );

  /**
   * The selected entry when it is a directory the repository has and this disk
   * does not — presence `none`, no status. The repository browser offers
   * "Add to working copy" for exactly this case, so this view offers it too,
   * for the same reason and through the same call: fill the subtree in inside
   * the checkout you already have rather than making a second one.
   *
   * `null` when nothing resolves — the local path a repository URL would fill
   * is a fact about this working copy's layout (switched subtrees, externals),
   * so it is resolved, never assembled from the name.
   */
  const addToWorkingCopyTarget = useMemo(() => {
    if (!selectedEntry || !isNotOnDisk(selectedEntry) || !selectedEntry.isDirectory) return null;
    const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot;
    if (!wcRoot || !effectiveRepoRoot) return null;

    const target = resolveRemoteUpdateTarget({
      entry: selectedEntry,
      repositoryRoot: effectiveRepoRoot,
      workingCopyUrl: effectiveUrl,
      workingCopyRoot: wcRoot,
      currentPath: path,
    });
    if (!target.localPath) return null;

    return {
      name: selectedEntry.path.split(/[/\\]/).pop() || selectedEntry.path,
      wcRoot,
      url: target.repoUrl,
      localPath: target.localPath,
    };
  }, [
    selectedEntry,
    svnInfo?.workingCopyRoot,
    workingCopyContext?.workingCopyRoot,
    effectiveRepoRoot,
    effectiveUrl,
    path,
  ]);

  const handleAddToWorkingCopy = useCallback(async () => {
    if (!addToWorkingCopyTarget) return;
    const { name, wcRoot, url, localPath } = addToWorkingCopyTarget;

    const confirmed = await confirmAppAction({
      title: 'Add to working copy',
      message: `"${name}" is in the repository but not on your disk. Fetch it into the checkout you already have?`,
      detail: [
        `From  ${url}`,
        `Onto  ${localPath}`,
        '',
        `svn update --set-depth infinity "${localPath}"`,
        '',
        'This does not create a second working copy, and nothing already on disk is reverted or overwritten. The depth is set permanently, so later updates keep this subtree.',
      ].join('\n'),
      confirmLabel: 'Add to working copy',
    });
    if (!confirmed) return;

    setIsAddingToWorkingCopy(true);
    try {
      const result = await window.api.svn.updateToRevision(
        wcRoot,
        url,
        localPath,
        'infinity',
        true
      );
      if (!result?.success) {
        await showAppMessage({
          type: 'error',
          title: 'Add to working copy failed',
          message: `"${name}" was not added to this working copy.`,
          detail: result?.error || 'Subversion did not report why the update failed.',
        });
        return;
      }
      // The subtree is on disk now, so the listing, its status and its presence
      // are all stale.
      clearSelection();
      invalidateCurrentPath();
      queryClient.invalidateQueries({ queryKey: ['svn:list'] });
    } catch (err) {
      await showAppMessage({
        type: 'error',
        title: 'Add to working copy failed',
        message: `"${name}" was not added to this working copy.`,
        detail: (err as Error)?.message || String(err),
      });
    } finally {
      setIsAddingToWorkingCopy(false);
    }
  }, [addToWorkingCopyTarget, clearSelection, invalidateCurrentPath, queryClient]);

  const handleFileDrop = useCallback(
    async (sources: string[], target: string, operation: DragDropOperation) => {
      const success = await performSvnOperation(sources, target, operation);
      if (success) {
        invalidateCurrentPath();
      }
    },
    [invalidateCurrentPath]
  );

  const hasChanges = entries.some((e) => ['M', 'A', 'D', 'C'].includes(e.status));

  /*
   * Scale honesty in the footer: say when the list on screen is not the whole
   * directory, and say which of the two reasons it is — the user narrowed it,
   * or the listing itself was capped.
   */
  const listingIsNarrowed = filteredEntries.length < entries.length;
  const listingIsFiltered =
    listingIsNarrowed && (hasActiveFilters || deferredSearchQuery.length > 0);
  const listingIsTruncated = listingIsNarrowed && !listingIsFiltered;

  useEffect(() => {
    if (hasChanges) {
      void loadCommitDialog();
    }
  }, [hasChanges]);

  useEffect(() => {
    return runWhenIdle(() => {
      void loadCommitDialog();
    });
  }, []);

  const isLoading = isLoadingFiles;
  const isFetching =
    isLoadingStatus || isLoadingDeep || isLoadingNotCheckedOut || actions.isUpdating;
  const deepStatusMessage = useMemo(() => {
    if (!isLoadingDeep && deepStatusProgress?.phase !== 'complete') return null;
    if (!deepStatusProgress) return isLoadingDeep ? 'Calculating folder status...' : null;

    switch (deepStatusProgress.phase) {
      case 'queued':
        return 'Folder status scan queued...';
      case 'running':
        return `Calculating folder status... ${Math.max(1, Math.round(deepStatusProgress.elapsedMs / 1000))}s`;
      case 'complete':
        return deepStatusProgress.filesFound !== undefined
          ? `Folder status indexed ${deepStatusProgress.filesFound} changes`
          : null;
      case 'cancelled':
        return null;
      case 'error':
        return 'Folder status scan failed';
    }
  }, [deepStatusProgress, isLoadingDeep]);

  // Empty state - show when no path is set
  if (!path) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
          <FolderX className="w-8 h-8 text-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-text mb-2">Select a Location</h3>
        <p className="text-sm text-text-secondary max-w-sm">
          Choose a folder from the sidebar to browse files
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-[--toolbar-height] flex-none animate-pulse border-b border-border bg-bg" />
        <RouteState
          variant="loading"
          title="Loading Directory"
          description="Fetching files and SVN status."
          className="flex-1"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-[--toolbar-height] flex-none border-b border-border bg-bg" />
        <RouteState
          variant="error"
          title="Error Loading Directory"
          description={(error as Error).message}
          action={{ label: 'Retry', onClick: () => refetch() }}
          className="flex-1"
        />
      </div>
    );
  }

  /*
   * The address field the single bar wraps around. This view addresses a disk,
   * so it is always a path: crumbs plus the branch chip in the slot the
   * prototype gives `@HEAD`. Repository URLs are addressed in the repository
   * browser, which has its own URL field.
   */
  const addressBar = (
    <PathAddressBar
      path={path}
      onNavigate={handleNavigate}
      homePath={homePath}
      trailing={
        <BranchSwitcher
          url={effectiveUrl}
          localPath={path}
          onSwitched={() => {
            invalidateCurrentPath();
            queryClient.invalidateQueries({ queryKey: ['svn:info', path] });
          }}
          onCreateBranch={() => window.dispatchEvent(new CustomEvent(SVN_EVENTS.BRANCH_TAG))}
          onCreateTag={() => window.dispatchEvent(new CustomEvent(SVN_EVENTS.TAG))}
        />
      }
    />
  );

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Folder tree — the working copy's directory hierarchy, lazily listed */}
      {showTreePane && (
        <>
          <aside
            aria-label="Working copy folders"
            style={{ width: treePane.width }}
            className="flex-none flex flex-col min-h-0 overflow-hidden bg-bg-secondary border-r border-border"
          >
            <Suspense fallback={<WorkingCopyTreeFallback />}>
              <WorkingCopyTree
                rootPath={treeRootPath}
                currentPath={path}
                deepStatus={deepStatusData}
                shallowStatus={statusData}
                workingCopyRoot={svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot}
                actions={fileRowActions}
                onNavigate={handleNavigate}
              />
            </Suspense>
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize folder tree"
            aria-valuenow={treePane.width}
            aria-valuemin={TREE_PANE_MIN_WIDTH}
            aria-valuemax={TREE_PANE_MAX_WIDTH}
            tabIndex={0}
            onMouseDown={treePane.beginResize}
            onKeyDown={handleTreeResizeKeyDown}
            className="w-1 flex-none cursor-col-resize transition-fast hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none active:bg-accent"
          />
        </>
      )}

      {/* Main content area — `relative` so the selection bar can float over the
          list instead of pushing it down (see the selection bar below). */}
      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
        {/*
         * One bar. Navigation, the address, the SVN actions and the view
         * controls sit together in the prototype's single `.navbar`, in the
         * same idiom the repository browser's `RepoNavBar` already uses.
         */}
        <Toolbar
          addressBar={addressBar}
          onNavigateUp={parentPath ? () => handleNavigate(parentPath) : undefined}
          onToggleTree={treeRootPath !== '' ? treePane.toggleCollapsed : undefined}
          isTreeCollapsed={treePane.collapsed}
          explorerViewMode={explorerViewMode}
          onExplorerViewModeChange={(mode) => void updateSettings({ explorerViewMode: mode })}
          onRefresh={() => {
            invalidateCurrentPath();
            queryClient.invalidateQueries({ queryKey: ['fs:isVersioned', path] });
            queryClient.invalidateQueries({ queryKey: ['svn:workingCopyUpgradeStatus', path] });
          }}
          onUpdate={actions.handleUpdate}
          onCommit={actions.handleCommit}
          onRevert={actions.handleRevertSelected}
          onAdd={actions.handleAddSelected}
          onDelete={actions.handleDeleteSelected}
          onCleanup={() => {
            const targetPath = selectedEntry?.path || path;
            if (targetPath) void actions.cleanup(targetPath);
          }}
          onResolve={() => {
            if (selectedEntry?.status === 'C') setResolveEntry(selectedEntry);
          }}
          onMove={() => {
            if (selectedEntry) setMoveRenameTarget({ path: selectedEntry.path, mode: 'move' });
          }}
          onCopy={async () => {
            if (!selectedEntry) return;
            const destination = await promptAppInput({
              title: 'Copy item',
              message: 'Destination path:',
              confirmLabel: 'Copy',
            });
            if (!destination) return;
            const result = await window.api.svn.copyLocal(selectedEntry.path, destination);
            if (result.success) {
              invalidateCurrentPath();
            }
          }}
          onRename={() => {
            if (selectedEntry) setMoveRenameTarget({ path: selectedEntry.path, mode: 'rename' });
          }}
          isUpdating={isFetching}
          hasChanges={hasChanges}
          hasSelection={selectedPaths.size > 0}
          isVersioned={isVersioned === true}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((prev) => !prev)}
          hasActiveFilters={hasActiveFilters}
          isDualPane={isDualPane}
          onToggleDualPane={toggleDualPane}
          showPreview={showPreview}
          onTogglePreview={() => setShowPreview((prev) => !prev)}
          hasSelectionForPreview={selectedEntry !== null && !selectedEntry.isDirectory}
          isBookmarked={isBookmarked}
          onToggleBookmark={handleToggleBookmark}
          onCommitPreload={() => void loadCommitDialog()}
          onSettings={() => setSettingsDialogOpen(true)}
          onDiagnostics={() => setDiagnosticsOpen(true)}
          onBrowseOnline={() => void handleBrowseOnline()}
          canBrowseOnline={!!effectiveUrl}
          showNotCheckedOut={showNotCheckedOut}
          onToggleNotCheckedOut={() => setShowNotCheckedOut((prev) => !prev)}
          onShowNotes={() => setShowNotes(true)}
        />

        {actions.operationProgress && (
          <div className="border-b border-border bg-bg-secondary px-4 py-2">
            <ProgressIndicator
              compact
              status={actions.operationProgress.status}
              currentItem={actions.operationProgress.currentFile}
              itemsCompleted={actions.operationProgress.filesProcessed}
              error={actions.operationProgress.error}
              operationType={
                actions.operationProgress.operation === 'commit' ? 'upload' : 'download'
              }
              canCancel={actions.operationProgress.status === 'running'}
              onCancel={() => void actions.cancelActiveOperation()}
              onClose={actions.dismissOperationProgress}
              indeterminate
            />
          </div>
        )}

        {workingCopyUpgradeStatus?.required && (
          <div className="flex items-center gap-3 px-4 py-3 bg-warning/10 border-b border-warning/30">
            <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text">Working copy upgrade required</div>
              <div className="text-xs text-text-secondary truncate">
                {workingCopyUpgradeStatus.reason ||
                  'Upgrade this working copy before running SVN operations.'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleUpgradeWorkingCopy}
              className="btn btn-primary"
              disabled={isUpgradingWorkingCopy}
            >
              {isUpgradingWorkingCopy && <Loader className="w-4 h-4 animate-spin" />}
              Upgrade
            </button>
          </div>
        )}

        {explorerViewMode === 'miller' && (
          <div className="relative flex-1 min-h-0 min-w-0">
            <MillerColumns
              path={path}
              baseRoot={millerBase}
              selectedPath={selectedEntry?.path}
              onNavigate={handleNavigate}
              onSelect={handleSelect}
              actions={fileRowActions}
              workingCopyRoot={svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot}
            />
          </div>
        )}

        {/* Filter Bar */}
        {explorerViewMode !== 'miller' && showFilters && (
          <FilterBar
            activeFileType={fileTypeFilter}
            activeStatus={statusFilter}
            onFileTypeChange={setFileTypeFilter}
            onStatusChange={setStatusFilter}
            fileCount={{ total: entries.length, filtered: filteredEntries.length }}
          />
        )}

        {/*
         * Selection bar. Floated over the bottom of the list rather than
         * inserted above it: as a block in the column it appeared the moment a
         * row was picked and pushed every row down by its own height, so the
         * second click of a double-click landed on the wrong folder. Overlaid,
         * nothing under the pointer moves.
         */}
        {explorerViewMode !== 'miller' && selectedPaths.size > 0 && (
          <div
            role="region"
            aria-label="Selection actions"
            className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4"
          >
            <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-border bg-bg-elevated/95 px-3 py-1.5 shadow-panel backdrop-blur">
              <b className="whitespace-nowrap px-1 text-xs text-text-secondary" aria-live="polite">
                <span className="text-accent">{selectedPaths.size}</span> selected
              </b>
              <span className="h-4 w-px flex-none bg-border" aria-hidden="true" />
              {/*
               * Not on disk: the only thing to offer is bringing it in, and it is
               * the same offer, wording and command the repository browser makes.
               */}
              {addToWorkingCopyTarget && (
                <button
                  type="button"
                  className={SELECTION_BUTTON}
                  title={`Fetch this directory into the checkout you already have — svn update --set-depth infinity "${addToWorkingCopyTarget.localPath}"`}
                  onClick={() => void handleAddToWorkingCopy()}
                  disabled={isAddingToWorkingCopy}
                  aria-busy={isAddingToWorkingCopy}
                >
                  <FolderDown className="h-3.5 w-3.5" aria-hidden="true" />
                  {isAddingToWorkingCopy ? 'Adding…' : 'Add to working copy'}
                </button>
              )}
              {isVersioned === true && (
                <>
                  <button
                    type="button"
                    className={SELECTION_BUTTON}
                    title="Commit the selected items — svn commit"
                    onClick={() => void actions.handleCommitSelected()}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Commit
                  </button>
                  <button
                    type="button"
                    className={SELECTION_BUTTON}
                    title="Discard local changes to the selected items — svn revert"
                    onClick={() => void actions.handleRevertSelected()}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Revert
                  </button>
                </>
              )}
              <button
                type="button"
                className={SELECTION_BUTTON}
                title="Copy the selected paths to the clipboard"
                onClick={() => {
                  void navigator.clipboard.writeText(Array.from(selectedPaths).join('\n'));
                }}
              >
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy paths
              </button>
              <button
                type="button"
                className={SELECTION_BUTTON}
                title="Clear the selection — Esc"
                onClick={clearSelection}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>
        )}

        {/* File List Header */}
        {explorerViewMode !== 'miller' && (
          <FileListHeader
            columnWidths={columnWidths}
            onColumnWidthChange={handleColumnWidthChange}
            onSort={handleSort}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
          />
        )}

        {/* File list */}
        {explorerViewMode !== 'miller' && (
          <div
            ref={parentRef}
            /* Room to scroll the last rows clear of the floating selection bar.
               Padding below the content moves nothing that is already on screen. */
            className={`scrollbar-overlay ${settings.fileListHeight === 'fill' ? 'flex-1 overflow-auto' : 'flex-none overflow-auto'} ${
              selectedPaths.size > 0 ? 'pb-14' : ''
            }`}
            style={
              settings.fileListHeight === 'auto' ? { maxHeight: 'calc(100vh - 200px)' } : undefined
            }
          >
            {filteredEntries.length === 0 ? (
              <RouteState
                variant="empty"
                title={
                  hasActiveFilters
                    ? 'No Matching Files'
                    : searchQuery
                      ? 'No matching files'
                      : 'Empty Directory'
                }
                description={
                  hasActiveFilters
                    ? 'No files match the current filters. Try adjusting your filter settings.'
                    : searchQuery
                      ? `No files matching "${searchQuery}"`
                      : 'This directory contains no files'
                }
                action={
                  hasActiveFilters
                    ? {
                        label: 'Clear Filters',
                        onClick: () => {
                          setFileTypeFilter('all');
                          setStatusFilter('all');
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <div
                style={{
                  height:
                    settings.fileListHeight === 'fill' ? `${virtualizer.getTotalSize()}px` : 'auto',
                  minHeight:
                    settings.fileListHeight === 'auto'
                      ? `${virtualizer.getTotalSize()}px`
                      : undefined,
                  position: settings.fileListHeight === 'fill' ? 'relative' : undefined,
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = filteredEntries[virtualRow.index];
                  return (
                    <DraggableFileRow
                      key={entry.path}
                      path={entry.path}
                      isDirectory={entry.isDirectory}
                      selectedPaths={selectedPaths}
                      onDrop={handleFileDrop}
                      /* Nothing to drag: the path is not on disk yet. */
                      disabled={isNotOnDisk(entry)}
                      style={
                        settings.fileListHeight === 'fill'
                          ? {
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }
                          : undefined
                      }
                    >
                      <FileRow
                        entry={entry}
                        isSelected={selectedPaths.has(entry.path)}
                        onSelect={handleSelect}
                        onNavigate={handleNavigateToEntry}
                        actions={fileRowActions}
                        columnWidths={columnWidths}
                        compact={settings.compactFileRows}
                        showThumbnails={settings.showThumbnails}
                        showFolderSizes={settings.showFolderSizes}
                        folderSizes={folderSizes}
                        workingCopyRoot={
                          svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot
                        }
                        style={
                          settings.fileListHeight === 'fill'
                            ? {
                                width: '100%',
                                height: `${virtualRow.size}px`,
                              }
                            : undefined
                        }
                      />
                    </DraggableFileRow>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Status Bar */}
        {/* Footer — prototype `.cfoot`: the count on the left, the path on the right */}
        <div className="status-bar h-[30px] flex-none gap-3 px-3.5 text-[11.5px]">
          <div className="flex min-w-0 items-center gap-3">
            <span>
              {listingIsFiltered ? (
                <>
                  <b className="font-semibold text-text-secondary">{filteredEntries.length}</b> of{' '}
                  {entries.length.toLocaleString()} items in this folder
                </>
              ) : listingIsTruncated ? (
                <>
                  Showing{' '}
                  <b className="font-semibold text-text-secondary">{filteredEntries.length}</b> of{' '}
                  {entries.length.toLocaleString()} — filter or search to narrow
                </>
              ) : (
                <>
                  <b className="font-semibold text-text-secondary">{filteredEntries.length}</b>{' '}
                  items
                </>
              )}
            </span>
            {selectedPaths.size > 0 && (
              <span className="text-accent">{selectedPaths.size} selected</span>
            )}
            {hasChanges && (
              <span className="text-svn-modified">
                {entries.filter((e) => e.status === 'M').length || 0} modified
              </span>
            )}
            {deepStatusMessage && <span className="truncate text-accent">{deepStatusMessage}</span>}
          </div>
          <span
            className="min-w-0 max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs text-text-faint"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={path}
          >
            {path}
          </span>
        </div>
      </div>

      {showPreview && (
        <Suspense fallback={null}>
          <FilePreview
            filePath={selectedEntry && !selectedEntry.isDirectory ? selectedEntry.path : null}
            isOpen={showPreview}
            onClose={() => setShowPreview(false)}
            onDiff={(filePath) => setDiffViewerPath(filePath)}
          />
        </Suspense>
      )}

      {/* Commit Dialog */}
      {actions.commitDialogOpen && (
        <Suspense fallback={<CommitDialogLoader />}>
          <CommitDialog
            isOpen={actions.commitDialogOpen}
            workingCopyPath={path || ''}
            onClose={actions.closeCommitDialog}
            onSubmit={actions.handleSubmitCommit}
          />
        </Suspense>
      )}

      {/* Diff Viewer */}
      {diffViewerPath && (
        <Suspense fallback={<DialogLoader />}>
          <DiffViewer
            isOpen={!!diffViewerPath}
            filePath={diffViewerPath}
            onClose={() => setDiffViewerPath(null)}
          />
        </Suspense>
      )}

      {/* Log Viewer */}
      {logViewerPath && (
        <Suspense fallback={<DialogLoader />}>
          <LogViewer
            isOpen={!!logViewerPath}
            path={logViewerPath}
            onClose={() => setLogViewerPath(null)}
          />
        </Suspense>
      )}

      {settingsDialogOpen && (
        <SettingsDialog isOpen={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} />
      )}

      {updateDialogOpen && (
        <Suspense fallback={<DialogLoader />}>
          <UpdateToRevisionDialog
            isOpen={updateDialogOpen}
            onClose={() => {
              setUpdateDialogOpen(false);
              setPendingUpdateEntry(null);
            }}
            onComplete={() => {
              setUpdateDialogOpen(false);
              setPendingUpdateEntry(null);
            }}
            itemName={pendingUpdateEntry?.path || ''}
            onConfirm={handleUpdateToRevision}
            onConfirmUrls={handleUpdateRepoUrls}
            repoUrl={effectiveUrl}
            credentials={storedCreds ?? undefined}
            workingCopyRoot={svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot}
          />
        </Suspense>
      )}

      {/* Branch/Tag Dialog */}
      {branchTagPath && (
        <Suspense fallback={<DialogLoader />}>
          <BranchTagDialog
            isOpen={!!branchTagPath}
            onClose={() => setBranchTagPath(null)}
            sourcePath={branchTagPath}
            sourceUrl={svnInfo?.url}
            mode={branchTagMode}
            onComplete={() => {
              setBranchTagPath(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'directory',
              });
              queryClient.invalidateQueries({ queryKey: ['svn:info', path] });
            }}
          />
        </Suspense>
      )}

      {branchTagCompareOpen && (
        <Suspense fallback={<DialogLoader />}>
          <BranchTagCompareDialog
            isOpen={branchTagCompareOpen}
            onClose={() => setBranchTagCompareOpen(false)}
            sourceUrl={svnInfo?.url}
          />
        </Suspense>
      )}

      {/* Switch Dialog */}
      {switchPath && (
        <Suspense fallback={<DialogLoader />}>
          <SwitchDialog
            isOpen={!!switchPath}
            onClose={() => setSwitchPath(null)}
            currentPath={switchPath}
            currentUrl={svnInfo?.url}
            onComplete={() => {
              setSwitchPath(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'status',
              });
            }}
          />
        </Suspense>
      )}

      {/* Merge Wizard */}
      {mergePath && (
        <Suspense fallback={<DialogLoader />}>
          <MergeWizard
            isOpen={!!mergePath}
            onClose={() => setMergePath(null)}
            targetPath={mergePath}
            onComplete={() => {
              setMergePath(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'status',
              });
            }}
          />
        </Suspense>
      )}

      {/* Relocate Dialog */}
      {relocatePath && (
        <Suspense fallback={<DialogLoader />}>
          <RelocateDialog
            isOpen={!!relocatePath}
            onClose={() => setRelocatePath(null)}
            workingCopyPath={relocatePath}
            currentUrl={svnInfo?.url}
            onSuccess={() => {
              setRelocatePath(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'directory',
              });
              queryClient.invalidateQueries({ queryKey: ['svn:info', path] });
            }}
          />
        </Suspense>
      )}

      {/* Blame Viewer */}
      {blamePath && (
        <Suspense fallback={<DialogLoader />}>
          <BlameViewer
            isOpen={!!blamePath}
            filePath={blamePath}
            onClose={() => setBlamePath(null)}
          />
        </Suspense>
      )}

      {/* Properties Dialog */}
      {propertiesPath && (
        <Suspense fallback={<DialogLoader />}>
          <PropertiesDialog
            isOpen={!!propertiesPath}
            onClose={() => setPropertiesPath(null)}
            path={propertiesPath}
          />
        </Suspense>
      )}

      {/* Changelist Dialog */}
      {changelistPath && (
        <Suspense fallback={<DialogLoader />}>
          <ChangelistDialog
            isOpen={!!changelistPath}
            onClose={() => setChangelistPath(null)}
            path={changelistPath}
            selectedFiles={selectedPaths.size > 0 ? Array.from(selectedPaths) : undefined}
          />
        </Suspense>
      )}

      {/* Create Patch Dialog */}
      {createPatchPath && (
        <Suspense fallback={<DialogLoader />}>
          <CreatePatchDialog
            isOpen={!!createPatchPath}
            onClose={() => setCreatePatchPath(null)}
            path={createPatchPath}
            selectedPaths={selectedPaths.size > 0 ? Array.from(selectedPaths) : undefined}
          />
        </Suspense>
      )}

      {/* Apply Patch Dialog */}
      {applyPatchPath && (
        <Suspense fallback={<DialogLoader />}>
          <ApplyPatchDialog
            isOpen={!!applyPatchPath}
            onClose={() => setApplyPatchPath(null)}
            targetPath={applyPatchPath}
            onComplete={() => {
              setApplyPatchPath(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'status',
              });
            }}
          />
        </Suspense>
      )}

      {/* Ignore Dialog */}
      {ignoreEntry && (
        <Suspense fallback={<DialogLoader />}>
          <IgnoreDialog
            isOpen={!!ignoreEntry}
            onClose={() => setIgnoreEntry(null)}
            path={ignoreEntry.path}
            fileName={ignoreEntry.fileName}
            onApply={async (patterns: string[]) => {
              if (!ignoreEntry) return;

              // The path in ignoreEntry is the full path to the file/dir
              // svn:ignore is set on the parent directory
              const ignoreParentPath =
                ignoreEntry.path.split(/[/\\]/).slice(0, -1).join('/') || '.';

              try {
                // Get existing svn:ignore patterns
                const existingProps = assertSuccessfulSvnRead(
                  await window.api.svn.proplist(ignoreParentPath)
                );
                const existingIgnore = existingProps.properties.find(
                  (p) => p.name === 'svn:ignore'
                );
                const existingPatterns = existingIgnore?.value
                  ? existingIgnore.value.split('\n').filter((p) => p.trim())
                  : [];

                // Merge with new patterns (avoid duplicates)
                const mergedPatterns = [...new Set([...existingPatterns, ...patterns])];

                // Set the updated svn:ignore property
                await window.api.svn.propset(
                  ignoreParentPath,
                  'svn:ignore',
                  mergedPatterns.join('\n')
                );

                setIgnoreEntry(null);
                invalidateWorkingCopyViews(queryClient, path, {
                  includeParents: false,
                  scope: 'status',
                });
              } catch (setIgnoreError) {
                console.error('Failed to set svn:ignore:', setIgnoreError);
              }
            }}
          />
        </Suspense>
      )}

      {/* Shelve Dialog */}
      {shelveDialogPath && (
        <Suspense fallback={<DialogLoader />}>
          <ShelveDialog
            isOpen={!!shelveDialogPath}
            workingCopyPath={shelveDialogPath}
            onClose={() => setShelveDialogPath(null)}
          />
        </Suspense>
      )}

      {/* Quick Notes Panel */}
      {showNotes && (
        <Suspense fallback={<DialogLoader />}>
          <QuickNotesPanel
            isOpen={showNotes}
            currentPath={path}
            onClose={() => setShowNotes(false)}
          />
        </Suspense>
      )}

      {/* Lock Management Dialog */}
      {lockManagementPath && (
        <Suspense fallback={<DialogLoader />}>
          <LockManagementDialog
            isOpen={!!lockManagementPath}
            workingCopyPath={lockManagementPath}
            onClose={() => setLockManagementPath(null)}
            onRefresh={() => {
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'status',
              });
            }}
          />
        </Suspense>
      )}

      {/* Export Dialog */}
      {exportPath && (
        <Suspense fallback={<DialogLoader />}>
          <ExportDialog
            isOpen={!!exportPath}
            onClose={() => setExportPath(null)}
            initialPath={exportPath}
          />
        </Suspense>
      )}

      {/* Revision Graph */}
      {revisionGraphPath && (
        <Suspense fallback={<DialogLoader />}>
          <RevisionGraph
            isOpen={!!revisionGraphPath}
            path={revisionGraphPath}
            onClose={() => setRevisionGraphPath(null)}
          />
        </Suspense>
      )}

      {/* Move/Rename Dialog */}
      {moveRenameTarget && (
        <Suspense fallback={<DialogLoader />}>
          <MoveRenameDialog
            isOpen={!!moveRenameTarget}
            sourcePath={moveRenameTarget.path}
            mode={moveRenameTarget.mode}
            onClose={() => setMoveRenameTarget(null)}
            onSuccess={() => {
              invalidateCurrentPath();
            }}
          />
        </Suspense>
      )}

      {/* Resolve Dialog */}
      {modificationsPath && (
        <Suspense fallback={<DialogLoader />}>
          <ModificationsView
            path={modificationsPath}
            onClose={() => setModificationsPath(null)}
            onDiff={(targetPath) => {
              setModificationsPath(null);
              setDiffViewerPath(targetPath);
            }}
            onLog={(targetPath) => {
              setModificationsPath(null);
              setLogViewerPath(targetPath);
            }}
            onReveal={(targetPath) => {
              void window.api.fs.getParent(targetPath).then((targetParentPath) => {
                setModificationsPath(null);
                navigate({ to: '/files', search: { path: targetParentPath ?? targetPath } });
              });
            }}
            onResolve={(entry) => {
              setModificationsPath(null);
              setResolveEntry(entry);
            }}
          />
        </Suspense>
      )}

      {resolveEntry && (
        <Suspense fallback={<DialogLoader />}>
          <ResolveDialog
            isOpen={!!resolveEntry}
            filePath={resolveEntry.path}
            status={resolveEntry.status as 'C' | '?' | '!'}
            onClose={() => setResolveEntry(null)}
            onResolve={async (resolution) => {
              await actions.resolve(resolveEntry.path, resolution);
              setResolveEntry(null);
              invalidateWorkingCopyViews(queryClient, path, {
                includeParents: false,
                scope: 'status',
              });
            }}
          />
        </Suspense>
      )}

      {/* Import Dialog */}
      {isImportDialogOpen && (
        <Suspense fallback={<DialogLoader />}>
          <ImportDialog
            isOpen={isImportDialogOpen}
            onClose={() => setIsImportDialogOpen(false)}
            initialPath={path || ''}
          />
        </Suspense>
      )}

      {authPrompt.isOpen && (
        <FileExplorerAuthPrompt
          realm={authPrompt.realm}
          username={authPrompt.username}
          password={authPrompt.password}
          onUsernameChange={authPrompt.setUsername}
          onPasswordChange={authPrompt.setPassword}
          onCancel={authPrompt.close}
          onSubmit={authPrompt.submit}
        />
      )}

      {problemsPath && (
        <Suspense fallback={<DialogLoader />}>
          <WorkingCopyProblemsDialog path={problemsPath} onClose={() => setProblemsPath(null)} />
        </Suspense>
      )}

      {/* Repository Diagnostics */}
      {diagnosticsOpen && (
        <Suspense fallback={<DialogLoader />}>
          <RepoDiagnosticsPanel
            workingCopyPath={path || ''}
            onClose={() => setDiagnosticsOpen(false)}
            onAuthenticate={() => {
              if (effectiveRepoRoot) {
                authPrompt.requestAuthentication(effectiveRepoRoot);
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
