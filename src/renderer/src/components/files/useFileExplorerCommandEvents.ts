import type { QueryClient } from '@tanstack/react-query';
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { SvnStatusEntry } from '@shared/types';
import { SVN_EVENTS } from '../../lib/svnOperationEvents';
import { invalidateWorkingCopyViews } from '../../features/files/useInvalidateStatus';
import { promptAppInput } from '../../utils/dialogs';
import type { useFileExplorerActions } from '../../hooks/useSvnActions';

type FileExplorerActions = ReturnType<typeof useFileExplorerActions>;

export interface FileExplorerOperationContext {
  actions: FileExplorerActions;
  path: string;
  queryClient: QueryClient;
  selectedEntry: SvnStatusEntry | null;
}

interface UseFileExplorerCommandEventsOptions {
  operationContextRef: RefObject<FileExplorerOperationContext>;
  setApplyPatchPath: Dispatch<SetStateAction<string | null>>;
  setBlamePath: Dispatch<SetStateAction<string | null>>;
  setBranchTagCompareOpen: Dispatch<SetStateAction<boolean>>;
  setBranchTagMode: Dispatch<SetStateAction<'branch' | 'tag'>>;
  setBranchTagPath: Dispatch<SetStateAction<string | null>>;
  setChangelistPath: Dispatch<SetStateAction<string | null>>;
  setCreatePatchPath: Dispatch<SetStateAction<string | null>>;
  setExportPath: Dispatch<SetStateAction<string | null>>;
  setImportDialogOpen: Dispatch<SetStateAction<boolean>>;
  setLockManagementPath: Dispatch<SetStateAction<string | null>>;
  setMergePath: Dispatch<SetStateAction<string | null>>;
  setMoveRenameTarget: Dispatch<
    SetStateAction<{ path: string; mode: 'move' | 'rename' } | null>
  >;
  setPropertiesPath: Dispatch<SetStateAction<string | null>>;
  setRelocatePath: Dispatch<SetStateAction<string | null>>;
  setRepoBrowserUrl: Dispatch<SetStateAction<string | null>>;
  setResolveEntry: Dispatch<SetStateAction<SvnStatusEntry | null>>;
  setRevisionGraphPath: Dispatch<SetStateAction<string | null>>;
  setShelveDialogPath: Dispatch<SetStateAction<string | null>>;
  setSwitchPath: Dispatch<SetStateAction<string | null>>;
}

export function useFileExplorerCommandEvents({
  operationContextRef,
  setApplyPatchPath,
  setBlamePath,
  setBranchTagCompareOpen,
  setBranchTagMode,
  setBranchTagPath,
  setChangelistPath,
  setCreatePatchPath,
  setExportPath,
  setImportDialogOpen,
  setLockManagementPath,
  setMergePath,
  setMoveRenameTarget,
  setPropertiesPath,
  setRelocatePath,
  setRepoBrowserUrl,
  setResolveEntry,
  setRevisionGraphPath,
  setShelveDialogPath,
  setSwitchPath,
}: UseFileExplorerCommandEventsOptions): void {
  useEffect(() => {
    const getContext = () => operationContextRef.current;
    const getSelectedOrCurrentPath = () => {
      const context = getContext();
      return context.selectedEntry?.path || context.path;
    };

    const handleBranchTag = () => {
      const context = getContext();
      if (context.path) {
        setBranchTagPath(context.path);
        setBranchTagMode('branch');
      }
    };
    const handleTag = () => {
      const context = getContext();
      if (context.path) {
        setBranchTagPath(context.path);
        setBranchTagMode('tag');
      }
    };
    const handleBranchTagCompare = () => {
      const context = getContext();
      if (context.path) setBranchTagCompareOpen(true);
    };
    const handleSwitch = () => {
      const context = getContext();
      if (context.path) setSwitchPath(context.path);
    };
    const handleMerge = () => {
      const context = getContext();
      if (context.path) setMergePath(context.path);
    };
    const handleRelocate = () => {
      const context = getContext();
      if (context.path) setRelocatePath(context.path);
    };
    const handleBlame = () => {
      const context = getContext();
      if (context.selectedEntry && !context.selectedEntry.isDirectory) {
        setBlamePath(context.selectedEntry.path);
      }
    };
    const handleProperties = () => {
      const context = getContext();
      if (context.selectedEntry) setPropertiesPath(context.selectedEntry.path);
    };
    const handleChangelist = () => {
      const context = getContext();
      if (context.selectedEntry) setChangelistPath(context.selectedEntry.path);
    };
    const handleShelve = () => {
      const context = getContext();
      if (context.path) setShelveDialogPath(context.path);
    };
    const handleImport = () => {
      setImportDialogOpen(true);
    };
    const handleExport = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setExportPath(targetPath);
    };
    const handleRepoBrowser = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setRepoBrowserUrl(targetPath);
    };
    const handleRevisionGraph = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setRevisionGraphPath(targetPath);
    };
    const handleLock = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setLockManagementPath(targetPath);
    };
    const handleCreatePatch = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setCreatePatchPath(targetPath);
    };
    const handleApplyPatch = () => {
      const targetPath = getSelectedOrCurrentPath();
      if (targetPath) setApplyPatchPath(targetPath);
    };
    const handleRevert = () => {
      void getContext().actions.handleRevertSelected();
    };
    const handleAdd = () => {
      void getContext().actions.handleAddSelected();
    };
    const handleDelete = () => {
      void getContext().actions.handleDeleteSelected();
    };
    const handleCleanup = () => {
      const context = getContext();
      const targetPath = context.selectedEntry?.path || context.path;
      if (targetPath) void context.actions.cleanup(targetPath);
    };
    const handleResolve = () => {
      const context = getContext();
      if (context.selectedEntry?.status === 'C') {
        setResolveEntry(context.selectedEntry);
      }
    };
    const handleMove = () => {
      const context = getContext();
      if (context.selectedEntry) {
        setMoveRenameTarget({ path: context.selectedEntry.path, mode: 'move' });
      }
    };
    const handleCopy = async () => {
      const context = getContext();
      if (!context.selectedEntry) return;
      const destination = await promptAppInput({
        title: 'Copy item',
        message: 'Destination path:',
        confirmLabel: 'Copy',
      });
      if (!destination) return;
      const result = await window.api.svn.copy(
        context.selectedEntry.path,
        destination,
        `Copy ${context.selectedEntry.path}`
      );
      if (result.success) {
        invalidateWorkingCopyViews(context.queryClient, context.path);
      }
    };
    const handleRename = () => {
      const context = getContext();
      if (context.selectedEntry) {
        setMoveRenameTarget({ path: context.selectedEntry.path, mode: 'rename' });
      }
    };

    const eventHandlers = [
      [SVN_EVENTS.REVERT, handleRevert],
      [SVN_EVENTS.ADD, handleAdd],
      [SVN_EVENTS.DELETE, handleDelete],
      [SVN_EVENTS.CLEANUP, handleCleanup],
      [SVN_EVENTS.RESOLVE, handleResolve],
      [SVN_EVENTS.MOVE, handleMove],
      [SVN_EVENTS.COPY, handleCopy],
      [SVN_EVENTS.RENAME, handleRename],
      [SVN_EVENTS.BRANCH_TAG, handleBranchTag],
      [SVN_EVENTS.TAG, handleTag],
      [SVN_EVENTS.BRANCH_TAG_COMPARE, handleBranchTagCompare],
      [SVN_EVENTS.SWITCH, handleSwitch],
      [SVN_EVENTS.MERGE, handleMerge],
      [SVN_EVENTS.RELOCATE, handleRelocate],
      [SVN_EVENTS.BLAME, handleBlame],
      [SVN_EVENTS.PROPERTIES, handleProperties],
      [SVN_EVENTS.CHANGELIST, handleChangelist],
      [SVN_EVENTS.SHELVE, handleShelve],
      [SVN_EVENTS.UNSHELVE, handleShelve],
      [SVN_EVENTS.IMPORT, handleImport],
      [SVN_EVENTS.EXPORT, handleExport],
      [SVN_EVENTS.REPO_BROWSER, handleRepoBrowser],
      [SVN_EVENTS.REVISION_GRAPH, handleRevisionGraph],
      [SVN_EVENTS.LOCK, handleLock],
      [SVN_EVENTS.UNLOCK, handleLock],
      [SVN_EVENTS.CREATE_PATCH, handleCreatePatch],
      [SVN_EVENTS.APPLY_PATCH, handleApplyPatch],
    ] as const;

    for (const [eventName, handler] of eventHandlers) {
      window.addEventListener(eventName, handler);
    }

    return () => {
      for (const [eventName, handler] of eventHandlers) {
        window.removeEventListener(eventName, handler);
      }
    };
  }, [
    operationContextRef,
    setApplyPatchPath,
    setBlamePath,
    setBranchTagCompareOpen,
    setBranchTagMode,
    setBranchTagPath,
    setChangelistPath,
    setCreatePatchPath,
    setExportPath,
    setImportDialogOpen,
    setLockManagementPath,
    setMergePath,
    setMoveRenameTarget,
    setPropertiesPath,
    setRelocatePath,
    setRepoBrowserUrl,
    setResolveEntry,
    setRevisionGraphPath,
    setShelveDialogPath,
    setSwitchPath,
  ]);
}
