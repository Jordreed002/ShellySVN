import { ReactNode, useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { GitBranch, Minus, Square, StickyNote, X } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useVisualSettings } from '@renderer/hooks/useVisualSettings';

import { SVN_EVENTS } from '../lib/svnOperationEvents';
import { Sidebar } from './Sidebar';
import { OnboardingTutorial, useOnboarding } from './tutorial';
import { CommandPalette } from './ui/CommandPalette';
import { KeyboardShortcutsDialog } from './ui/KeyboardShortcutsDialog';
import { PerformanceDashboard } from './ui/PerformanceDashboard';
import { PluginManagerDialog } from './ui/PluginManagerDialog';
import { QuickNotesPanel } from './ui/QuickNotesPanel';
import { StatusBar } from './ui/StatusBar';

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setShowPerformanceDashboard(prev => !prev);
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

  return (
    <div className="flex flex-col h-screen bg-bg text-text overflow-hidden">
      {/* Unified Title Bar - Full Width */}
      <div
        className={`h-[32px] bg-bg-tertiary titlebar-drag flex items-center justify-between border-b border-border flex-shrink-0 ${
          isMac ? 'pl-20' : ''
        }`}
      >
        {/* Left: App branding */}
        <div className="flex items-center gap-2 px-4">
          <GitBranch className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text">ShellySVN</span>
        </div>

        {/* Center: Window title (draggable) and Quick Notes button */}
        <div className="flex-1 flex items-center justify-center gap-4">
          <span className="text-xs text-text-muted font-medium">Subversion Client</span>
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`titlebar-no-drag p-1.5 rounded transition-fast ${
              showNotes
                ? 'bg-accent/20 text-accent'
                : 'text-text-muted hover:text-text hover:bg-bg-elevated'
            }`}
            title="Quick Notes"
          >
            <StickyNote className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Window controls (Windows/Linux) */}
        {!isMac && (
          <div className="flex items-center h-full titlebar-no-drag">
            <button
              onClick={handleMinimize}
              className="h-full px-4 flex items-center justify-center hover:bg-bg-elevated transition-fast"
              aria-label="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={handleMaximize}
              className="h-full px-4 flex items-center justify-center hover:bg-bg-elevated transition-fast"
              aria-label="Maximize"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={handleClose}
              className="h-full px-4 flex items-center justify-center hover:bg-error hover:text-white transition-fast"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {isMac && <div className="w-20" />}
      </div>

      {/* Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">{children}</div>
          <StatusBar />
        </main>
      </div>

      {/* Modals */}
      <KeyboardShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Onboarding Tutorial */}
      <OnboardingTutorial
        forceShow={forceShowTutorial}
        onComplete={() => setForceShowTutorial(false)}
        onSkip={() => setForceShowTutorial(false)}
      />

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
        onBranchTag={() => {
          window.dispatchEvent(new CustomEvent(SVN_EVENTS.BRANCH_TAG));
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

      {/* Quick Notes Panel */}
      <QuickNotesPanel
        isOpen={showNotes}
        currentPath={currentPath}
        onClose={() => setShowNotes(false)}
      />

      {/* Performance Dashboard */}
      {showPerformanceDashboard && (
        <div className="fixed bottom-4 right-4 z-50 w-[480px]">
          <PerformanceDashboard
            visible={showPerformanceDashboard}
            onClose={() => setShowPerformanceDashboard(false)}
            detailed
          />
        </div>
      )}

      {/* Plugin Manager Dialog */}
      <PluginManagerDialog
        isOpen={showPluginManager}
        onClose={() => setShowPluginManager(false)}
      />
    </div>
  );
}
