import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Bookmark,
  FileText,
  Folder,
  Globe,
  HardDrive,
  History,
  Home,
  Key,
  Loader2,
  Monitor,
  Plus,
  Puzzle,
  Search,
  Settings,
} from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';

import type { SettingsTab } from './ui/SettingsDialog';

const AddRepoModal = lazy(() =>
  import('./ui/AddRepoModal').then((m) => ({ default: m.AddRepoModal }))
);
const BookmarksManager = lazy(() =>
  import('./ui/BookmarksManager').then((m) => ({ default: m.BookmarksManager }))
);
const CertificateManagerDialog = lazy(() =>
  import('./ui/CertificateManagerDialog').then((m) => ({
    default: m.CertificateManagerDialog,
  }))
);
const ImportDialog = lazy(() =>
  import('./ui/ImportDialog').then((m) => ({ default: m.ImportDialog }))
);
const PluginManagerDialog = lazy(() =>
  import('./ui/PluginManagerDialog').then((m) => ({ default: m.PluginManagerDialog }))
);
const SettingsDialog = lazy(() =>
  import('./ui/SettingsDialog').then((m) => ({ default: m.SettingsDialog }))
);
const RepositorySection = lazy(() =>
  import('./sidebar/RepositorySection').then((m) => ({ default: m.RepositorySection }))
);

interface QuickAccessItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

export function Sidebar() {
  const { settings, addRecentRepo, removeRecentRepo, addBookmark, removeBookmark } = useSettings();
  const navigate = useNavigate();
  const routerState = useRouterState();

  // Safely get the path from search params
  const currentPath = (routerState.location.search as { path?: string })?.path || '';

  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickAccess, setQuickAccess] = useState<QuickAccessItem[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isBookmarksManagerOpen, setIsBookmarksManagerOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isPluginManagerOpen, setIsPluginManagerOpen] = useState(false);
  const [isCertificateManagerOpen, setIsCertificateManagerOpen] = useState(false);
  const [drives, setDrives] = useState<import('@shared/types').FileInfo[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);

  const recentRepos = settings?.recentRepositories || [];
  const bookmarks = settings?.bookmarks || [];

  const isWindows = navigator.platform.toLowerCase().startsWith('win');
  const currentPathWithDefault = currentPath || '/';

  // Load drives on Windows
  useEffect(() => {
    if (!isWindows) return;

    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      void (async () => {
        setLoadingDrives(true);
        try {
          const driveList = await window.api.fs.listDrives();
          if (!cancelled) setDrives(driveList);
        } catch (err) {
          console.error('Failed to load drives:', err);
        } finally {
          if (!cancelled) setLoadingDrives(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [isWindows]);

  // Load quick access locations
  useEffect(() => {
    const loadQuickAccess = async () => {
      const items: QuickAccessItem[] = [];

      // Get common paths
      try {
        const homePath = await window.api.app.getPath('home');
        items.push({ name: 'Home', path: homePath, icon: Home });
      } catch {}

      try {
        const desktopPath = await window.api.app.getPath('desktop');
        items.push({ name: 'Desktop', path: desktopPath, icon: Monitor });
      } catch {}

      try {
        const docsPath = await window.api.app.getPath('documents');
        items.push({ name: 'Documents', path: docsPath, icon: FileText });
      } catch {}

      // Add drives (Windows) or root (Mac/Linux)
      if (!isWindows) {
        // On Mac/Linux, add root
        items.push({ name: 'Root', path: '/', icon: HardDrive });
      }
      // Note: On Windows, drives are shown separately below Quick Access

      setQuickAccess(items);
    };

    loadQuickAccess();
  }, [isWindows]);

  useEffect(() => {
    if (!settings?.recentRepositories?.length) return;

    let cancelled = false;
    const cleanupMissingRepos = async () => {
      const repos = settings?.recentRepositories || [];
      if (repos.length === 0) return;

      const existenceChecks: Array<{ repo: string; exists: boolean }> = [];
      for (const repo of repos) {
        if (cancelled) return;
        existenceChecks.push({
          repo,
          exists: await window.api.fs.exists(repo),
        });
      }

      const missingRepos = existenceChecks.filter(({ exists }) => !exists).map(({ repo }) => repo);
      if (missingRepos.length > 0) {
        for (const repo of missingRepos) {
          if (cancelled) return;
          await removeRecentRepo(repo);
        }
      }
    };

    const cancelIdle = runWhenIdle(() => {
      void cleanupMissingRepos();
    }, 3000);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [settings?.recentRepositories, removeRecentRepo]);

  // Handler for opening a repo - saves to recent and navigates
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
    },
    [removeRecentRepo]
  );

  const handleManageCredentials = useCallback(() => {
    setSettingsTab('auth');
    setIsSettingsDialogOpen(true);
  }, []);

  return (
    <>
      <aside className="w-[--sidebar-width] bg-bg-secondary border-r border-border flex flex-col overflow-hidden">
        {/* Add Repo Button */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Repositories
          </span>
          <button
            type="button"
            onClick={() => setIsAddRepoModalOpen(true)}
            className="btn-icon-sm"
            title="Add Repository"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-bg-tertiary border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent transition-fast"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scrollbar-overlay">
          {/* Quick Access */}
          <div className="py-2">
            <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
              Quick Access
            </div>
            {quickAccess.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.path;
              return (
                <Link
                  key={item.path}
                  to="/files"
                  search={{ path: item.path }}
                  className={`tree-item ${isActive ? 'tree-item-active' : ''}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>

          {/* Drives Section (Windows only) */}
          {isWindows && (
            <div className="py-2 border-t border-border">
              <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
                This PC
              </div>
              {loadingDrives ? (
                <div className="px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
                  <span className="text-xs text-text-muted">Loading drives...</span>
                </div>
              ) : drives.length > 0 ? (
                drives.map((drive) => {
                  const isActive = currentPath === drive.path;
                  return (
                    <Link
                      key={drive.path}
                      to="/files"
                      search={{ path: drive.path }}
                      className={`tree-item ${isActive ? 'tree-item-active' : ''}`}
                    >
                      <HardDrive className="w-4 h-4" />
                      <span className="truncate">{drive.name}</span>
                    </Link>
                  );
                })
              ) : (
                <div className="px-3 py-2 text-xs text-text-muted">No drives found</div>
              )}
            </div>
          )}

          {/* Main Navigation */}
          <div className="py-2 border-t border-border">
            <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
              Browse
            </div>
            <Link
              to="/files"
              search={{ path: currentPathWithDefault }}
              className="tree-item"
              activeProps={{ className: 'tree-item-active' }}
            >
              <Folder className="w-4 h-4" />
              <span>File Explorer</span>
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
            <Link
              to="/repo-browser"
              search={{ url: '' }}
              className="tree-item"
              activeProps={{ className: 'tree-item-active' }}
            >
              <Globe className="w-4 h-4" />
              <span>Repo Browser</span>
            </Link>
          </div>

          {/* Bookmarks Section */}
          {bookmarks.length > 0 && (
            <div className="border-t border-border py-2">
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">
                  Bookmarks
                </span>
                <button
                  type="button"
                  onClick={() => setIsBookmarksManagerOpen(true)}
                  className="btn-icon-sm p-0.5"
                  title="Manage Bookmarks"
                >
                  <Bookmark className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-0.5">
                {bookmarks.slice(0, 5).map((bookmark) => (
                  <Link
                    key={bookmark.path}
                    to="/files"
                    search={{ path: bookmark.path }}
                    className={`tree-item ${currentPath === bookmark.path ? 'tree-item-active' : ''}`}
                  >
                    <Bookmark className="w-4 h-4" />
                    <span className="truncate">{bookmark.name}</span>
                  </Link>
                ))}
                {bookmarks.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setIsBookmarksManagerOpen(true)}
                    className="w-full text-left px-6 py-1 text-xs text-text-muted hover:text-text transition-fast"
                  >
                    +{bookmarks.length - 5} more...
                  </button>
                )}
              </div>
            </div>
          )}

          <Suspense fallback={<RepositorySectionSkeleton recentRepos={recentRepos.length} />}>
            <RepositorySection
              recentRepos={recentRepos}
              currentPath={currentPath}
              searchQuery={searchQuery}
              onAddRepository={() => setIsAddRepoModalOpen(true)}
              onRemoveRepository={handleRemoveRepo}
              onManageCredentials={handleManageCredentials}
            />
          </Suspense>
        </nav>

        {/* Status Bar */}
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {recentRepos.length} repositor{recentRepos.length === 1 ? 'y' : 'ies'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCertificateManagerOpen(true)}
                className="hover:text-text transition-fast"
                title="Certificates"
              >
                <Key className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsPluginManagerOpen(true)}
                className="hover:text-text transition-fast"
                title="Plugins"
              >
                <Puzzle className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsSettingsDialogOpen(true)}
                className="hover:text-text transition-fast"
                data-testid="settings-button"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

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

      {/* Bookmarks Manager */}
      {isBookmarksManagerOpen && (
        <Suspense fallback={null}>
          <BookmarksManager
            isOpen={isBookmarksManagerOpen}
            onClose={() => setIsBookmarksManagerOpen(false)}
            bookmarks={bookmarks}
            onAddBookmark={(path, name) => addBookmark(path, name)}
            onRemoveBookmark={(path) => removeBookmark(path)}
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

      {/* Plugin Manager Dialog */}
      {isPluginManagerOpen && (
        <Suspense fallback={null}>
          <PluginManagerDialog
            isOpen={isPluginManagerOpen}
            onClose={() => setIsPluginManagerOpen(false)}
          />
        </Suspense>
      )}

      {/* Certificate Manager Dialog */}
      {isCertificateManagerOpen && (
        <Suspense fallback={null}>
          <CertificateManagerDialog
            isOpen={isCertificateManagerOpen}
            onClose={() => setIsCertificateManagerOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

function RepositorySectionSkeleton({ recentRepos }: { recentRepos: number }) {
  return (
    <div className="border-t border-border py-2">
      <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
        SVN Repositories
      </div>
      <div className="space-y-1 px-3">
        {Array.from({ length: Math.min(Math.max(recentRepos, 1), 4) }).map((_, index) => (
          <div key={index} className="h-7 rounded bg-bg-tertiary/60 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
