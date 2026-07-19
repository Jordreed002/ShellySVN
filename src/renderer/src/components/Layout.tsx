import { lazy, ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Minus, Search, Square, StickyNote, X } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useVisualSettings } from '@renderer/hooks/useVisualSettings';

import { AnimatePresence, m, springs, useMotionEnabled, variants } from '../lib/motion';
import { SVN_EVENTS } from '../lib/svnOperationEvents';
import { ShellMark } from './ShellMark';
import { Sidebar } from './Sidebar';
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
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showPerformanceDashboard, setShowPerformanceDashboard] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [_isMaximized, setIsMaximized] = useState(false);
  const [forceShowTutorial, setForceShowTutorial] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { settings } = useSettings();
  const { resetTutorial } = useOnboarding();
  const navigate = useNavigate();

  const isMac = navigator.platform.toLowerCase().includes('mac');

  const routerState = useRouterState();
  const currentPath = (routerState.location.search as CommonSearchSchema)?.path;

  useVisualSettings(settings);

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
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
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

  const routePath = routerState.location.pathname;
  const motionEnabled = useMotionEnabled();

  // Short, readable label for the command bar (current path tail or default)
  const omnibarLabel = currentPath
    ? currentPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || currentPath
    : 'Search files, jump to a repo, or run a command';

  return (
    <div className="flex flex-col h-screen shell-backdrop text-text overflow-hidden">
      {/* Top Bar — glass, modern */}
      <header
        className={`h-[--topbar-height] glass titlebar-drag flex items-center gap-3 border-b border-border flex-shrink-0 px-3 ${
          isMac ? 'pl-[92px]' : ''
        }`}
      >
        {/* Left: brand */}
        <div className="flex items-center gap-2 pr-2 select-none">
          <ShellMark className="w-5 h-5 text-accent" />
          <span className="text-sm font-semibold tracking-tight">ShellySVN</span>
        </div>

        {/* Center: command / search bar */}
        <div className="flex-1 flex justify-center">
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            className="omnibar titlebar-no-drag group"
            title="Open command palette (Ctrl/Cmd+Shift+P)"
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0 text-text-muted group-hover:text-text-secondary transition-fast" />
            <span className="flex-1 text-left text-sm truncate">{omnibarLabel}</span>
            <span className="kbd ml-2 flex-shrink-0">⌘K</span>
          </button>
        </div>

        {/* Right: actions + window controls */}
        <div className="flex items-center gap-1 titlebar-no-drag">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`btn-icon-sm ${showNotes ? 'bg-accent/15 text-accent' : ''}`}
            title="Quick Notes"
            aria-pressed={showNotes}
          >
            <StickyNote className="w-4 h-4" />
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
                aria-label="Maximize"
              >
                <Square className="w-3 h-3" />
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
