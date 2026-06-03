import { lazy, Suspense, useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ExternalLink,
  FolderGit2,
  FolderOpen,
  History,
  Key,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';

import { m, useMotionEnabled, variants } from '../lib/motion';
import { RepoRow } from './sidebar/RepoRow';
import { usePinnedRepos } from './sidebar/sidebarData';
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

function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

export function Sidebar() {
  const { settings, addRecentRepo, removeRecentRepo } = useSettings();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const motionEnabled = useMotionEnabled();

  const currentPath = (routerState.location.search as { path?: string })?.path || '';
  const currentPathWithDefault = currentPath || '/';

  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: string } | null>(
    null
  );

  const { isPinned, togglePin } = usePinnedRepos();

  const recentRepos = settings?.recentRepositories || [];
  const filteredRepos = searchQuery
    ? recentRepos.filter((repo) => repo.toLowerCase().includes(searchQuery.toLowerCase()))
    : recentRepos;
  // Pinned repos float to the top (stable within each group).
  const sortedRepos = [...filteredRepos].sort(
    (a, b) => Number(isPinned(b)) - Number(isPinned(a))
  );

  // The recent repo that contains the current path, if any (drives the panel).
  const activeRepo = recentRepos.find(
    (repo) => currentPath === repo || currentPath.startsWith(repo + '/')
  );

  // Preload the settings dialog when the app is idle.
  useEffect(() => runWhenIdle(() => void loadSettingsDialog()), []);

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

  return (
    <>
      <aside className="w-[--sidebar-width] bg-bg-secondary/70 border-r border-border flex flex-col overflow-hidden">
        {/* Search + add */}
        <div className="flex items-center gap-2 px-3 pt-3.5 pb-2">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent transition-fast" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories…"
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

        {/* Primary navigation */}
        <nav className="px-1.5 pb-1">
          <Link
            to="/files"
            search={{ path: currentPathWithDefault }}
            className="tree-item"
            activeProps={{ className: 'tree-item-active' }}
          >
            <FolderOpen className="w-4 h-4" />
            <span>Files</span>
          </Link>
          <Link
            to="/history"
            search={{ path: currentPathWithDefault }}
            className="tree-item"
            activeProps={{ className: 'tree-item-active' }}
          >
            <History className="w-4 h-4" />
            <span>History</span>
          </Link>
        </nav>

        {/* Active working copy context */}
        {activeRepo && <WorkingCopyPanel repoPath={activeRepo} />}

        {/* Repositories header */}
        <div className="mt-1 px-3.5 pt-2.5 pb-1.5 flex items-center justify-between border-t border-border-muted">
          <span className="text-2xs font-semibold text-text-muted uppercase tracking-[0.12em]">
            Repositories
          </span>
          {recentRepos.length > 0 && (
            <span className="text-2xs font-medium text-text-muted tabular-nums px-1.5 py-0.5 rounded-md bg-bg-tertiary/70">
              {recentRepos.length}
            </span>
          )}
        </div>

        {/* Repository list */}
        <div className="flex-1 overflow-y-auto scrollbar-overlay px-1.5 pb-2">
          {filteredRepos.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-bg-tertiary/70 flex items-center justify-center mx-auto mb-3">
                <FolderGit2 className="w-6 h-6 text-text-faint" />
              </div>
              <p className="text-sm text-text-secondary mb-1">
                {searchQuery ? 'No matches' : 'No repositories yet'}
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
              className="space-y-0.5"
              variants={variants.staggerList}
              initial={motionEnabled ? 'initial' : false}
              animate="animate"
            >
              {sortedRepos.map((repo) => (
                <RepoRow
                  key={repo}
                  repo={repo}
                  isActive={currentPath === repo || currentPath.startsWith(repo + '/')}
                  isPinned={isPinned(repo)}
                  isMenuOpen={contextMenu?.repo === repo}
                  onOpen={(r) => void addRecentRepo(r)}
                  onMenu={openContextMenu}
                />
              ))}
            </m.div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onPointerEnter={() => void loadSettingsDialog()}
            onFocus={() => void loadSettingsDialog()}
            onClick={openSettings}
            className="tree-item w-full"
            data-testid="settings-button"
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Repository context menu */}
      {contextMenu && (
        <div
          role="menu"
          aria-label="Repository actions"
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && setContextMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleOpenRepo(contextMenu.repo)}
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
