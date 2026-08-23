import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SVN_EVENTS, type SvnEventName } from '../../lib/svnOperationEvents';
import { REVIEW_CENTER_OPEN_EVENT } from '../../features/ai-review-center/reviewCenterEvents';
import { useSettings } from '../../hooks/useSettings';
import { useHomePath } from '../../hooks/useHomePath';
import { describeRepo } from '../sidebar/sidebarData';
import { CommandPalette, type PaletteRoute } from './CommandPalette';
import { STATUS_LEGEND_OPEN_EVENT } from './StatusLegendDialog';
import { openDiffWizard, openNotificationCenter, openShelfManager } from '../../lib/shellActions';

interface CommandPaletteControllerProps {
  currentPath?: string;
  recentPaths?: string[];
  bookmarks?: { path: string; name: string }[];
  onClose: () => void;
  onGoToPath: (path: string) => void;
  onOpenSettings: () => void;
  onShowShortcuts: () => void;
  onShowNotes: () => void;
  onManagePlugins: () => void;
}

/** Owns the verbose SVN command wiring outside the initial application shell. */
export function CommandPaletteController({
  currentPath,
  recentPaths,
  bookmarks,
  onClose,
  onGoToPath,
  onOpenSettings,
  onShowShortcuts,
  onShowNotes,
  onManagePlugins,
}: CommandPaletteControllerProps) {
  const dispatch = (eventName: SvnEventName) => () => {
    window.dispatchEvent(new CustomEvent(eventName));
    onClose();
  };

  const navigate = useNavigate();
  const homePath = useHomePath();
  const { settings, updateSettings, addBookmark } = useSettings();

  // Sidebar rail destinations — same targets the sidebar links navigate to.
  const handleGoToRoute = useCallback(
    (route: PaletteRoute) => {
      switch (route) {
        case 'home':
          navigate({ to: '/' });
          break;
        case 'files':
          navigate({ to: '/files', search: { path: currentPath || homePath || '/' } });
          break;
        case 'repo-browser':
          navigate({ to: '/repo-browser', search: { url: '', localPath: undefined } });
          break;
        case 'history':
          if (currentPath) navigate({ to: '/history', search: { path: currentPath } });
          break;
      }
      onClose();
    },
    [navigate, currentPath, homePath, onClose]
  );

  // The Layout opens the review center when this event fires.
  const handleOpenAiReviewCenter = useCallback(() => {
    window.dispatchEvent(new CustomEvent(REVIEW_CENTER_OPEN_EVENT));
    onClose();
  }, [onClose]);

  // The status bar's mounted legend listens for this (#94).
  const handleShowStatusLegend = useCallback(() => {
    window.dispatchEvent(new CustomEvent(STATUS_LEGEND_OPEN_EVENT));
    onClose();
  }, [onClose]);

  // Shell surfaces reached through lib/shellActions; the Layout mounts the
  // dialogs that listen for these events (#49/#64/#81).
  const handleOpenDiffWizard = useCallback(() => {
    openDiffWizard();
    onClose();
  }, [onClose]);

  const handleOpenShelfManager = useCallback(() => {
    openShelfManager();
    onClose();
  }, [onClose]);

  const handleOpenNotificationCenter = useCallback(() => {
    openNotificationCenter();
    onClose();
  }, [onClose]);

  // The Sidebar listens on `shellysvn:open-settings` and honours `detail.tab`.
  const handleManageCredentials = useCallback(() => {
    window.dispatchEvent(new CustomEvent('shellysvn:open-settings', { detail: { tab: 'auth' } }));
    onClose();
  }, [onClose]);

  // Mirror the titlebar toggle: flip the effective theme, resolving "system".
  const handleToggleTheme = useCallback(() => {
    const theme = settings?.theme;
    const effectiveDark =
      !theme || theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : theme === 'dark';
    void updateSettings({ theme: effectiveDark ? 'light' : 'dark' });
    onClose();
  }, [settings?.theme, updateSettings, onClose]);

  const handleAddBookmark = useCallback(() => {
    if (currentPath) void addBookmark(currentPath, describeRepo(currentPath).name);
    onClose();
  }, [currentPath, addBookmark, onClose]);

  return (
    <CommandPalette
      isOpen
      onClose={onClose}
      currentPath={currentPath}
      recentPaths={recentPaths}
      bookmarks={bookmarks}
      onGoToPath={onGoToPath}
      onGoToRoute={handleGoToRoute}
      onOpenSettings={onOpenSettings}
      onShowShortcuts={onShowShortcuts}
      onShowNotes={onShowNotes}
      onAddBookmark={handleAddBookmark}
      onOpenAiReviewCenter={handleOpenAiReviewCenter}
      onShowStatusLegend={handleShowStatusLegend}
      onOpenDiffWizard={handleOpenDiffWizard}
      onOpenShelfManager={handleOpenShelfManager}
      onOpenNotificationCenter={handleOpenNotificationCenter}
      onManageCredentials={handleManageCredentials}
      onToggleTheme={handleToggleTheme}
      onMinimizeWindow={() => {
        window.api.app.window.minimize();
        onClose();
      }}
      onMaximizeWindow={() => {
        void window.api.app.window.maximize();
        onClose();
      }}
      onCloseWindow={() => {
        window.api.app.window.close();
      }}
      onRevert={dispatch(SVN_EVENTS.REVERT)}
      onAdd={dispatch(SVN_EVENTS.ADD)}
      onDelete={dispatch(SVN_EVENTS.DELETE)}
      onCleanup={dispatch(SVN_EVENTS.CLEANUP)}
      onResolve={dispatch(SVN_EVENTS.RESOLVE)}
      onMove={dispatch(SVN_EVENTS.MOVE)}
      onCopy={dispatch(SVN_EVENTS.COPY)}
      onRename={dispatch(SVN_EVENTS.RENAME)}
      onBranchTag={dispatch(SVN_EVENTS.BRANCH_TAG)}
      onTag={dispatch(SVN_EVENTS.TAG)}
      onBranchTagCompare={dispatch(SVN_EVENTS.BRANCH_TAG_COMPARE)}
      onSwitch={dispatch(SVN_EVENTS.SWITCH)}
      onMerge={dispatch(SVN_EVENTS.MERGE)}
      onRelocate={dispatch(SVN_EVENTS.RELOCATE)}
      onBlame={dispatch(SVN_EVENTS.BLAME)}
      onProperties={dispatch(SVN_EVENTS.PROPERTIES)}
      onChangelist={dispatch(SVN_EVENTS.CHANGELIST)}
      onShelve={dispatch(SVN_EVENTS.SHELVE)}
      onUnshelve={dispatch(SVN_EVENTS.UNSHELVE)}
      onLock={dispatch(SVN_EVENTS.LOCK)}
      onUnlock={dispatch(SVN_EVENTS.UNLOCK)}
      onExport={dispatch(SVN_EVENTS.EXPORT)}
      onImport={dispatch(SVN_EVENTS.IMPORT)}
      onRepoBrowser={dispatch(SVN_EVENTS.REPO_BROWSER)}
      onRevisionGraph={dispatch(SVN_EVENTS.REVISION_GRAPH)}
      onCreatePatch={dispatch(SVN_EVENTS.CREATE_PATCH)}
      onApplyPatch={dispatch(SVN_EVENTS.APPLY_PATCH)}
      onManagePlugins={onManagePlugins}
    />
  );
}
