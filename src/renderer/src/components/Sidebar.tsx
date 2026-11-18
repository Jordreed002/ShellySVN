import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ArrowUpDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileDiff,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  History,
  Home,
  Key,
  ListFilter,
  PanelTop,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useHomePath } from '@renderer/hooks/useHomePath';

import {
  RAIL_ACTION_CLASS,
  RailLinkRow,
  RailSection,
  RepoRailItem,
  railRowClass,
} from './sidebar/RepoRow';
import { ShellMark } from './ShellMark';
import { openTab } from '@renderer/lib/tabsStore';
import {
  describeRepo,
  shortenPath,
  useWorkingCopyOverview,
} from './sidebar/workingCopyOverview';
import { usePinnedRepos } from './sidebar/pinnedRepositories';
import { shouldLoadSidebarInsights } from './sidebar/sidebarInsightsGate';
import { WorkingCopyList } from './sidebar/WorkingCopyGroups';
import { useWorkingCopyGroups } from './sidebar/useWorkingCopyGroups';
import { useSidebarUiState } from './sidebar/useSidebarUiState';
import { groupWorkingCopies } from '@renderer/lib/workingCopyGroups';
import type { SidebarSortMode } from '@renderer/lib/sidebarUiState';
import {
  BatchCompletionNotice,
  UpdateAllButton,
} from '@renderer/features/working-copy-command-center/BatchUpdateControls';
import { useBatchUpdate } from '@renderer/features/working-copy-command-center/BatchUpdateProvider';
import { promptAppInput } from '@renderer/utils/dialogs';
import type { SettingsTab } from './ui/SettingsDialog';

const AddRepoModal = lazy(() =>
  import('./ui/AddRepoModal').then((mod) => ({ default: mod.AddRepoModal }))
);
const ImportDialog = lazy(() =>
  import('./ui/ImportDialog').then((mod) => ({ default: mod.ImportDialog }))
);
const loadSettingsDialog = () =>
  import('./ui/SettingsDialog').then((mod) => ({ default: mod.SettingsDialog }));
const SettingsDialog = lazy(loadSettingsDialog);
const ShelveDialog = lazy(() =>
  import('./ui/ShelveDialog').then((mod) => ({ default: mod.ShelveDialog }))
);
const SidebarInsights = lazy(() =>
  import('./sidebar/SidebarInsightsPanel').then((mod) => ({ default: mod.SidebarInsights }))
);
const RelinkDialog = lazy(() =>
  import('./ui/RelinkDialog').then((mod) => ({ default: mod.RelinkDialog }))
);
const DiskUsagePanel = lazy(() =>
  import('./ui/DiskUsagePanel').then((mod) => ({ default: mod.DiskUsagePanel }))
);

/** Recent locations are a shortcut list, not a history log — keep it short. */
const MAX_RECENT_LOCATIONS = 6;

function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps) {
  const { settings, addRecentRepo, removeRecentRepo, addBookmark, removeBookmark } = useSettings();
  const navigate = useNavigate();
  const routerState = useRouterState();

  const routeSearch = routerState.location.search as { path?: string; localPath?: string };
  const currentPath = routeSearch?.path || '';
  // The repository browser names the checkout it is inside as `localPath`.
  const repoBrowserLocalPath = routeSearch?.localPath;
  const currentPathWithDefault = currentPath;
  const pathname = routerState.location.pathname;
  const homePath = useHomePath();

  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // The working-copy filter is revealed on demand rather than always on screen.
  const [filterOpen, setFilterOpen] = useState(false);
  // Secondary rail sections are folded by default; remember the user's choice.
  const [moreOpen, setMoreOpen] = useState(false);
  // Working copy whose shelves the shelf manager is open on.
  const [shelvesFor, setShelvesFor] = useState<string | null>(null);
  // Gate for rail data nothing on screen is waiting for; see `runWhenIdle`.
  const [railIsIdle, setRailIsIdle] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Set when the rail's Search button expands the sidebar so we can focus search.
  const pendingSearchFocus = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: string } | null>(
    null
  );
  // Working copies whose relink (#60) / disk-usage (#61) dialogs are open.
  const [relinkFor, setRelinkFor] = useState<string | null>(null);
  const [diskUsageFor, setDiskUsageFor] = useState<string | null>(null);

  const { isPinned, togglePin } = usePinnedRepos();
  const groupsController = useWorkingCopyGroups();
  const sidebarUi = useSidebarUiState();
  const { updatePaths } = useBatchUpdate();

  const recentRepos = settings?.recentRepositories || [];
  const bookmarks = settings?.bookmarks || [];
  const recentPaths = settings?.recentPaths || [];

  const matchesSearch = useCallback(
    (value: string) => !searchQuery || value.toLowerCase().includes(searchQuery.toLowerCase()),
    [searchQuery]
  );

  const filteredRepos = recentRepos.filter((repo) => matchesSearch(repo));
  // Pinned repos float to the top (stable within each group).
  const sortedRepos = filteredRepos.toSorted((a, b) => Number(isPinned(b)) - Number(isPinned(a)));

  // The expanded list renders sections (groups + ungrouped) in the active sort
  // mode; the collapsed rail keeps the flat pinned-first order.
  const sections = useMemo(
    () =>
      groupWorkingCopies(filteredRepos, groupsController.state, {
        sortMode: sidebarUi.state.sortMode,
        isPinned,
      }),
    [filteredRepos, groupsController.state, sidebarUi.state.sortMode, isPinned]
  );

  // The recent repo that contains the current location, if any. The repository
  // browser reports its checkout as `localPath`, so honour that too.
  const activeRepo =
    (repoBrowserLocalPath && recentRepos.includes(repoBrowserLocalPath)
      ? repoBrowserLocalPath
      : undefined) ??
    recentRepos.find((repo) => currentPath === repo || currentPath.startsWith(repo + '/'));

  /* ── working-copy facts: one query feeds every row and the disk card ── */
  const overview = useWorkingCopyOverview(recentRepos);

  const filteredBookmarks = bookmarks.filter(
    (bookmark) => matchesSearch(bookmark.name) || matchesSearch(bookmark.path)
  );
  const filteredRecentPaths = recentPaths
    .filter((path) => !recentRepos.includes(path) && matchesSearch(path))
    .slice(0, MAX_RECENT_LOCATIONS);

  // Offer to bookmark wherever we are, unless it is already bookmarked.
  const canBookmarkCurrentPath =
    currentPath.length > 0 && !bookmarks.some((bookmark) => bookmark.path === currentPath);

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get<boolean>('shellysvn:sidebar-more-open')
      .then((value) => {
        if (!cancelled && typeof value === 'boolean') setMoreOpen(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMore = useCallback(() => {
    setMoreOpen((previous) => {
      const next = !previous;
      void window.api.store.set('shellysvn:sidebar-more-open', next);
      return next;
    });
  }, []);

  // Preload the settings dialog when the app is idle.
  useEffect(() => runWhenIdle(() => void loadSettingsDialog()), []);

  // Nothing on first paint depends on shelves, so they wait for the same idle
  // moment rather than competing with the working-copy reads that rows need.
  useEffect(() => runWhenIdle(() => setRailIsIdle(true)), []);

  // When a filter button reveals the filter (and maybe expands the sidebar), focus it.
  useEffect(() => {
    if (!collapsed && pendingSearchFocus.current) {
      pendingSearchFocus.current = false;
      searchInputRef.current?.focus();
    }
  }, [collapsed, filterOpen]);

  // Close the repo context menu on any outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleOpenRepo = useCallback(
    async (path: string) => {
      await addRecentRepo(path);
      navigate({ to: '/files', search: { path } });
    },
    [addRecentRepo, navigate]
  );

  const handleRemoveRepo = useCallback(
    async (repo: string) => {
      await removeRecentRepo(repo);
      setContextMenu(null);
    },
    [removeRecentRepo]
  );

  const handleOpenInOS = useCallback(async (repo: string) => {
    await window.api.external.openFolder(repo);
    setContextMenu(null);
  }, []);

  const handleManageCredentials = useCallback(() => {
    void loadSettingsDialog();
    setSettingsTab('auth');
    setIsSettingsDialogOpen(true);
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((event: MouseEvent, repo: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, repo });
  }, []);

  const openSettings = useCallback(() => {
    setSettingsTab('general');
    setIsSettingsDialogOpen(true);
  }, []);

  const handleSettingsRequest = useCallback((event: Event) => {
    const requestedTab =
      event instanceof CustomEvent && event.detail?.tab === 'auth' ? 'auth' : 'general';
    setSettingsTab(requestedTab);
    setIsSettingsDialogOpen(true);
  }, []);

  /* ── groups (#59) ── */
  const handleCreateGroup = useCallback(
    async (memberPath?: string) => {
      const name = await promptAppInput({
        title: memberPath ? 'New group' : 'New working-copy group',
        message: 'Group name',
        placeholder: 'e.g. Client work',
        confirmLabel: 'Create group',
      });
      if (!name) return;
      const id = await groupsController.create(name);
      if (id && memberPath) groupsController.assign(memberPath, id);
    },
    [groupsController]
  );

  const handleSortModeChange = useCallback(
    (event: { target: { value: string } }) => {
      const mode = event.target.value as SidebarSortMode;
      if (mode === 'default' || mode === 'manual' || mode === 'name') {
        sidebarUi.setSortMode(mode);
      }
    },
    [sidebarUi]
  );

  /* ── relink (#60) + disk usage (#61) ── */
  const openRelink = useCallback((repo: string) => {
    setRelinkFor(repo);
    setContextMenu(null);
  }, []);

  const openDiskUsage = useCallback((repo: string) => {
    setDiskUsageFor(repo);
    setContextMenu(null);
  }, []);

  const handleRelinkApplied = useCallback(
    (_oldPath: string, newPath: string) => {
      navigate({ to: '/files', search: { path: newPath } });
    },
    [navigate]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const frame = requestAnimationFrame(() => contextMenuRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextMenu]);

  useEffect(() => {
    window.addEventListener('shellysvn:open-settings', handleSettingsRequest);
    return () => window.removeEventListener('shellysvn:open-settings', handleSettingsRequest);
  }, [handleSettingsRequest]);

  /*
   * The sidebar answers "which workspace, which working copy" — the top bar
   * answers "where in it, and what can I do here". So the rail owns:
   *
   *  1. workspace identity (brand + what is on this machine),
   *  2. global destinations that exist without a checkout (Home, Files,
   *     Repository browser),
   *  3. the active working copy's own views, in journey order — inspect
   *     Changes, review History, browse its Repository — so the context of
   *     every view is explicit, and
   *  4. the list of working copies to switch between.
   *
   * Search over the list is a filter, revealed on demand; the global command
   * search lives once, in the top bar. Collapse lives once, in the top bar.
   */
  const activeName = activeRepo ? describeRepo(activeRepo).name : '';
  const activeStatus = activeRepo ? overview.get(activeRepo)?.status : undefined;
  const activeChanges = activeStatus?.changes ?? 0;
  const activeConflicts = activeStatus?.conflicts ?? 0;
  const isActiveChangesView = Boolean(activeRepo) && pathname.startsWith('/files');
  const isActiveHistoryView = Boolean(activeRepo) && pathname.startsWith('/history');
  const isActiveRepositoryView =
    pathname.startsWith('/repo-browser') && Boolean(activeRepo) && repoBrowserLocalPath === activeRepo;
  const showFilter = filterOpen || searchQuery.length > 0;
  const workspaceSummary =
    recentRepos.length === 0
      ? 'No working copies yet'
      : `${recentRepos.length} working ${recentRepos.length === 1 ? 'copy' : 'copies'} on this machine`;

  return (
    <>
      {collapsed ? (
        <aside
          className="app-sidebar app-sidebar-collapsed w-[--rail-width] h-full bg-bg-secondary border-r border-border flex flex-col items-center py-2 gap-0.5"
          aria-label="Sidebar"
          data-testid="sidebar-ready"
        >
          <div className="mb-1 grid h-8 w-8 place-items-center" title="ShellySVN">
            <ShellMark className="h-4 w-4 text-text" />
          </div>

          <Link
            to="/"
            className="rail-item"
            activeProps={{ className: 'rail-item rail-item-active' }}
            activeOptions={{ exact: true }}
            title="Home"
            aria-label="Home"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            to="/files"
            search={{ path: homePath || currentPathWithDefault }}
            className={`rail-item ${pathname.startsWith('/files') && !activeRepo ? 'rail-item-active' : ''}`}
            title="Files"
            aria-label="Files"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            to="/repo-browser"
            search={{ url: '', localPath: undefined }}
            className={`rail-item ${pathname.startsWith('/repo-browser') && !isActiveRepositoryView ? 'rail-item-active' : ''}`}
            title="Repository browser"
            aria-label="Repository browser"
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </Link>

          {activeRepo && (
            <>
              <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
              <Link
                to="/files"
                search={{ path: activeRepo }}
                className={`rail-item ${isActiveChangesView ? 'rail-item-active' : ''}`}
                title={`Changes in ${activeName}`}
                aria-label={`Changes in ${activeName}`}
              >
                <FileDiff className="h-4 w-4" aria-hidden="true" />
                {activeChanges > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                      activeConflicts > 0 ? 'bg-svn-conflict' : 'bg-svn-modified'
                    }`}
                  />
                )}
              </Link>
              <Link
                to="/history"
                search={{ path: activeRepo }}
                className={`rail-item ${isActiveHistoryView ? 'rail-item-active' : ''}`}
                title={`History of ${activeName}`}
                aria-label="History"
              >
                <History className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          )}

          <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />

          <div className="flex-1 w-full overflow-y-auto scrollbar-overlay flex flex-col items-center gap-0.5 py-0.5">
            {sortedRepos.map((repo) => (
              <RepoRailItem
                key={repo}
                repo={repo}
                isActive={currentPath === repo || currentPath.startsWith(repo + '/')}
                isPinned={isPinned(repo)}
                status={overview.get(repo)?.status}
                onOpen={(r) => void addRecentRepo(r)}
                onMenu={openContextMenu}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              pendingSearchFocus.current = true;
              setFilterOpen(true);
              onToggleCollapse?.();
            }}
            className="rail-item"
            title="Filter working copies"
            aria-label="Filter working copies"
          >
            <ListFilter className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setIsAddRepoModalOpen(true)}
            className="rail-item"
            title="Add working copy"
            aria-label="Add working copy"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerEnter={() => void loadSettingsDialog()}
            onFocus={() => void loadSettingsDialog()}
            onClick={openSettings}
            className="rail-item"
            data-testid="settings-button"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </button>
        </aside>
      ) : (
        <aside
          className="app-sidebar w-[--sidebar-width] h-full bg-bg-secondary border-r border-border flex flex-col overflow-hidden"
          aria-label="Sidebar"
          data-testid="sidebar-ready"
        >
          {/* Workspace identity: what this app is, and what is on this machine. */}
          <div className="sidebar-workspace flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-border px-3">
            <span
              className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-bg-tertiary"
              aria-hidden="true"
            >
              <ShellMark className="h-3.5 w-3.5 text-text" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-13 font-semibold leading-tight text-text">
                ShellySVN
              </span>
              <span className="block truncate text-11 leading-tight text-text-muted">
                {workspaceSummary}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setIsAddRepoModalOpen(true)}
              className={RAIL_ACTION_CLASS}
              title="Add working copy — open a folder or check out"
              aria-label="Add working copy"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <nav
            aria-label="Repositories and locations"
            className="flex-1 overflow-y-auto scrollbar-overlay pb-3"
          >
            {/* Global destinations — available with or without a checkout. */}
            <ul className="space-y-px px-2 pt-2" aria-label="Global">
              <li>
                <Link
                  to="/"
                  className={railRowClass(pathname === '/')}
                  aria-current={pathname === '/' ? 'page' : undefined}
                >
                  <Home className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="flex-1 truncate">Home</span>
                </Link>
              </li>
              <li>
                <Link
                  to="/files"
                  search={{ path: homePath || currentPathWithDefault }}
                  className={railRowClass(pathname.startsWith('/files') && !activeRepo)}
                  aria-current={pathname.startsWith('/files') && !activeRepo ? 'page' : undefined}
                >
                  <FolderOpen
                    className="h-3.5 w-3.5 flex-shrink-0 text-text-muted"
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">Files</span>
                </Link>
              </li>
              <li>
                <Link
                  to="/repo-browser"
                  search={{ url: '', localPath: undefined }}
                  className={railRowClass(
                    pathname.startsWith('/repo-browser') && !isActiveRepositoryView
                  )}
                  aria-current={
                    pathname.startsWith('/repo-browser') && !isActiveRepositoryView
                      ? 'page'
                      : undefined
                  }
                >
                  <Globe className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="flex-1 truncate">Repository browser</span>
                </Link>
              </li>
            </ul>

            {/* ── Working copies ── */}
            <RailSection
              title="Working copies"
              action={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (showFilter) {
                        setFilterOpen(false);
                        setSearchQuery('');
                      } else {
                        pendingSearchFocus.current = true;
                        setFilterOpen(true);
                      }
                    }}
                    className={`${RAIL_ACTION_CLASS} ${showFilter ? 'bg-bg-tertiary text-text' : ''}`}
                    title="Filter working copies"
                    aria-label="Filter working copies"
                    aria-pressed={showFilter}
                  >
                    <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <label
                    className={`${RAIL_ACTION_CLASS} relative cursor-pointer`}
                    title="Sort working copies"
                  >
                    <span className="sr-only">Sort working copies</span>
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    <select
                      value={sidebarUi.state.sortMode}
                      onChange={handleSortModeChange}
                      className="absolute inset-0 cursor-pointer appearance-none opacity-0"
                      data-testid="sort-mode-select"
                    >
                      <option value="default">Recent</option>
                      <option value="manual">Manual</option>
                      <option value="name">Name</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleCreateGroup()}
                    className={RAIL_ACTION_CLASS}
                    title="New group"
                    aria-label="Create a working-copy group"
                    data-testid="create-group-button"
                  >
                    <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <UpdateAllButton
                    iconOnly
                    className={RAIL_ACTION_CLASS}
                    iconClassName="h-3.5 w-3.5"
                    label="Update all"
                    title="Update every working copy through the batch pipeline"
                  />
                </>
              }
            />

            {showFilter && (
              <div className="relative px-2 pb-1 pt-0.5">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setSearchQuery('');
                      setFilterOpen(false);
                    }
                  }}
                  placeholder="Filter working copies…"
                  aria-label="Search repositories"
                  className="h-7 w-full rounded-md border border-border bg-bg pl-7 pr-2 text-12.5 text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                />
              </div>
            )}

            <BatchCompletionNotice />

            {sortedRepos.length === 0 ? (
              <div className="px-3.5 py-3">
                <p className="text-12.5 text-text-secondary">
                  {searchQuery ? 'No working copies match.' : 'No working copies yet.'}
                </p>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={() => setIsAddRepoModalOpen(true)}
                    className="mt-1 text-12.5 font-medium text-accent hover:text-accent-hover transition-fast"
                  >
                    Open or check out a working copy
                  </button>
                )}
              </div>
            ) : (
              <WorkingCopyList
                sections={sections}
                overview={overview}
                currentPath={activeRepo ?? currentPath}
                contextMenuRepo={contextMenu?.repo ?? null}
                isPinned={isPinned}
                groups={groupsController}
                ui={sidebarUi}
                onOpen={(r) => void addRecentRepo(r)}
                onMenu={openContextMenu}
              />
            )}

            {/* ── Bookmarks ── */}
            {(filteredBookmarks.length > 0 || canBookmarkCurrentPath) && (
              <>
                <RailSection
                  title="Bookmarks"
                  action={
                    canBookmarkCurrentPath ? (
                      <button
                        type="button"
                        onClick={() =>
                          void addBookmark(currentPath, describeRepo(currentPath).name)
                        }
                        className={RAIL_ACTION_CLASS}
                        title="Bookmark this location"
                        aria-label="Bookmark this location"
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : undefined
                  }
                />
                <div className="space-y-px px-2">
                  {filteredBookmarks.map((bookmark) => (
                    <RailLinkRow
                      key={bookmark.path}
                      path={bookmark.path}
                      icon={<Star />}
                      label={bookmark.name}
                      detail={shortenPath(bookmark.path)}
                      detailTitle={bookmark.path}
                      isActive={currentPath === bookmark.path}
                      trailing={
                        <button
                          type="button"
                          onClick={() => void removeBookmark(bookmark.path)}
                          className="btn-icon-sm absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus:opacity-100"
                          aria-label={`Remove bookmark ${bookmark.name}`}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {/* ── More: shelves, problems, disk and recent locations, folded by default ── */}
            <div className="mt-3 border-t border-border pt-1">
              <button
                type="button"
                onClick={toggleMore}
                aria-expanded={moreOpen}
                aria-controls="sidebar-more"
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-3.5 text-left text-11.5 font-medium text-text-muted transition-fast hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                data-testid="sidebar-more-toggle"
              >
                <ChevronRight
                  className={`h-3 w-3 flex-shrink-0 transition-transform ${moreOpen ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">Shelves, problems &amp; recent</span>
              </button>
              {moreOpen && (
                <div id="sidebar-more">
                {shouldLoadSidebarInsights(collapsed, railIsIdle) && (
                  <Suspense fallback={null}>
                    <SidebarInsights
                      recentRepos={recentRepos}
                      overview={overview}
                      searchQuery={searchQuery}
                      activeRepo={activeRepo}
                      showFolderSizes={settings?.showFolderSizes ?? false}
                      onOpenShelves={setShelvesFor}
                    />
                  </Suspense>
                )}

                {/* ── Recent locations ── */}
                {filteredRecentPaths.length > 0 && (
                  <>
                    <RailSection title="Recent locations" />
                    <div className="space-y-px px-2">
                      {filteredRecentPaths.map((path) => (
                        <RailLinkRow
                          key={path}
                          path={path}
                          icon={<Clock />}
                          label={shortenPath(path)}
                          detailTitle={path}
                          isActive={currentPath === path}
                        />
                      ))}
                    </div>
                  </>
                )}
                </div>
              )}
            </div>
          </nav>

          {/* Footer — settings only; collapse lives in the top bar beside the location. */}
          <div className="flex-shrink-0 border-t border-border p-2">
            <button
              type="button"
              onPointerEnter={() => void loadSettingsDialog()}
              onFocus={() => void loadSettingsDialog()}
              onClick={openSettings}
              className={`${railRowClass(false)} w-full`}
              data-testid="settings-button"
            >
              <Settings className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" aria-hidden="true" />
              <span className="flex-1 truncate text-left">Settings</span>
            </button>
          </div>
        </aside>
      )}

      {/* Repository context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Repository actions"
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && setContextMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              handleOpenRepo(contextMenu.repo);
              setContextMenu(null);
            }}
            className="context-menu-item w-full"
          >
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const path = contextMenu.repo;
              setContextMenu(null);
              void addRecentRepo(path).then(() => {
                openTab(path);
                navigate({ to: '/files', search: { path } });
              });
            }}
            className="context-menu-item w-full"
          >
            <PanelTop className="w-4 h-4" aria-hidden="true" />
            Open in new tab
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleOpenInOS(contextMenu.repo)}
            className="context-menu-item w-full"
          >
            <ExternalLink className="w-4 h-4" />
            Reveal in file manager
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              togglePin(contextMenu.repo);
              setContextMenu(null);
            }}
            className="context-menu-item w-full"
          >
            {isPinned(contextMenu.repo) ? (
              <>
                <PinOff className="w-4 h-4" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="w-4 h-4" />
                Pin to top
              </>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleManageCredentials}
            className="context-menu-item w-full"
          >
            <Key className="w-4 h-4" />
            Manage credentials
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void updatePaths([contextMenu.repo]);
              setContextMenu(null);
            }}
            className="context-menu-item w-full"
            data-testid="context-update-now"
          >
            <RefreshCw className="w-4 h-4" />
            Update now
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => openDiskUsage(contextMenu.repo)}
            className="context-menu-item w-full"
            data-testid="context-disk-usage"
          >
            <HardDrive className="w-4 h-4" />
            Disk usage…
          </button>
          {overview.get(contextMenu.repo)?.presence === 'none' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => openRelink(contextMenu.repo)}
              className="context-menu-item w-full"
              data-testid="context-relink"
            >
              <Unlink className="w-4 h-4" />
              Relink working copy…
            </button>
          )}
          {groupsController.state.groups.length > 0 && (
            <>
              <div className="context-menu-divider" />
              {groupsController.state.groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    groupsController.assign(contextMenu.repo, group.id);
                    setContextMenu(null);
                  }}
                  className="context-menu-item w-full pl-7"
                >
                  <span className="truncate">{group.name}</span>
                </button>
              ))}
              {groupsController.state.assignments[contextMenu.repo] && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    groupsController.assign(contextMenu.repo, null);
                    setContextMenu(null);
                  }}
                  className="context-menu-item w-full pl-7"
                >
                  <X className="w-4 h-4" />
                  No group
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void handleCreateGroup(contextMenu.repo);
                  setContextMenu(null);
                }}
                className="context-menu-item w-full pl-7"
              >
                <FolderPlus className="w-4 h-4" />
                New group…
              </button>
            </>
          )}
          <div className="context-menu-divider" />
          <button
            type="button"
            role="menuitem"
            onClick={() => handleRemoveRepo(contextMenu.repo)}
            className="context-menu-item context-menu-item-danger w-full"
          >
            <Trash2 className="w-4 h-4" />
            Remove from list
          </button>
        </div>
      )}

      {/* Add Repo Modal */}
      {isAddRepoModalOpen && (
        <Suspense fallback={null}>
          <AddRepoModal
            isOpen={isAddRepoModalOpen}
            onClose={() => setIsAddRepoModalOpen(false)}
            onOpenRepo={(path) => {
              setIsAddRepoModalOpen(false);
              handleOpenRepo(path);
            }}
            onImport={() => {
              setIsAddRepoModalOpen(false);
              setIsImportDialogOpen(true);
            }}
            recentRepos={recentRepos}
          />
        </Suspense>
      )}

      {/* Settings Dialog */}
      {isSettingsDialogOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            isOpen={isSettingsDialogOpen}
            onClose={() => setIsSettingsDialogOpen(false)}
            initialTab={settingsTab}
          />
        </Suspense>
      )}

      {/* Shelf manager for one working copy */}
      {shelvesFor && (
        <Suspense fallback={null}>
          <ShelveDialog
            isOpen={true}
            onClose={() => setShelvesFor(null)}
            workingCopyPath={shelvesFor}
          />
        </Suspense>
      )}

      {/* Import Dialog */}
      {isImportDialogOpen && (
        <Suspense fallback={null}>
          <ImportDialog
            isOpen={isImportDialogOpen}
            onClose={() => setIsImportDialogOpen(false)}
            initialPath={currentPath}
          />
        </Suspense>
      )}

      {/* Relink flow for a working copy whose folder went missing (#60) */}
      {relinkFor && (
        <Suspense fallback={null}>
          <RelinkDialog
            isOpen={true}
            onClose={() => setRelinkFor(null)}
            oldPath={relinkFor}
            expected={{
              url: overview.get(relinkFor)?.info?.url,
              repositoryRoot: overview.get(relinkFor)?.info?.repositoryRoot,
            }}
            onApplied={handleRelinkApplied}
          />
        </Suspense>
      )}

      {/* Pristine-store disk usage for one working copy (#61) */}
      {diskUsageFor && (
        <Suspense fallback={null}>
          <DiskUsagePanel
            isOpen={true}
            onClose={() => setDiskUsageFor(null)}
            workingCopyPath={diskUsageFor}
          />
        </Suspense>
      )}
    </>
  );
}
