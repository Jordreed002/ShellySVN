import { lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BrainCircuit,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  StickyNote,
} from 'lucide-react';
import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';

import { useSettings } from '@renderer/hooks/useSettings';
import { useVisualSettings } from '@renderer/hooks/useVisualSettings';
import { useShortcutBindings } from '@renderer/hooks/useShortcutBindings';
import { normalizeShortcutKey, shortcutComboFromEvent } from '@renderer/lib/shortcutStore';

import { SHELL_ICON, shellIconButtonClass } from './layout/shellIconButton';
import { ariaShortcut, formatShortcut, isMacPlatform } from '@renderer/lib/platformKeys';
import { GlobalBatchProgress } from '@renderer/features/working-copy-command-center/GlobalBatchProgress';

import { TabBar } from './layout/TabBar';
import {
  NotificationCenterBell,
  NotificationCenterPanel,
  ToastStack,
} from './layout/NotificationCenter';
import { QuickActionsMenuButton } from './layout/QuickActionsMenu';
import { FolderDropZone } from './layout/DropOverlay';
import { OperationNotifications } from './layout/OperationNotifications';
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  ensureTabSessionHydrated,
  getTabSession,
  openTab,
  recordActiveTabRoute,
  useTabSession,
  type ShellTab,
} from '@renderer/lib/tabsStore';
import {
  planSessionRestore,
  type SessionRestorePlan,
} from '@renderer/lib/sessionRestore';
import {
  useDiffWizardRequest,
  useNotificationCenterOpenEvent,
  useShelfManagerOpenState,
} from '@renderer/lib/shellActions';

const Sidebar = lazy(() => import('./Sidebar').then((mod) => ({ default: mod.Sidebar })));
const StatusBar = lazy(() => import('./ui/StatusBar').then((mod) => ({ default: mod.StatusBar })));
const UpdateBanner = lazy(() =>
  import('./ui/UpdateBanner').then((mod) => ({ default: mod.UpdateBanner }))
);
const TitlebarControls = lazy(() =>
  import('./layout/TitlebarControls').then((mod) => ({ default: mod.TitlebarControls }))
);
const ShelfManagerDialog = lazy(() =>
  import('./ui/ShelfManagerDialog').then((mod) => ({ default: mod.ShelfManagerDialog }))
);
const DiffWizard = lazy(() =>
  import('./ui/DiffWizard').then((mod) => ({ default: mod.DiffWizard }))
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

const iconButtonClass = shellIconButtonClass;


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
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  /* The panel portals out of the bell's box, so it anchors to it by ref. */
  const notificationBellRef = useRef<HTMLButtonElement | null>(null);
  const [restorePlan, setRestorePlan] = useState<SessionRestorePlan | null>(null);
  const [restoreCtaDismissed, setRestoreCtaDismissed] = useState(false);
  const { settings, isLoading: settingsLoading, updateSettings, addRecentRepo } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tabSession = useTabSession();
  const diffWizard = useDiffWizardRequest();
  const shelfManager = useShelfManagerOpenState();
  useNotificationCenterOpenEvent(() => setNotificationPanelOpen(true));

  // Remappable keybindings for the global shell shortcuts (see keydown effect).
  const { bindings: shortcutBindings } = useShortcutBindings();

  const isMac = isMacPlatform();
  const isWindows = navigator.platform.toLowerCase().includes('win');

  /** Current binding for a shell shortcut, in this platform's words. */
  const shortcutFor = (id: string, fallback: string) => {
    const binding = shortcutBindings.find((candidate) => candidate.id === id);
    const key = binding?.enabled ? normalizeShortcutKey(binding.currentKey) : '';
    const canonical = key || fallback;
    return { label: formatShortcut(canonical, isMac), aria: ariaShortcut(canonical, isMac) };
  };
  const paletteShortcut = shortcutFor('command-palette-quick', 'Ctrl+K');
  const sidebarShortcut = shortcutFor('toggle-sidebar', 'Ctrl+B');
  const reviewShortcut = shortcutFor('ai-review-center', 'Ctrl+Shift+A');

  const routerState = useRouterState();
  const search = routerState.location.search as CommonSearchSchema;
  const currentPath = search?.path;
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
    // Global shell shortcuts, routed through the remappable binding registry
    // (#12) so user overrides from the customize tab take effect app-wide.
    // With no overrides the resolved bindings equal the defaults, preserving
    // the original hardcoded behaviour exactly (⌘K / ⌘⇧P palette, ⌘B sidebar,
    // ⌘⇧A AI review center, ⌥⌘P performance dashboard, ? cheat sheet).
    const enabledKey = (id: string): string | null => {
      const binding = shortcutBindings.find((candidate) => candidate.id === id);
      if (!binding || !binding.enabled) return null;
      return normalizeShortcutKey(binding.currentKey) || null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const combo = shortcutComboFromEvent(e);
      if (!combo) return;

      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isTextEntry =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      // Command palette: the advertised quick-open key (⌘K / Ctrl+K) and
      // Ctrl/Cmd+Shift+P. Don't hijack the quick-open key while typing.
      const quickPaletteKey = enabledKey('command-palette-quick');
      if (quickPaletteKey && combo === quickPaletteKey && !isTyping) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      const paletteKey = enabledKey('command-palette');
      if (paletteKey && combo === paletteKey) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      const sidebarKey = enabledKey('toggle-sidebar');
      if (sidebarKey && combo === sidebarKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      const reviewCenterKey = enabledKey('ai-review-center');
      if (reviewCenterKey && combo === reviewCenterKey) {
        e.preventDefault();
        setShowAiReviewCenter((previous) => !previous);
        return;
      }

      const dashboardKey = enabledKey('performance-dashboard');
      if (dashboardKey && combo === dashboardKey) {
        e.preventDefault();
        setShowPerformanceDashboard((previous) => !previous);
        return;
      }

      const helpKey = enabledKey('shortcut-help');
      if (helpKey && combo === helpKey) {
        if (isTextEntry) return;
        e.preventDefault();
        setShowShortcuts(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutBindings, toggleSidebar]);

  useEffect(() => {
    const open = () => setShowAiReviewCenter(true);
    window.addEventListener(REVIEW_CENTER_OPEN_EVENT, open);
    return () => window.removeEventListener(REVIEW_CENTER_OPEN_EVENT, open);
  }, []);

  const handleGoToPath = (targetPath: string) => {
    navigate({ to: '/files', search: { path: targetPath } });
  };

  /* ── tabs (#83) + session restore (#84) ─────────────────────────────────── */

  const navigateToTab = useCallback(
    (tab: ShellTab) => {
      navigate({
        to: tab.route.pathname,
        search: tab.route.search as Record<string, never>,
      });
    },
    [navigate]
  );

  /** The one open-a-working-copy flow: recents → tab → file explorer. */
  const handleOpenWorkingCopy = useCallback(
    async (path: string) => {
      await addRecentRepo(path);
      openTab(path);
      navigate({ to: '/files', search: { path } });
    },
    [addRecentRepo, navigate]
  );

  const handleActivateTab = useCallback(
    (tab: ShellTab) => {
      activateTab(tab.id);
      navigateToTab(tab);
    },
    [navigateToTab]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTab(tabId);
      const session = getTabSession();
      const active = session.tabs.find((tab) => tab.id === session.activeTabId);
      if (active) navigateToTab(active);
      else navigate({ to: '/' });
    },
    [navigate, navigateToTab]
  );

  const handleCloseOtherTabs = useCallback(
    (tabId: string) => {
      closeOtherTabs(tabId);
      const session = getTabSession();
      const active = session.tabs.find((tab) => tab.id === session.activeTabId);
      if (active) navigateToTab(active);
    },
    [navigateToTab]
  );

  // Record the active tab's last-visited route as the router moves (#83).
  const locationPathname = routerState.location.pathname;
  const locationSearch = JSON.stringify(routerState.location.search ?? {});
  useEffect(() => {
    recordActiveTabRoute({
      pathname: locationPathname,
      search: JSON.parse(locationSearch) as Record<string, unknown>,
    });
  }, [locationPathname, locationSearch]);

  // Session restore (#84): once, after settings and the persisted tab session
  // are in. 'lastRepo' restores the saved session (or falls back to the most
  // recent repository); 'welcome' stays home with the session restorable via
  // the CTA; 'empty' does nothing.
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current || settingsLoading) return;
    restoreAttemptedRef.current = true;
    void ensureTabSessionHydrated().then(() => {
      const plan = planSessionRestore({
        startupAction: settings.startupAction,
        session: getTabSession(),
        recentRepositories,
      });
      if (plan.action === 'restore' && plan.activeTab) {
        handleActivateTab(plan.activeTab);
      } else if (plan.action === 'open-recent') {
        void handleOpenWorkingCopy(plan.path);
      }
      setRestorePlan(plan);
    });
  }, [settingsLoading, settings.startupAction, recentRepositories, handleActivateTab, handleOpenWorkingCopy]);

  const showRestoreCta =
    restorePlan?.action === 'home-restorable' &&
    restoreCtaDismissed === false &&
    locationPathname === '/';

  const handleRestoreSession = useCallback(() => {
    if (restorePlan?.action !== 'home-restorable') return;
    const session = getTabSession();
    const active =
      session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? null;
    if (active) handleActivateTab(active);
    setRestoreCtaDismissed(true);
  }, [restorePlan, handleActivateTab]);

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

  const shelfWorkingCopyPath = workingCopyPath ?? recentRepositories[0] ?? '';
  return (
    <div className="flex flex-col h-screen shell-backdrop text-text overflow-hidden">
      {/*
       * Top bar — chrome only: the sidebar toggle, the one command search, the
       * global utilities and the window controls. Workspace identity, the
       * selected working copy and its views (Changes / History / Repository)
       * live once, in the sidebar, so nothing here repeats them.
       */}
      <header
        className={`app-topbar relative z-20 h-11 flex-shrink-0 flex items-center gap-2 pr-3 bg-bg border-b border-border titlebar-drag ${
          isMac ? 'pl-[84px]' : 'pl-2'
        }`}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          className={iconButtonClass(false)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          aria-keyshortcuts={sidebarShortcut.aria}
          title={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (${sidebarShortcut.label})`}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className={SHELL_ICON} aria-hidden="true" />
          ) : (
            <PanelLeftClose className={SHELL_ICON} aria-hidden="true" />
          )}
        </button>

        {/* Drag region — location lives in the sidebar's selected working copy. */}
        <div className="min-w-0 flex-1 self-stretch" aria-hidden="true" />

        {/* The one command search — opens the command palette */}
        <button
          type="button"
          onClick={() => setShowCommandPalette(true)}
          className="command-search titlebar-no-drag group flex h-7 w-7 flex-shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-bg-secondary text-12.5 text-text-muted transition-fast hover:border-border-strong hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:w-[220px] md:justify-start md:px-2 lg:w-[260px]"
          aria-label="Search and run commands — opens the command palette"
          aria-keyshortcuts={paletteShortcut.aria}
          title={`Search and run commands (${paletteShortcut.label})`}
        >
          <Search className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span className="hidden min-w-0 flex-1 truncate text-left md:inline">
            Search or run a command…
          </span>
          <span className="kbd hidden flex-shrink-0 md:inline-flex" aria-hidden="true">
            {paletteShortcut.label}
          </span>
        </button>

        <div className="mx-1 h-4 w-px flex-shrink-0 bg-border" aria-hidden="true" />

        {/* Right: global utilities + window controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0 titlebar-no-drag">
          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            className={iconButtonClass(showNotes)}
            aria-pressed={showNotes}
            aria-label="Quick notes"
            title="Quick notes"
          >
            <StickyNote className={SHELL_ICON} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setShowAiReviewCenter((previous) => !previous)}
            className={iconButtonClass(showAiReviewCenter)}
            aria-pressed={showAiReviewCenter}
            aria-label="AI Review Center"
            aria-keyshortcuts={reviewShortcut.aria}
            title={`AI Review Center (${reviewShortcut.label})`}
          >
            <BrainCircuit className={SHELL_ICON} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={shelfManager.open}
            disabled={!shelfWorkingCopyPath}
            className={iconButtonClass(shelfManager.isOpen)}
            aria-pressed={shelfManager.isOpen}
            aria-label="Shelf manager"
            title={shelfWorkingCopyPath ? 'Shelf manager' : 'Shelf manager — open a working copy first'}
          >
            <Archive className={SHELL_ICON} aria-hidden="true" />
          </button>

          <QuickActionsMenuButton workingCopyPath={workingCopyPath} />

          <div className="relative">
            <NotificationCenterBell
              isOpen={notificationPanelOpen}
              onToggle={() => setNotificationPanelOpen((previous) => !previous)}
              buttonRef={notificationBellRef}
            />
            {notificationPanelOpen && (
              <NotificationCenterPanel
                anchorRef={notificationBellRef}
                onClose={() => setNotificationPanelOpen(false)}
              />
            )}
          </div>

          <Suspense
            fallback={
              <div className={isWindows ? 'h-8 w-[160px]' : 'h-8 w-8'} aria-hidden="true" />
            }
          >
            <TitlebarControls
              isWindows={isWindows}
              isMaximized={isMaximized}
              isDarkTheme={isDarkTheme}
              onToggleTheme={handleToggleTheme}
              onMinimize={handleMinimize}
              onMaximize={() => void handleMaximize()}
              onClose={handleClose}
            />
          </Suspense>
        </div>
      </header>

      {/* Working-copy tabs (#83) — only once there is more than the sidebar's
          single active working copy to switch between. */}
      {tabSession.tabs.length > 0 && (
      <TabBar
        tabs={tabSession.tabs}
        activeTabId={tabSession.activeTabId}
        recentRepositories={recentRepositories}
        onActivate={handleActivateTab}
        onClose={handleCloseTab}
        onCloseOthers={handleCloseOtherTabs}
        onOpenWorkingCopy={(path) => void handleOpenWorkingCopy(path)}
      />
      )}

      {showRestoreCta && (
        <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3 text-12.5">
          <span className="text-text">
            Reopen your last session ({restorePlan.session.tabs.length} tab
            {restorePlan.session.tabs.length === 1 ? '' : 's'})?
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRestoreSession}
          >
            Restore session
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRestoreCtaDismissed(true)}
          >
            Not now
          </button>
        </div>
      )}

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

      {/* Shell-level surfaces: long-op notifications, toasts, folder drag &
          drop, quick actions at the pointer, the shelf manager (HANDOFF 1) and
          the globally mounted DiffWizard (HANDOFF 2). */}
      <OperationNotifications />
      <ToastStack />
      <FolderDropZone onOpenWorkingCopy={handleOpenWorkingCopy} />
      {shelfManager.isOpen && shelfWorkingCopyPath && (
        <Suspense fallback={null}>
          <ShelfManagerDialog
            isOpen={shelfManager.isOpen}
            onClose={shelfManager.close}
            workingCopyPath={shelfWorkingCopyPath}
          />
        </Suspense>
      )}
      {diffWizard.isOpen && (
        <Suspense fallback={null}>
          <DiffWizard
            isOpen={diffWizard.isOpen}
            onClose={diffWizard.close}
            defaultLeft={diffWizard.request?.left ?? null}
            defaultRight={diffWizard.request?.right ?? null}
          />
        </Suspense>
      )}
    </div>
  );
}
