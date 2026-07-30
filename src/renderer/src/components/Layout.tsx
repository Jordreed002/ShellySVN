import { lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Box,
  ChevronDown,
  Minus,
  Moon,
  PanelLeft,
  Search,
  Settings as SettingsIcon,
  Square,
  StickyNote,
  Sun,
  User,
  X,
} from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useVisualSettings } from '@renderer/hooks/useVisualSettings';
import { invalidateAfterSvnMutation } from '@renderer/utils/mutationInvalidation';

import { AnimatePresence, m, springs, useMotionEnabled, variants } from '../lib/motion';
import { SVN_EVENTS } from '../lib/svnOperationEvents';
import { ShellMark } from './ShellMark';
import { Sidebar } from './Sidebar';
import {
  collectRepositoryRoots,
  useWorkingCopyInfo,
  useWorkingCopyOverview,
} from './sidebar/sidebarData';
import { useOnboarding } from './tutorial/useOnboarding';
import { StatusBar } from './ui/StatusBar';

const OnboardingTutorial = lazy(() =>
  import('./tutorial/OnboardingTutorial').then((m) => ({ default: m.OnboardingTutorial }))
);

const CommandPalette = lazy(() =>
  import('./ui/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);
const KeyboardShortcutsDialog = lazy(() =>
  import('./ui/KeyboardShortcutsDialog').then((m) => ({ default: m.KeyboardShortcutsDialog }))
);
const PerformanceDashboard = lazy(() =>
  import('./ui/PerformanceDashboard').then((m) => ({ default: m.PerformanceDashboard }))
);
const PluginManagerDialog = lazy(() =>
  import('./ui/PluginManagerDialog').then((m) => ({ default: m.PluginManagerDialog }))
);
const QuickNotesPanel = lazy(() =>
  import('./ui/QuickNotesPanel').then((m) => ({ default: m.QuickNotesPanel }))
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

/** Host portion of an SVN URL, for the repository pill. Null for local/file URLs. */
function repositoryHost(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url);
  return match ? match[1] : null;
}

/**
 * The repository's name: the last segment of its root URL (`…/atlas` → `atlas`).
 *
 * The authority is stripped first, so a repository served from the root of a
 * host is reported as unnamed rather than being named after the host.
 */
function repositoryName(rootUrl: string): string | null {
  const path = rootUrl.replace(/[?#].*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/** Is `url` inside the repository rooted at `root`? Segment-exact, not a prefix test. */
function isWithinRepository(root: string, url: string): boolean {
  const base = root.replace(/\/+$/, '');
  const target = url.replace(/\/+$/, '');
  return base.length > 0 && (target === base || target.startsWith(`${base}/`));
}

/** What the top bar's repository pill should say, and why it may say less. */
export interface RepositoryPill {
  /** Bold label — the repository's name, or its host when the name is unknown. */
  label: string;
  /** Mono secondary label: the host, shown only beside a repository name. */
  host: string | null;
  /** Accessible name for the pill, which is also the "switch repository" control. */
  ariaLabel: string;
  /** Tooltip — the fullest identifier available. */
  title: string;
}

export interface RepositoryPillFacts {
  /** `svn info` repository root of the active working copy, once resolved. */
  repositoryRoot?: string;
  /** Local path of the working copy the current location belongs to. */
  workingCopyPath?: string;
  /** Repository URL from the route — the browser can be open without a checkout. */
  browsedUrl?: string;
  /** Repository roots the user's checkouts came from, which can name a browsed URL. */
  knownRoots?: readonly { url: string; name: string }[];
}

/**
 * Name the repository that is open, from whichever fact is available.
 *
 * The pill used to read "No repository" whenever the route carried no working
 * copy path, which is exactly the case while browsing a repository by URL. The
 * order below is by descending certainty, and it stops rather than guessing:
 * a URL from a repository the user has never checked out yields the host only,
 * because the repository root — and therefore its name — is a question only the
 * server can answer, and answering it is not a top-bar read.
 */
export function describeRepositoryPill({
  repositoryRoot,
  workingCopyPath,
  browsedUrl,
  knownRoots = [],
}: RepositoryPillFacts): RepositoryPill {
  const root =
    repositoryRoot ??
    knownRoots.find((candidate) => !!browsedUrl && isWithinRepository(candidate.url, browsedUrl))
      ?.url;

  if (root) {
    const name = repositoryName(root);
    const host = repositoryHost(root);
    const label = name ?? host;
    if (label) {
      return {
        label,
        host: name ? host : null,
        ariaLabel: `Repository ${label}${name && host ? ` on ${host}` : ''} — switch repository`,
        title: workingCopyPath ? `${root} — ${workingCopyPath}` : root,
      };
    }
  }

  if (browsedUrl) {
    const host = repositoryHost(browsedUrl);
    if (host) {
      return {
        label: host,
        host: null,
        ariaLabel: `Browsing a repository on ${host} — switch repository`,
        title: browsedUrl,
      };
    }
  }

  // A checkout whose `svn info` has not answered yet: the folder name is a fact,
  // the repository's name is not, so the pill says which it is showing.
  if (workingCopyPath) {
    const folder = pathTail(workingCopyPath);
    return {
      label: folder,
      host: null,
      ariaLabel: `Working copy ${folder} — switch repository`,
      title: workingCopyPath,
    };
  }

  return {
    label: 'No repository',
    host: null,
    ariaLabel: 'No repository open — open the command palette to pick one',
    title: 'No repository open',
  };
}

/** Open the settings dialog (owned by the sidebar, reached by event). */
function openSettings(): void {
  window.dispatchEvent(new CustomEvent('shellysvn:open-settings'));
}

/** Trailing segment of a filesystem path — the working-copy folder name. */
function pathTail(value: string): string {
  return (
    value
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || value
  );
}

export function Layout({ children }: LayoutProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showPerformanceDashboard, setShowPerformanceDashboard] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [forceShowTutorial, setForceShowTutorial] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const { settings, updateSettings } = useSettings();
  const { resetTutorial } = useOnboarding();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isMac = navigator.platform.toLowerCase().includes('mac');

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
  const { data: workingCopyInfo } = useWorkingCopyInfo(workingCopyPath);
  // The rail's own query, reused by key: it has already resolved which
  // repository each checkout came from, which is what lets a browsed URL be
  // named without asking the server again.
  const workingCopyOverview = useWorkingCopyOverview(recentRepositories);
  const knownRoots = useMemo(
    () => collectRepositoryRoots(recentRepositories, workingCopyOverview),
    [recentRepositories, workingCopyOverview]
  );
  const repositoryPill = describeRepositoryPill({
    repositoryRoot: workingCopyInfo?.repositoryRoot,
    workingCopyPath,
    browsedUrl,
    knownRoots,
  });

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
      void invalidateAfterSvnMutation(queryClient, notification);
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

  // Listen for tutorial restart event from Settings
  useEffect(() => {
    const handleTutorialRestart = async () => {
      await resetTutorial();
      setForceShowTutorial(true);
    };

    window.addEventListener('tutorial:restart', handleTutorialRestart);
    return () => window.removeEventListener('tutorial:restart', handleTutorialRestart);
  }, [resetTutorial]);

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

  const routePath = routerState.location.pathname;
  const motionEnabled = useMotionEnabled();

  const accountName = settings.savedCredentials?.[0]?.username ?? '';
  const accountInitial = accountName.trim().charAt(0).toUpperCase();

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
        <button
          type="button"
          onClick={() => setShowCommandPalette(true)}
          className="titlebar-no-drag flex items-center gap-2 h-control px-[11px] flex-shrink-0 min-w-0 rounded-9 bg-bg border border-border hover:border-border-strong text-12.5 transition-fast"
          aria-label={repositoryPill.ariaLabel}
          title={repositoryPill.title}
        >
          <Box className="w-3 h-3 flex-shrink-0 text-text-faint" aria-hidden="true" />
          <span className="font-semibold text-text truncate max-w-[150px]">
            {repositoryPill.label}
          </span>
          {repositoryPill.host && (
            <span className="font-mono text-11 text-text-muted truncate max-w-[190px]">
              {repositoryPill.host}
            </span>
          )}
          <ChevronDown className="w-3 h-3 flex-shrink-0 text-text-faint" aria-hidden="true" />
        </button>

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
          <span className="flex-1 min-w-0 truncate text-left">
            Run a command
          </span>
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
            onClick={handleToggleTheme}
            className={iconButtonClass()}
            aria-label={isDarkTheme ? 'Switch to the light theme' : 'Switch to the dark theme'}
            title={isDarkTheme ? 'Switch to the light theme' : 'Switch to the dark theme'}
          >
            {isDarkTheme ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={openSettings}
            className={iconButtonClass()}
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={openSettings}
            className="titlebar-no-drag w-[30px] h-[30px] flex-shrink-0 grid place-items-center rounded-full bg-accent text-white text-[12.5px] font-bold transition-fast hover:bg-accent-hover"
            aria-label={
              accountName ? `Account: ${accountName}` : 'Account — no saved credentials yet'
            }
            title={accountName || 'No saved credentials yet'}
          >
            {accountInitial || <User className="w-4 h-4" aria-hidden="true" />}
          </button>

          {!isMac && (
            <div className="flex items-center h-full ml-1">
              <button
                onClick={handleMinimize}
                className="window-control rounded-md hover:bg-bg-elevated transition-fast"
                aria-label="Minimize"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                onClick={handleMaximize}
                className="window-control rounded-md hover:bg-bg-elevated transition-fast"
                aria-label={isMaximized ? 'Restore window' : 'Maximize'}
                title={isMaximized ? 'Restore window' : 'Maximize'}
              >
                <Square className={`w-3 h-3 ${isMaximized ? 'fill-current' : ''}`} />
              </button>
              <button
                onClick={handleClose}
                className="window-control rounded-md hover:bg-error hover:text-white transition-fast"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        <m.div
          className="flex-shrink-0 overflow-hidden h-full"
          initial={false}
          animate={{ width: sidebarCollapsed ? 56 : (settings?.sidebarWidth ?? 260) }}
          transition={motionEnabled ? springs.smooth : { duration: 0 }}
        >
          <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        </m.div>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 min-w-0">
            {motionEnabled ? (
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={routePath}
                  className="absolute inset-0 flex flex-col overflow-hidden min-h-0"
                  variants={variants.fadeUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                >
                  {children}
                </m.div>
              </AnimatePresence>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
            )}
          </div>
          <StatusBar />
        </main>
      </div>

      {/* Modals */}
      {showShortcuts && (
        <Suspense fallback={null}>
          <KeyboardShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
        </Suspense>
      )}

      {/* Onboarding Tutorial */}
      <Suspense fallback={null}>
        <OnboardingTutorial
          forceShow={forceShowTutorial}
          onComplete={() => setForceShowTutorial(false)}
          onSkip={() => setForceShowTutorial(false)}
        />
      </Suspense>

      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={showCommandPalette}
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
            onRevert={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.REVERT));
              setShowCommandPalette(false);
            }}
            onAdd={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.ADD));
              setShowCommandPalette(false);
            }}
            onDelete={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.DELETE));
              setShowCommandPalette(false);
            }}
            onCleanup={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.CLEANUP));
              setShowCommandPalette(false);
            }}
            onResolve={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.RESOLVE));
              setShowCommandPalette(false);
            }}
            onMove={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.MOVE));
              setShowCommandPalette(false);
            }}
            onCopy={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.COPY));
              setShowCommandPalette(false);
            }}
            onRename={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.RENAME));
              setShowCommandPalette(false);
            }}
            onBranchTag={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.BRANCH_TAG));
              setShowCommandPalette(false);
            }}
            onTag={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.TAG));
              setShowCommandPalette(false);
            }}
            onBranchTagCompare={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.BRANCH_TAG_COMPARE));
              setShowCommandPalette(false);
            }}
            onSwitch={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.SWITCH));
              setShowCommandPalette(false);
            }}
            onMerge={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.MERGE));
              setShowCommandPalette(false);
            }}
            onRelocate={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.RELOCATE));
              setShowCommandPalette(false);
            }}
            onBlame={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.BLAME));
              setShowCommandPalette(false);
            }}
            onProperties={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.PROPERTIES));
              setShowCommandPalette(false);
            }}
            onChangelist={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.CHANGELIST));
              setShowCommandPalette(false);
            }}
            onShelve={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.SHELVE));
              setShowCommandPalette(false);
            }}
            onUnshelve={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.UNSHELVE));
              setShowCommandPalette(false);
            }}
            onLock={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.LOCK));
              setShowCommandPalette(false);
            }}
            onUnlock={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.UNLOCK));
              setShowCommandPalette(false);
            }}
            onExport={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.EXPORT));
              setShowCommandPalette(false);
            }}
            onImport={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.IMPORT));
              setShowCommandPalette(false);
            }}
            onRepoBrowser={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.REPO_BROWSER));
              setShowCommandPalette(false);
            }}
            onRevisionGraph={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.REVISION_GRAPH));
              setShowCommandPalette(false);
            }}
            onCreatePatch={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.CREATE_PATCH));
              setShowCommandPalette(false);
            }}
            onApplyPatch={() => {
              window.dispatchEvent(new CustomEvent(SVN_EVENTS.APPLY_PATCH));
              setShowCommandPalette(false);
            }}
            onManagePlugins={() => {
              setShowCommandPalette(false);
              setShowPluginManager(true);
            }}
          />
        </Suspense>
      )}

      {/* Quick Notes Panel */}
      {showNotes && (
        <Suspense fallback={null}>
          <QuickNotesPanel
            isOpen={showNotes}
            currentPath={currentPath}
            onClose={() => setShowNotes(false)}
          />
        </Suspense>
      )}

      {/* Performance Dashboard */}
      {showPerformanceDashboard && (
        <Suspense fallback={null}>
          <div className="fixed bottom-4 right-4 z-50 w-[480px]">
            <PerformanceDashboard
              visible={showPerformanceDashboard}
              onClose={() => setShowPerformanceDashboard(false)}
              detailed
            />
          </div>
        </Suspense>
      )}

      {/* Plugin Manager Dialog */}
      {showPluginManager && (
        <Suspense fallback={null}>
          <PluginManagerDialog
            isOpen={showPluginManager}
            onClose={() => setShowPluginManager(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
