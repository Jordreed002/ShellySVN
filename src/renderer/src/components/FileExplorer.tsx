import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  Suspense,
  useDeferredValue,
} from 'react';
import { FolderX, AlertCircle, Loader, ArrowUp, Globe, Columns3, List } from 'lucide-react';
import type { DeepStatusProgress, SvnStatusEntry, SvnStatusChar } from '@shared/types';
import { Breadcrumb } from './ui/Breadcrumb';
import { MillerColumns } from './files/MillerColumns';
import { RouteState } from './ui/RouteState';
import { Toolbar } from './ui/Toolbar';
import { FileRow, FileListHeader } from './ui/FileRow';
import { FilterBar, useFileFilters } from './ui/FilterBar';
import { confirmAppAction, promptAppInput, showAppMessage } from '../utils/dialogs';
import { useDualPane } from './ui/DualPaneView';
import { useFileExplorerActions } from '../hooks/useSvnActions';
import { useSettings } from '../hooks/useSettings';
import { useHomePath } from '../hooks/useHomePath';
import { useFolderSizes } from '../hooks/useFolderSizes';
import {
  applyDeepStatus,
  buildFolderChangeCounts,
  fileInfoToEntry,
} from '../features/files/fileStatus';
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
  MoveRenameDialog,
  PropertiesDialog,
  QuickNotesPanel,
  RelocateDialog,
  RepoBrowser,
  RepoDiagnosticsPanel,
  ResolveDialog,
  RevisionGraph,
  ShelveDialog,
  SwitchDialog,
  UpdateToRevisionDialog,
  loadCommitDialog,
} from './files/FileExplorerLazyDialogs';

function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

export function FileExplorer() {
  const { path } = useSearch({ from: '/files/' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [browseMode, setBrowseMode] = useState<'local' | 'online'>('local');
  const [onlinePath, setOnlinePath] = useState<string>('');
  const [showRemoteItems, setShowRemoteItems] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isUpgradingWorkingCopy, setIsUpgradingWorkingCopy] = useState(false);

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
    moveRenameTarget,
    pendingUpdateEntry,
    propertiesPath,
    relocatePath,
    repoBrowserUrl,
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
    setMoveRenameTarget,
    setPendingUpdateEntry,
    setPropertiesPath,
    setRelocatePath,
    setRepoBrowserUrl,
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
  const [deepStatusProgress, setDeepStatusProgress] = useState<DeepStatusProgress | null>(null);

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

  const onlineUrl = useMemo(() => {
    if (!effectiveRepoRoot) return '';
    if (!onlinePath) return effectiveRepoRoot;
    const baseUrl = effectiveRepoRoot.replace(/\/$/, '');
    return `${baseUrl}${onlinePath}`;
  }, [effectiveRepoRoot, onlinePath]);

  const { data: storedCreds } = useQuery({
    queryKey: ['auth', effectiveRepoRoot],
    queryFn: async () => {
      if (!effectiveRepoRoot) return null;
      try {
        return await window.api.auth.get(effectiveRepoRoot);
      } catch {
        return null;
      }
    },
    enabled: !!effectiveRepoRoot,
    staleTime: FILE_CACHE_TIME,
  });
  const svnListAuthKey = getAuthPresenceKey(storedCreds);

  // Phase 6: Get online files for repo browser mode
  const { data: onlineFiles, isFetching: isLoadingOnline } = useQuery({
    queryKey: createSvnListQueryKey('online', onlineUrl, svnListAuthKey),
    queryFn: async () => {
      if (!onlineUrl) return { path: '', entries: [] };
      const creds = storedCreds
        ? { username: storedCreds.username, password: storedCreds.password }
        : undefined;
      try {
        const result = await window.api.svn.list(onlineUrl, 'HEAD', 'immediates', creds);
        return result;
      } catch (err) {
        const errorMsg = (err as Error)?.message || '';
        if (
          errorMsg.includes('credentials') ||
          errorMsg.includes('Authentication') ||
          errorMsg.includes('E215004')
        ) {
          if (effectiveRepoRoot) {
            authPrompt.requestAuthentication(effectiveRepoRoot);
          }
        }
        return { path: '', entries: [] };
      }
    },
    enabled: !!onlineUrl && !authPrompt.isOpen && browseMode === 'online',
    staleTime: STATUS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Fetch remote items for merging with local items (sparse checkout support)
  const { data: remoteItems, isFetching: isLoadingRemoteItems } = useQuery({
    queryKey: createSvnListQueryKey('remote', effectiveUrl, svnListAuthKey),
    queryFn: async () => {
      if (!effectiveUrl) return { path: '', entries: [] };
      const creds = storedCreds
        ? { username: storedCreds.username, password: storedCreds.password }
        : undefined;
      try {
        const result = await window.api.svn.list(effectiveUrl, 'HEAD', 'immediates', creds);
        return result;
      } catch (err) {
        const errorMsg = (err as Error)?.message || '';
        if (
          errorMsg.includes('credentials') ||
          errorMsg.includes('Authentication') ||
          errorMsg.includes('E215004')
        ) {
          if (effectiveRepoRoot) {
            authPrompt.requestAuthentication(effectiveRepoRoot);
          }
        }
        return { path: '', entries: [] };
      }
    },
    enabled:
      !!effectiveUrl &&
      !authPrompt.isOpen &&
      showRemoteItems &&
      browseMode === 'local' &&
      isVersioned === true,
    staleTime: STATUS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const files = useMemo(() => {
    if (browseMode === 'online' && onlineFiles?.entries) {
      return onlineFiles.entries.map((entry) => ({
        name: entry.name,
        path: onlinePath === '' ? `/${entry.name}` : `${onlinePath}/${entry.name}`,
        isDirectory: entry.kind === 'dir',
        size: entry.size || 0,
        modifiedTime: entry.date || '',
        svnStatus: {
          path: onlinePath === '' ? `/${entry.name}` : `${onlinePath}/${entry.name}`,
          remoteUrl: entry.url,
          status: 'O' as SvnStatusChar,
          revision: entry.revision,
          author: entry.author,
          isDirectory: entry.kind === 'dir',
        },
      }));
    }

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

    if (showRemoteItems && remoteItems?.entries && svnInfo?.url) {
      const localFileNames = new Set(result.map((f) => f.name));
      const remoteOnlyItems = remoteItems.entries
        .filter((entry) => !localFileNames.has(entry.name))
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
      result = [...result, ...remoteOnlyItems];
    }

    return result;
  }, [
    browseMode,
    onlineFiles,
    onlinePath,
    rawFiles,
    statusData,
    deepStatusData,
    path,
    showRemoteItems,
    remoteItems,
    svnInfo?.url,
  ]);

  // Convert to entries for virtualizer
  // Base directory for Miller columns: the working-copy root (or home) when the
  // current path is inside it, so we don't render empty unapproved /…/ columns.
  const millerBase = useMemo(() => {
    const isUnder = (root?: string) =>
      !!root && (path === root || path.startsWith(root.replace(/[\\/]+$/, '') + '/') || path.startsWith(root.replace(/[\\/]+$/, '') + '\\'));
    const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot;
    if (isUnder(wcRoot)) return wcRoot ?? null;
    if (isUnder(homePath)) return homePath;
    return null;
  }, [path, svnInfo?.workingCopyRoot, workingCopyContext?.workingCopyRoot, homePath]);

  const folderChangeCounts = useMemo(
    () => (deepStatusData ? buildFolderChangeCounts(files || [], deepStatusData) : null),
    [files, deepStatusData]
  );

  const entries = useMemo(() => {
    const list = (files || []).map(fileInfoToEntry);
    if (!folderChangeCounts || folderChangeCounts.size === 0) return list;
    return list.map((entry) => {
      if (!entry.isDirectory) return entry;
      const key = entry.path.replace(/\\/g, '/').replace(/\/+$/, '');
      const count = folderChangeCounts.get(key);
      return count ? { ...entry, childChangeCount: count } : entry;
    });
  }, [files, folderChangeCounts]);

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
    return filteredEntryByPath.get(firstSelected) || null;
  }, [selectedPaths, filteredEntryByPath]);

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

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    getItemKey: (index) => filteredEntries[index]?.path ?? index,
    overscan: 15,
  });

  const handleNavigate = useCallback(
    (newPath: string) => {
      navigate({ to: '/files', search: { path: newPath } });
    },
    [navigate]
  );

  const handleSetBrowseMode = useCallback(
    (mode: 'local' | 'online') => {
      setBrowseMode(mode);
      if (mode === 'local') {
        setOnlinePath('');
      }
      clearSelection();
    },
    [clearSelection]
  );

  const handleNavigateToEntry = useCallback(
    (entry: SvnStatusEntry) => {
      if (browseMode === 'online') {
        if (entry.isDirectory) {
          setOnlinePath(entry.path);
          clearSelection();
        }
        return;
      }
      if (entry.isDirectory) {
        navigate({ to: '/files', search: { path: entry.path } });
      }
    },
    [navigate, browseMode, clearSelection]
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
        const result = await window.api.svn.copy(entry.path, destination, `Copy ${entry.path}`);
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
        const separator = entry.path.includes('\\') ? '\\' : '/';
        const lastSep = entry.path.lastIndexOf(separator);
        const parentDir = lastSep > 0 ? entry.path.substring(0, lastSep) : entry.path;
        window.api.app.openExternal(parentDir);
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
      onShelve: (entry: SvnStatusEntry) => {
        if (entry.isDirectory) {
          setShelveDialogPath(entry.path);
        }
      },
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
            invalidateWorkingCopyViews(queryClient, path, { includeParents: false, scope: 'status' });
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
            invalidateWorkingCopyViews(queryClient, path, { includeParents: false, scope: 'status' });
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
      onRepoBrowser: (entry: SvnStatusEntry) => setRepoBrowserUrl(entry.path),
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
            invalidateWorkingCopyViews(queryClient, path, { includeParents: false, scope: 'status' });
          } else {
            await showAppMessage({
              type: 'error',
              message: 'Cleanup failed',
              detail: result.message || 'Unknown error',
            });
          }
        }
      },
      // Check for Modifications - placeholder (view doesn't exist yet)
      onCheckForModifications: undefined,
    }),
    [
      selectedEntry,
      selectedPaths,
      actions,
      path,
      queryClient,
      invalidateCurrentPath,
      setBranchTagPath,
      setBranchTagMode,
      setDiffViewerPath,
      setIsImportDialogOpen,
      setLogViewerPath,
      setSwitchPath,
      setMergePath,
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
      setRepoBrowserUrl,
      setRevisionGraphPath,
      setResolveEntry,
    ]
  );

  const handleUpdateToRevision = useCallback(
    async (depth: 'empty' | 'files' | 'immediates' | 'infinity', setDepthSticky: boolean) => {
      if (!pendingUpdateEntry) return { success: false, revision: 0, error: 'No entry selected' };

      const entry = pendingUpdateEntry;
      const wcRoot = svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot || path;
      const isRemoteItem = entry.status === 'O';

      if ((browseMode === 'online' || isRemoteItem) && effectiveRepoRoot) {
        const target = resolveRemoteUpdateTarget({
          entry,
          repositoryRoot: effectiveRepoRoot,
          workingCopyUrl: effectiveUrl,
          workingCopyRoot: wcRoot,
          currentPath: path,
        });

        try {
          const result = await window.api.svn.updateToRevision(
            wcRoot,
            target.repoUrl,
            target.localPath,
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
            revision: 0,
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
            revision: 0,
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
      browseMode,
      effectiveRepoRoot,
      effectiveUrl,
      queryClient,
      invalidateCurrentPath,
    ]
  );

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
    isLoadingStatus ||
    isLoadingDeep ||
    isLoadingOnline ||
    isLoadingRemoteItems ||
    actions.isUpdating;
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
        <div className="h-[--toolbar-height] bg-bg-secondary border-b border-border animate-pulse" />
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
        <div className="h-[--toolbar-height] bg-bg-secondary border-b border-border" />
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

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
        {/* Breadcrumb Header */}
        <div className="h-[--header-height] flex items-center px-4 bg-bg-secondary border-b border-border">
          {browseMode === 'online' ? (
            <>
              {onlinePath && onlinePath !== '' && (
                <button
                  type="button"
                  onClick={() => {
                    const parts = onlinePath.split('/').filter(Boolean);
                    parts.pop();
                    setOnlinePath(parts.length === 0 ? '' : '/' + parts.join('/'));
                    setSelectedPaths(new Set());
                  }}
                  className="btn-icon-sm mr-2"
                  title="Go to parent directory"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
              <span className="text-sm text-text-muted">
                {effectiveRepoRoot}
                {onlinePath && <span className="text-text">{onlinePath}</span>}
              </span>
              <span className="flex items-center gap-1.5 ml-3 px-2 py-0.5 bg-accent/10 text-accent text-xs font-medium rounded">
                <Globe className="w-3 h-3" />
                Online
              </span>
            </>
          ) : (
            <>
              {parentPath && (
                <button
                  type="button"
                  onClick={() => handleNavigate(parentPath)}
                  className="btn-icon-sm mr-2"
                  title="Go to parent directory"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
              <Breadcrumb path={path} onNavigate={handleNavigate} homePath={homePath} />
            </>
          )}
          {isFetching && (
            <span title="Loading status...">
              <Loader className="w-4 h-4 text-accent animate-spin ml-2" />
            </span>
          )}
        </div>

        {/* Toolbar */}
        <Toolbar
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
            const result = await window.api.svn.copy(
              selectedEntry.path,
              destination,
              `Copy ${selectedEntry.path}`
            );
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
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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
          browseMode={browseMode}
          onBrowseModeChange={handleSetBrowseMode}
          canBrowseOnline={!!effectiveUrl}
          showRemoteItems={showRemoteItems}
          onToggleRemoteItems={() => setShowRemoteItems((prev) => !prev)}
          onShowNotes={() => setShowNotes(true)}
        />

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

        {/* View mode toggle (list vs Miller columns) */}
        {browseMode === 'local' && (
          <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-border">
            <button
              type="button"
              onClick={() => void updateSettings({ explorerViewMode: 'list' })}
              className={`btn-icon-sm ${explorerViewMode === 'list' ? 'text-accent bg-accent/10' : ''}`}
              title="List view"
              aria-label="List view"
              aria-pressed={explorerViewMode === 'list'}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void updateSettings({ explorerViewMode: 'miller' })}
              className={`btn-icon-sm ${explorerViewMode === 'miller' ? 'text-accent bg-accent/10' : ''}`}
              title="Columns view"
              aria-label="Columns view"
              aria-pressed={explorerViewMode === 'miller'}
            >
              <Columns3 className="w-4 h-4" />
            </button>
          </div>
        )}

        {explorerViewMode === 'miller' && browseMode === 'local' && (
          <MillerColumns
            path={path}
            baseRoot={millerBase}
            selectedPath={selectedEntry?.path}
            onNavigate={handleNavigate}
            onSelect={handleSelect}
            actions={fileRowActions}
            workingCopyRoot={svnInfo?.workingCopyRoot || workingCopyContext?.workingCopyRoot}
          />
        )}

        {/* Filter Bar */}
        {!(explorerViewMode === 'miller' && browseMode === 'local') && showFilters && (
          <FilterBar
            activeFileType={fileTypeFilter}
            activeStatus={statusFilter}
            onFileTypeChange={setFileTypeFilter}
            onStatusChange={setStatusFilter}
            fileCount={{ total: entries.length, filtered: filteredEntries.length }}
          />
        )}

        {/* File List Header */}
        {!(explorerViewMode === 'miller' && browseMode === 'local') && (
          <FileListHeader
            columnWidths={columnWidths}
            onColumnWidthChange={handleColumnWidthChange}
            onSort={handleSort}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
          />
        )}

        {/* File list */}
        {!(explorerViewMode === 'miller' && browseMode === 'local') && (
        <div
          ref={parentRef}
          className={`scrollbar-overlay ${settings.fileListHeight === 'fill' ? 'flex-1 overflow-auto' : 'flex-none overflow-auto'}`}
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
                    disabled={browseMode === 'online' || entry.status === 'O'}
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
        <div className="status-bar">
          <div className="flex items-center gap-4">
            <span>{filteredEntries.length} items</span>
            {selectedPaths.size > 0 && (
              <span className="text-accent">{selectedPaths.size} selected</span>
            )}
            {hasChanges && (
              <span className="text-svn-modified">
                {entries.filter((e) => e.status === 'M').length || 0} modified
              </span>
            )}
            {deepStatusMessage && <span className="text-accent">{deepStatusMessage}</span>}
          </div>
          <span className="text-text-faint">{path}</span>
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
            repoUrl={effectiveUrl}
            credentials={
              storedCreds
                ? { username: storedCreds.username, password: storedCreds.password }
                : undefined
            }
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
                const existingProps = await window.api.svn.proplist(ignoreParentPath);
                const existingIgnore = existingProps.find((p) => p.name === 'svn:ignore');
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

      {/* Repo Browser */}
      {repoBrowserUrl && (
        <Suspense fallback={<DialogLoader />}>
          <RepoBrowser
            isOpen={!!repoBrowserUrl}
            repoUrl={repoBrowserUrl}
            onClose={() => setRepoBrowserUrl(null)}
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
      {resolveEntry && (
        <Suspense fallback={<DialogLoader />}>
          <ResolveDialog
            isOpen={!!resolveEntry}
            filePath={resolveEntry.path}
            status={resolveEntry.status as 'C' | '?' | '!'}
            onClose={() => setResolveEntry(null)}
            onResolve={async (resolution) => {
              await actions.handleResolveSelected(resolution);
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
