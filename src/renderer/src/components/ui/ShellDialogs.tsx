import { lazy, Suspense } from 'react';

const KeyboardShortcutsDialog = lazy(() =>
  import('./KeyboardShortcutsDialog').then((mod) => ({ default: mod.KeyboardShortcutsDialog }))
);
const PerformanceDashboard = lazy(() =>
  import('./PerformanceDashboard').then((mod) => ({ default: mod.PerformanceDashboard }))
);
const PluginManagerDialog = lazy(() =>
  import('./PluginManagerDialog').then((mod) => ({ default: mod.PluginManagerDialog }))
);
const QuickNotesPanel = lazy(() =>
  import('./QuickNotesPanel').then((mod) => ({ default: mod.QuickNotesPanel }))
);

interface ShellDialogsProps {
  currentPath?: string;
  showShortcuts: boolean;
  showNotes: boolean;
  showPerformanceDashboard: boolean;
  showPluginManager: boolean;
  onCloseShortcuts: () => void;
  onCloseNotes: () => void;
  onClosePerformanceDashboard: () => void;
  onClosePluginManager: () => void;
}

/** Dialog-only shell code, absent until a user opens one of these surfaces. */
export function ShellDialogs({
  currentPath,
  showShortcuts,
  showNotes,
  showPerformanceDashboard,
  showPluginManager,
  onCloseShortcuts,
  onCloseNotes,
  onClosePerformanceDashboard,
  onClosePluginManager,
}: ShellDialogsProps) {
  return (
    <>
      {showShortcuts && (
        <Suspense fallback={null}>
          <KeyboardShortcutsDialog isOpen onClose={onCloseShortcuts} />
        </Suspense>
      )}
      {showNotes && (
        <Suspense fallback={null}>
          <QuickNotesPanel isOpen currentPath={currentPath} onClose={onCloseNotes} />
        </Suspense>
      )}
      {showPerformanceDashboard && (
        <Suspense fallback={null}>
          <div className="fixed bottom-4 right-4 z-50 w-[480px]">
            <PerformanceDashboard visible onClose={onClosePerformanceDashboard} detailed />
          </div>
        </Suspense>
      )}
      {showPluginManager && (
        <Suspense fallback={null}>
          <PluginManagerDialog isOpen onClose={onClosePluginManager} />
        </Suspense>
      )}
    </>
  );
}
