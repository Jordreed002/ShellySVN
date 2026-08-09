import { lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, PanelLeft, Search, StickyNote } from 'lucide-react';
import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';

import { useSettings } from '@renderer/hooks/useSettings';
import { useVisualSettings } from '@renderer/hooks/useVisualSettings';

import { RepositoryPillButton } from './layout/RepositoryPillButton';
import { describeRepositoryPill } from './layout/repositoryPill';
import { ShellMark } from './ShellMark';
import { GlobalBatchProgress } from '@renderer/features/working-copy-command-center/GlobalBatchProgress';

const Sidebar = lazy(() => import('./Sidebar').then((mod) => ({ default: mod.Sidebar })));
const StatusBar = lazy(() => import('./ui/StatusBar').then((mod) => ({ default: mod.StatusBar })));
const UpdateBanner = lazy(() =>
  import('./ui/UpdateBanner').then((mod) => ({ default: mod.UpdateBanner }))
);
const RepositoryPillControl = lazy(() =>
  import('./layout/RepositoryPillControl').then((mod) => ({ default: mod.RepositoryPillControl }))
);
const TitlebarControls = lazy(() =>
  import('./layout/TitlebarControls').then((mod) => ({ default: mod.TitlebarControls }))
);

const OnboardingController = lazy(() =>
  import('./tutorial/OnboardingController').then((mod) => ({ default: mod.OnboardingController }))
);

const CommandPaletteController = lazy(() =>
  import('./ui/CommandPaletteController').then((m) => ({ default: m.CommandPaletteController }))
);
const ShellDialogs = lazy(() =>
  import('./ui/ShellDialogs').then((m) => ({ default: m.ShellDialogs }))
);
const AiReviewCenter = lazy(() =>
  import('@renderer/features/ai-review-center/AiReviewCenter').then((m) => ({
    default: m.AiReviewCenter,
  }))
);

/**
 * Common search params shared across routes
 */
interface CommonSearchSchema {
  path?: string;
  url?: string;
  localPath?: string;
}

interface LayoutProps {
  children: ReactNode;
}

/**
 * `.ibtn` from the prototype: a 32px square ghost control that fills in on hover
 * and adopts the accent when it represents an "on" state.
 */
const ICON_BUTTON_BASE =
  'titlebar-no-drag w-8 h-8 grid place-items-center rounded-lg border transition-fast';
const ICON_BUTTON_IDLE =
  'bg-transparent border-transparent text-text-secondary hover:bg-bg-tertiary hover:border-border hover:text-text';
const ICON_BUTTON_ON = 'bg-accent/10 border-accent/40 text-accent';

function iconButtonClass(active = false): string {
  return `${ICON_BUTTON_BASE} ${active ? ICON_BUTTON_ON : ICON_BUTTON_IDLE}`;
}

/** Open the settings dialog (owned by the sidebar, reached by event). */
function openSettings(): void {
  window.dispatchEvent(new CustomEvent('shellysvn:open-settings'));
}

export function SidebarFallback() {
  return (
    <aside
      className="h-full border-r border-border bg-bg-secondary/70 px-3 py-4"
      aria-label="Loading sidebar"
      aria-busy="true"
    >
      <div className="mb-5 h-8 animate-pulse rounded-lg bg-bg-tertiary/70" />
      <div className="space-y-2" aria-hidden="true">
        <div className="h-7 animate-pulse rounded-md bg-bg-tertiary/55" />
        <div className="h-7 animate-pulse rounded-md bg-bg-tertiary/45" />
        <div className="h-7 animate-pulse rounded-md bg-bg-tertiary/35" />
      </div>
    </aside>
  );
}

export function StatusBarFallback() {
  return (
    <div
      className="h-control-sm flex-shrink-0 border-t border-border bg-bg-secondary"
      aria-hidden="true"
    />
  );
}

export function Layout({ children }: LayoutProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showPerformanceDashboard, setShowPerformanceDashboard] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showAiReviewCenter, setShowAiReviewCenter] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isMac = navigator.platform.toLowerCase().includes('mac');
  const isWindows = navigator.platform.toLowerCase().includes('win');

  const routerState = useRouterState();
  const search = routerState.location.search as CommonSearchSchema;
  const currentPath = search?.path;
  const browsedUrl = search?.url;
  const recentRepositories = useMemo(
    () => settings.recentRepositories || [],
    [settings.recentRepositories]
  );

  // Repository pill — the working copy the current location belongs to. The
  // repository browser carries its checkout in `localPath`, so honour that too.
  const workingCopyPath = useMemo(() => {
    if (search?.localPath) return search.localPath;
    if (!currentPath) return undefined;
    return recentRepositories.find(
      (repo) => currentPath === repo || currentPath.startsWith(repo + '/')
    );
  }, [currentPath, search?.localPath, recentRepositories]);
  const repositoryPillFallback = describeRepositoryPill({ workingCopyPath, browsedUrl });

  useVisualSettings(settings);

  // Mirror the theme `useVisualSettings` actually applied, so the top-bar toggle
  // shows the right icon even when the preference is "system".
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () => {
      const theme = settings?.theme;
      setIsDarkTheme(!theme || theme === 'system' ? media.matches : theme === 'dark');
    };
    resolve();
    media.addEventListener('change', resolve);
    return () => media.removeEventListener('change', resolve);
  }, [settings?.theme]);

  useEffect(() => {
    const refreshMaximizedState = () => {
      void window.api.app.window.isMaximized().then(setIsMaximized);
    };
    refreshMaximizedState();
    window.addEventListener('resize', refreshMaximizedState);
    return () => window.removeEventListener('resize', refreshMaximizedState);
  }, []);

  useEffect(() => {
    const subscribe = window.api.svn.onMutation;
    if (typeof subscribe !== 'function') {
      return undefined;
    }

    return subscribe((notification) => {
      void import('@renderer/utils/mutationInvalidation').then(({ invalidateAfterSvnMutation }) =>
        invalidateAfterSvnMutation(queryClient, notification)
      );
    });
  }, [queryClient]);

  useEffect(() => {
    const handleCacheCleared = () => {
      queryClient.removeQueries({
        predicate: ({ queryKey }) => {
          const scope = String(queryKey[0] || '');
          return (
            scope.startsWith('svn:') ||
            scope.startsWith('sidebar:') ||
            scope.startsWith('fs:') ||
            scope === 'repo-browser' ||
            scope === 'repo:list' ||
            scope === 'branches'
          );
        },
      });
    };
    window.addEventListener('svn-cache-cleared', handleCacheCleared);
    return () => window.removeEventListener('svn-cache-cleared', handleCacheCleared);
  }, [queryClient]);

  // Restore the persisted sidebar collapsed state
  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get<boolean>('shellysvn:sidebar-collapsed')
      .then((value) => {
        if (!cancelled && typeof value === 'boolean') setSidebarCollapsed(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      void window.api.store.set('shellysvn:sidebar-collapsed', next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette: ⌘K / Ctrl+K (the advertised shortcut) and Ctrl/Cmd+Shift+P.
      // Don't hijack ⌘K while typing in a text field.
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'k' &&
        !isTyping
      ) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowAiReviewCenter((previous) => !previous);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPerformanceDashboard((prev) => !prev);
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setShowShortcuts(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  useEffect(() => {
    const open = () => setShowAiReviewCenter(true);
    window.addEventListener(REVIEW_CENTER_OPEN_EVENT, open);
    return () => window.removeEventListener(REVIEW_CENTER_OPEN_EVENT, open);
  }, []);

  const handleGoToPath = (targetPath: string) => {
    navigate({ to: '/files', search: { path: targetPath } });
  };

  const handleMinimize = () => {
    window.api.app.window.minimize();
  };

  const handleMaximize = async () => {
    await window.api.app.window.maximize();
    const maximized = await window.api.app.window.isMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = () => {
    window.api.app.window.close();
  };

  const handleToggleTheme = () => {
    void updateSettings({ theme: isDarkTheme ? 'light' : 'dark' });
  };

  const accountName = settings.savedCredentials?.[0]?.username ?? '';
  return (
    <div className="flex flex-col h-screen shell-backdrop text-text overflow-hidden">
      {/* Top bar — prototype `.top`: brand · repository pill · search · controls */}
      <header
        className={`relative z-20 h-[50px] flex-shrink-0 flex items-center gap-[13px] px-3.5 bg-bg-secondary border-b border-border shadow-card titlebar-drag ${
          isMac ? 'pl-[92px]' : ''
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 flex-shrink-0 select-none">
          <ShellMark className="w-[21px] h-[21px] text-accent" />
          <span className="text-[14.5px] font-bold tracking-[-0.025em] leading-none">
            Shelly<span className="text-accent">SVN</span>
          </span>
        </div>

        {/* Repository pill */}
        <Suspense
          fallback={
            <RepositoryPillButton
              pill={repositoryPillFallback}
              onActivate={() => setShowCommandPalette(true)}
              busy
            />
          }
        >
          <RepositoryPillControl
            workingCopyPath={workingCopyPath}
            browsedUrl={browsedUrl}
            recentRepositories={recentRepositories}
            onActivate={() => setShowCommandPalette(true)}
          />
        </Suspense>

        {/* Centred search — a button that opens the command palette */}
        <button
          type="button"
          onClick={() => setShowCommandPalette(true)}
          className="titlebar-no-drag group flex-1 min-w-0 max-w-[470px] mx-auto h-[34px] flex items-center gap-2.5 px-3 rounded-[9px] bg-bg border border-border hover:border-border-strong text-[13px] text-text-muted cursor-text transition-fast"
          aria-label="Run a command — opens the command palette"
          aria-keyshortcuts="Meta+K Control+K"
          title="Run a command (⌘K)"
        >
          <Search
            className="w-[15px] h-[15px] flex-shrink-0 group-hover:text-text-secondary transition-fast"
            aria-hidden="true"
          />
          <span className="flex-1 min-w-0 truncate text-left">Run a command</span>
          <span className="kbd flex-shrink-0" aria-hidden="true">
            ⌘K
          </span>
        </button>

        {/* Right: controls + window controls */}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0 titlebar-no-drag">
          <button
            type="button"
            onClick={toggleSidebar}
            className={iconButtonClass(!sidebarCollapsed)}
            aria-pressed={!sidebarCollapsed}
            aria-label="Toggle the sidebar"
            title="Sidebar (⌘B)"
          >
            <PanelLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            className={iconButtonClass(showNotes)}
            aria-pressed={showNotes}
            aria-label="Quick notes"
            title="Quick notes"
          >
            <StickyNote className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setShowAiReviewCenter((previous) => !previous)}
            className={iconButtonClass(showAiReviewCenter)}
            aria-pressed={showAiReviewCenter}
            aria-label="AI Review Center"
            aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
            title="AI Review Center (⌘⇧A)"
          >
            <BrainCircuit className="w-4 h-4" aria-hidden="true" />
          </button>

          <Suspense
            fallback={
              <div className={isWindows ? 'h-8 w-[238px]' : 'h-8 w-[102px]'} aria-hidden="true" />
            }
          >
            <TitlebarControls
              isWindows={isWindows}
              isMaximized={isMaximized}
              isDarkTheme={isDarkTheme}
              accountName={accountName}
              onToggleTheme={handleToggleTheme}
              onOpenSettings={openSettings}
              onMinimize={handleMinimize}
              onMaximize={() => void handleMaximize()}
              onClose={handleClose}
            />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={null}>
        <UpdateBanner />
      </Suspense>

      <GlobalBatchProgress />

      {/* Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        <div
          className="h-full flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
          style={{ width: sidebarCollapsed ? 56 : (settings?.sidebarWidth ?? 260) }}
        >
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
          </Suspense>
        </div>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 min-w-0">
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
          </div>
          <Suspense fallback={settings?.showStatusBar ? <StatusBarFallback /> : null}>
            <StatusBar />
          </Suspense>
        </main>
      </div>

      {(showShortcuts || showNotes || showPerformanceDashboard || showPluginManager) && (
        <Suspense fallback={null}>
          <ShellDialogs
            currentPath={currentPath}
            showShortcuts={showShortcuts}
            showNotes={showNotes}
            showPerformanceDashboard={showPerformanceDashboard}
            showPluginManager={showPluginManager}
            onCloseShortcuts={() => setShowShortcuts(false)}
            onCloseNotes={() => setShowNotes(false)}
            onClosePerformanceDashboard={() => setShowPerformanceDashboard(false)}
            onClosePluginManager={() => setShowPluginManager(false)}
          />
        </Suspense>
      )}

      {/* Onboarding Tutorial */}
      <Suspense fallback={null}>
        <OnboardingController />
      </Suspense>

      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPaletteController
            onClose={() => setShowCommandPalette(false)}
            currentPath={currentPath}
            recentPaths={settings.recentPaths}
            bookmarks={settings.bookmarks}
            onGoToPath={handleGoToPath}
            onOpenSettings={() => {
              setShowCommandPalette(false);
              window.dispatchEvent(new CustomEvent('shellysvn:open-settings'));
            }}
            onShowShortcuts={() => {
              setShowCommandPalette(false);
              setShowShortcuts(true);
            }}
            onShowNotes={() => {
              setShowCommandPalette(false);
              setShowNotes(true);
            }}
            onManagePlugins={() => {
              setShowCommandPalette(false);
              setShowPluginManager(true);
            }}
          />
        </Suspense>
      )}

      {showAiReviewCenter && (
        <Suspense fallback={null}>
          <AiReviewCenter
            workingCopyPath={workingCopyPath}
            onClose={() => setShowAiReviewCenter(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
