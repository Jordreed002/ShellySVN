import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Clock,
  Database,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  Globe,
  History,
  Home,
  Key,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useHomePath } from '@renderer/hooks/useHomePath';

import { m, useMotionEnabled, variants } from '../lib/motion';
import {
  RailLinkRow,
  RailSection,
  RepoRailItem,
  railRowClass,
  WorkingCopyRow,
} from './sidebar/RepoRow';
import {
  collectRepositoryRoots,
  describeRepo,
  shortenPath,
  useWorkingCopyOverview,
} from './sidebar/workingCopyOverview';
import { usePinnedRepos } from './sidebar/pinnedRepositories';
import { shouldLoadSidebarInsights } from './sidebar/sidebarInsightsGate';
import { WorkingCopyPanel } from './sidebar/WorkingCopyPanel';
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
  const motionEnabled = useMotionEnabled();

  const currentPath = (routerState.location.search as { path?: string })?.path || '';
  const currentPathWithDefault = currentPath || '/';
  const pathname = routerState.location.pathname;
  const homePath = useHomePath();

  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  const { isPinned, togglePin } = usePinnedRepos();

  const recentRepos = settings?.recentRepositories || [];
  const bookmarks = settings?.bookmarks || [];
  const recentPaths = settings?.recentPaths || [];

  const matchesSearch = useCallback(
    (value: string) => !searchQuery || value.toLowerCase().includes(searchQuery.toLowerCase()),
    [searchQuery]
  );

  const filteredRepos = recentRepos.filter((repo) => matchesSearch(repo));
  // Pinned repos float to the top (stable within each group).
  const sortedRepos = [...filteredRepos].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));

  // The recent repo that contains the current path, if any (drives the panel).
  const activeRepo = recentRepos.find(
    (repo) => currentPath === repo || currentPath.startsWith(repo + '/')
  );

  /* ── working-copy facts: one query feeds every row and the disk card ── */
  const overview = useWorkingCopyOverview(recentRepos);

  const repositoryRoots = collectRepositoryRoots(recentRepos, overview).filter(
    (root) => matchesSearch(root.url) || root.workingCopies.some((wc) => matchesSearch(wc))
  );
  const filteredBookmarks = bookmarks.filter(
    (bookmark) => matchesSearch(bookmark.name) || matchesSearch(bookmark.path)
  );
  const filteredRecentPaths = recentPaths
    .filter((path) => !recentRepos.includes(path) && matchesSearch(path))
    .slice(0, MAX_RECENT_LOCATIONS);

  // Offer to bookmark wherever we are, unless it is already bookmarked.
  const canBookmarkCurrentPath =
    currentPath.length > 0 && !bookmarks.some((bookmark) => bookmark.path === currentPath);

  // Preload the settings dialog when the app is idle.
  useEffect(() => runWhenIdle(() => void loadSettingsDialog()), []);

  // Nothing on first paint depends on shelves, so they wait for the same idle
  // moment rather than competing with the working-copy reads that rows need.
  useEffect(() => runWhenIdle(() => setRailIsIdle(true)), []);

  // When the rail's Search button expands the sidebar, focus the search field.
  useEffect(() => {
    if (!collapsed && pendingSearchFocus.current) {
      pendingSearchFocus.current = false;
      searchInputRef.current?.focus();
    }
  }, [collapsed]);

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

  useEffect(() => {
    if (!contextMenu) return;
    const frame = requestAnimationFrame(() => contextMenuRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextMenu]);

  useEffect(() => {
    window.addEventListener('shellysvn:open-settings', openSettings);
    return () => window.removeEventListener('shellysvn:open-settings', openSettings);
  }, [openSettings]);

  return (
    <>
      {collapsed ? (
        <aside
          className="w-[--rail-width] h-full bg-bg-secondary/70 border-r border-border flex flex-col items-center py-2 gap-1"
          aria-label="Sidebar"
          data-testid="sidebar-ready"
        >
          <button
            type="button"
            onClick={() => setIsAddRepoModalOpen(true)}
            className="rail-item"
            title="Add repository"
            aria-label="Add repository"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              pendingSearchFocus.current = true;
              onToggleCollapse?.();
            }}
            className="rail-item"
            title="Search repositories"
            aria-label="Search repositories"
          >
            <Search className="w-5 h-5" />
          </button>

          <div className="my-1 h-px w-6 bg-border" />

          <Link
            to="/"
            className="rail-item"
            activeProps={{ className: 'rail-item rail-item-active' }}
            activeOptions={{ exact: true }}
            title="Home"
            aria-label="Home"
          >
            <Home className="w-5 h-5" />
          </Link>
          <Link
            to="/files"
            search={{ path: homePath || currentPathWithDefault }}
            className="rail-item"
            activeProps={{ className: 'rail-item rail-item-active' }}
            title="Files"
            aria-label="Files"
          >
            <FolderOpen className="w-5 h-5" />
          </Link>
          <Link
            to="/repo-browser"
            search={{ url: '', localPath: undefined }}
            className="rail-item"
            activeProps={{ className: 'rail-item rail-item-active' }}
            title="Repository browser"
            aria-label="Repository browser"
          >
            <Globe className="w-5 h-5" />
          </Link>
          {activeRepo && (
            <Link
              to="/history"
              search={{ path: currentPathWithDefault }}
              className="rail-item"
              activeProps={{ className: 'rail-item rail-item-active' }}
              title="History"
              aria-label="History"
            >
              <History className="w-5 h-5" />
            </Link>
          )}

          <div className="my-1 h-px w-6 bg-border" />

          <div className="flex-1 w-full overflow-y-auto scrollbar-overlay flex flex-col items-center gap-1 py-1">
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
            onPointerEnter={() => void loadSettingsDialog()}
            onFocus={() => void loadSettingsDialog()}
            onClick={openSettings}
            className="rail-item"
            data-testid="settings-button"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rail-item"
            title="Expand sidebar (Ctrl/Cmd+B)"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        </aside>
      ) : (
        <aside
          className="w-[--sidebar-width] h-full bg-bg-secondary/70 border-r border-border flex flex-col overflow-hidden"
          aria-label="Sidebar"
          data-testid="sidebar-ready"
        >
          {/* Search + add */}
          <div className="flex items-center gap-2 px-3 pt-3.5 pb-1">
            <div className="relative flex-1 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent transition-fast" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repositories…"
                aria-label="Search repositories"
                className="w-full pl-9 pr-3 py-2 text-sm bg-bg-tertiary/60 border border-border rounded-lg text-text placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 transition-fast"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsAddRepoModalOpen(true)}
              className="btn-icon"
              title="Add repository"
              aria-label="Add repository"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <nav
            aria-label="Repositories and locations"
            className="flex-1 overflow-y-auto scrollbar-overlay pb-4"
          >
            {/* Always-available destinations. */}
            <div className="space-y-0.5 px-1.5 pt-2">
              <Link to="/" className={railRowClass(pathname === '/')}>
                <Home className="h-[15px] w-[15px] flex-shrink-0 opacity-85" />
                <span className="flex-1 truncate">Home</span>
              </Link>
              <Link
                to="/files"
                search={{ path: homePath || currentPathWithDefault }}
                className={railRowClass(pathname.startsWith('/files') && !activeRepo)}
              >
                <FolderOpen className="h-[15px] w-[15px] flex-shrink-0 opacity-85" />
                <span className="flex-1 truncate">Files</span>
              </Link>
              <Link
                to="/repo-browser"
                search={{ url: '', localPath: undefined }}
                className={railRowClass(pathname.startsWith('/repo-browser'))}
              >
                <Globe className="h-[15px] w-[15px] flex-shrink-0 opacity-85" />
                <span className="flex-1 truncate">Repository browser</span>
              </Link>
            </div>

            {/* ── Working copies ── */}
            <RailSection
              title="Working copies"
              action={
                <button
                  type="button"
                  onClick={() => setIsAddRepoModalOpen(true)}
                  className="text-text-muted hover:text-text transition-fast"
                  title="Add working copy"
                  aria-label="Add working copy"
                >
                  <Plus className="h-3 w-3" />
                </button>
              }
            />

            {sortedRepos.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-bg-tertiary/70 flex items-center justify-center mx-auto mb-3">
                  <FolderGit2 className="w-6 h-6 text-text-faint" />
                </div>
                <p className="text-sm text-text-secondary mb-1">
                  {searchQuery ? 'No matches' : 'No working copies yet'}
                </p>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={() => setIsAddRepoModalOpen(true)}
                    className="text-xs text-accent hover:text-accent-hover transition-fast"
                  >
                    Add your first repository
                  </button>
                )}
              </div>
            ) : (
              <m.div
                className="space-y-0.5 px-1.5"
                variants={variants.staggerList}
                initial={motionEnabled ? 'initial' : false}
                animate="animate"
              >
                {sortedRepos.map((repo) => {
                  const isActive = currentPath === repo || currentPath.startsWith(repo + '/');
                  const summary = overview.get(repo);
                  return (
                    <div key={repo}>
                      <WorkingCopyRow
                        repo={repo}
                        isActive={isActive}
                        isPinned={isPinned(repo)}
                        isMenuOpen={contextMenu?.repo === repo}
                        presence={summary?.presence ?? 'unknown'}
                        status={summary?.status}
                        info={summary?.info}
                        onOpen={(r) => void addRecentRepo(r)}
                        onMenu={openContextMenu}
                      />
                      {isActive && (
                        <WorkingCopyPanel
                          repoPath={repo}
                          info={summary?.info}
                          status={summary?.status}
                        />
                      )}
                    </div>
                  );
                })}
              </m.div>
            )}

            {/* ── Repository ── */}
            {repositoryRoots.length > 0 && (
              <>
                <RailSection title="Repository" />
                <div className="space-y-0.5 px-1.5">
                  {repositoryRoots.map((root) => (
                    <RailLinkRow
                      key={root.url}
                      path={root.workingCopies[0]}
                      icon={<Database />}
                      label={root.name}
                      detail={root.url}
                      count={root.workingCopies.length}
                      onSelect={() => void addRecentRepo(root.workingCopies[0])}
                    />
                  ))}
                </div>
              </>
            )}

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
                        className="text-text-muted hover:text-text transition-fast"
                        title="Bookmark this location"
                        aria-label="Bookmark this location"
                      >
                        <Star className="h-3 w-3" />
                      </button>
                    ) : undefined
                  }
                />
                <div className="space-y-0.5 px-1.5">
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
                          <X className="h-3 w-3" />
                        </button>
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {/* ── Recent locations ── */}
            {filteredRecentPaths.length > 0 && (
              <>
                <RailSection title="Recent locations" />
                <div className="space-y-0.5 px-1.5">
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
          </nav>

          {/* Footer */}
          <div className="border-t border-border p-1.5 flex items-center gap-1">
            <button
              type="button"
              onPointerEnter={() => void loadSettingsDialog()}
              onFocus={() => void loadSettingsDialog()}
              onClick={openSettings}
              className="tree-item flex-1"
              data-testid="settings-button"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="btn-icon-sm flex-shrink-0"
              title="Collapse sidebar (Ctrl/Cmd+B)"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
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
            <FolderOpen className="w-4 h-4" />
            Open
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
    </>
  );
}
