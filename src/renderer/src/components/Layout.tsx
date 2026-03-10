import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { KeyboardShortcutsDialog } from './ui/KeyboardShortcutsDialog';
import { CommandPalette } from './ui/CommandPalette';
import { StatusBar } from './ui/StatusBar';
import { OnboardingTutorial, useOnboarding } from './tutorial';
import { useSettings } from '../hooks/useSettings';
import { useVisualSettings } from '../hooks/useVisualSettings';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { GitBranch, Minus, Square, X } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [_isMaximized, setIsMaximized] = useState(false);
  const [forceShowTutorial, setForceShowTutorial] = useState(false);
  const { settings } = useSettings();
  const { resetTutorial } = useOnboarding();
  const navigate = useNavigate();

  const isMac = navigator.platform.toLowerCase().includes('mac');

  const routerState = useRouterState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentPath = (routerState.location.search as any)?.path as string | undefined;

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

        {/* Center: Window title (draggable) */}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-text-muted font-medium">Subversion Client</span>
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
      />
    </div>
  );
}
