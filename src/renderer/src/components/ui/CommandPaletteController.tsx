import { SVN_EVENTS, type SvnEventName } from '../../lib/svnOperationEvents';
import { CommandPalette } from './CommandPalette';

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

  return (
    <CommandPalette
      isOpen
      onClose={onClose}
      currentPath={currentPath}
      recentPaths={recentPaths}
      bookmarks={bookmarks}
      onGoToPath={onGoToPath}
      onOpenSettings={onOpenSettings}
      onShowShortcuts={onShowShortcuts}
      onShowNotes={onShowNotes}
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
