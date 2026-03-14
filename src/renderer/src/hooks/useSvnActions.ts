import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SvnStatusEntry, SvnStatusChar } from '@shared/types';
import { useSettings } from './useSettings';

interface SvnActionResult {
  success: boolean;
  message?: string;
  revision?: number;
}

export function useSvnActions() {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  /**
   * Update overlay icon if shell integration is enabled
   * Errors are caught and logged to avoid breaking the main operation
   */
  const updateOverlayIfEnabled = useCallback(
    async (path: string, status: SvnStatusChar): Promise<void> => {
      // Check if shell integration and icon overlays are enabled
      if (!settings.integration?.shellExtensionEnabled || !settings.integration?.iconOverlaysEnabled) {
        return;
      }

      try {
        await window.api.shell.updateOverlay(path, status);
      } catch (error) {
        // Log error but don't throw - overlay updates should not break operations
        console.warn(`Failed to update overlay for ${path}:`, error);
      }
    },
    [settings.integration?.shellExtensionEnabled, settings.integration?.iconOverlaysEnabled]
  );

  /**
   * Update overlays for multiple paths
   */
  const updateOverlaysIfEnabled = useCallback(
    async (paths: string[], status: SvnStatusChar): Promise<void> => {
      // Check if shell integration and icon overlays are enabled
      if (!settings.integration?.shellExtensionEnabled || !settings.integration?.iconOverlaysEnabled) {
        return;
      }

      // Update all paths in parallel, errors are handled individually
      await Promise.allSettled(
        paths.map((path) => updateOverlayIfEnabled(path, status))
      );
    },
    [updateOverlayIfEnabled, settings.integration?.shellExtensionEnabled, settings.integration?.iconOverlaysEnabled]
  );

  /**
   * Invalidate all status caches for a path and its parents
   */
  const invalidateStatus = useCallback(
    (path: string) => {
      // Invalidate status for this path
      queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] });
      queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] });

      // Invalidate file listing (in case files were added/deleted)
      queryClient.invalidateQueries({ queryKey: ['fs:listDirectory', path] });

      // Invalidate parent directories too (folder aggregation changes)
      const separator = path.includes('\\') ? '\\' : '/';
      const parts = path.split(separator);
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join(separator);
        if (parentPath) {
          queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', parentPath] });
          queryClient.invalidateQueries({ queryKey: ['fs:getStatus', parentPath] });
        }
      }
    },
    [queryClient]
  );

  /**
   * SVN Update
   */
  const update = useCallback(
    async (path: string): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.update(path);

        if (result.success) {
          // Invalidate all status caches
          invalidateStatus(path);
          // Update overlay to clean status
          await updateOverlayIfEnabled(path, ' ');
          return { success: true, revision: result.revision };
        }

        return { success: false, message: 'Update failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlayIfEnabled]
  );

  /**
   * SVN Commit
   */
  const commit = useCallback(
    async (paths: string[], message: string): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.commit(paths, message);

        if (result.success) {
          // Invalidate all status caches for all committed paths
          for (const p of paths) {
            invalidateStatus(p);
          }
          // Update overlays to clean status for committed files
          await updateOverlaysIfEnabled(paths, ' ');
          return { success: true, revision: result.revision };
        }

        return { success: false, message: 'Commit failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlaysIfEnabled]
  );

  /**
   * SVN Revert
   */
  const revert = useCallback(
    async (paths: string[]): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.revert(paths);

        if (result.success) {
          // Invalidate all status caches for all reverted paths
          for (const p of paths) {
            invalidateStatus(p);
          }
          // Update overlays to clean status for reverted files
          await updateOverlaysIfEnabled(paths, ' ');
          return { success: true };
        }

        return { success: false, message: 'Revert failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlaysIfEnabled]
  );

  /**
   * SVN Add
   */
  const add = useCallback(
    async (paths: string[]): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.add(paths);

        if (result.success) {
          // Invalidate all status caches for all added paths
          for (const p of paths) {
            invalidateStatus(p);
          }
          // Update overlays to 'A' (added) status
          await updateOverlaysIfEnabled(paths, 'A');
          return { success: true };
        }

        return { success: false, message: 'Add failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlaysIfEnabled]
  );

  /**
   * SVN Delete
   */
  const del = useCallback(
    async (paths: string[]): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.delete(paths);

        if (result.success) {
          // Invalidate all status caches for all deleted paths
          for (const p of paths) {
            invalidateStatus(p);
          }
          // Update overlays to 'D' (deleted) status
          await updateOverlaysIfEnabled(paths, 'D');
          return { success: true };
        }

        return { success: false, message: 'Delete failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlaysIfEnabled]
  );

  /**
   * SVN Cleanup
   */
  const cleanup = useCallback(
    async (path: string): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.cleanup(path);

        if (result.success) {
          invalidateStatus(path);
          return { success: true };
        }

        return { success: false, message: 'Cleanup failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus]
  );

  /**
   * SVN Lock
   */
  const lock = useCallback(
    async (path: string, message?: string): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.lock(path, message);

        if (result.success) {
          invalidateStatus(path);
          return { success: true };
        }

        return { success: false, message: 'Lock failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus]
  );

  /**
   * SVN Unlock
   */
  const unlock = useCallback(
    async (path: string, force?: boolean): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.unlock(path, force);

        if (result.success) {
          invalidateStatus(path);
          return { success: true };
        }

        return { success: false, message: 'Unlock failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus]
  );

  /**
   * SVN Resolve
   */
  const resolve = useCallback(
    async (
      path: string,
      resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
    ): Promise<SvnActionResult> => {
      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await window.api.svn.resolve(path, resolution);

        if (result.success) {
          invalidateStatus(path);
          // After resolve, the file is typically modified (M) since we resolved a conflict
          // 'mine-full' and 'theirs-full' resolve completely, potentially leaving it clean
          // For simplicity, we mark as modified - the next status refresh will correct if needed
          await updateOverlayIfEnabled(path, 'M');
          return { success: true };
        }

        return { success: false, message: 'Resolve failed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLastError(message);
        return { success: false, message };
      } finally {
        setIsUpdating(false);
      }
    },
    [invalidateStatus, updateOverlayIfEnabled]
  );

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  return {
    update,
    commit,
    revert,
    add,
    delete: del,
    cleanup,
    lock,
    unlock,
    resolve,
    isUpdating,
    lastError,
    clearError,
    invalidateStatus,
  };
}

/**
 * Hook for lock management dialog state
 */
export function useLockManagement() {
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [lockDialogPath, setLockDialogPath] = useState<string | undefined>();
  const [selectedLockPath, setSelectedLockPath] = useState<string | undefined>();

  const openLockDialog = useCallback((workingCopyPath: string, selectedPath?: string) => {
    setLockDialogPath(workingCopyPath);
    setSelectedLockPath(selectedPath);
    setLockDialogOpen(true);
  }, []);

  const closeLockDialog = useCallback(() => {
    setLockDialogOpen(false);
    setLockDialogPath(undefined);
    setSelectedLockPath(undefined);
  }, []);

  return {
    lockDialogOpen,
    lockDialogPath,
    selectedLockPath,
    openLockDialog,
    closeLockDialog,
  };
}

// Hook specifically for file explorer actions
export function useFileExplorerActions(
  currentPath: string,
  selectedEntry: SvnStatusEntry | null,
  onRefresh: () => void,
  selectedPaths?: Set<string>
) {
  const svnActions = useSvnActions();
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitPaths, setCommitPaths] = useState<string[]>([]);
  const lockManagement = useLockManagement();

  // Get all selected paths as array
  const getSelectedPaths = useCallback(() => {
    if (selectedPaths && selectedPaths.size > 0) {
      return Array.from(selectedPaths);
    }
    if (selectedEntry) {
      return [selectedEntry.path];
    }
    return [];
  }, [selectedPaths, selectedEntry]);

  // Update current directory
  const handleUpdate = useCallback(async () => {
    const result = await svnActions.update(currentPath);
    if (result.success) {
      onRefresh();
    }
  }, [currentPath, svnActions, onRefresh]);

  // Commit - opens dialog
  const handleCommit = useCallback(() => {
    setCommitPaths([currentPath]);
    setCommitDialogOpen(true);
  }, [currentPath]);

  // Commit selected file(s)
  const handleCommitSelected = useCallback(() => {
    const paths = getSelectedPaths();
    if (paths.length > 0) {
      setCommitPaths(paths);
      setCommitDialogOpen(true);
    }
  }, [getSelectedPaths]);

  // Revert selected (supports multiple)
  const handleRevertSelected = useCallback(async () => {
    const paths = getSelectedPaths();
    if (paths.length > 0) {
      await svnActions.revert(paths);
      onRefresh();
    }
  }, [getSelectedPaths, svnActions, onRefresh]);

  // Add selected (supports multiple, only unversioned files)
  const handleAddSelected = useCallback(async () => {
    // For adding, we only add unversioned files (status '?')
    // Get paths that are unversioned - for now we check selectedEntry for single selection
    const pathsToAdd: string[] = [];

    if (selectedPaths && selectedPaths.size > 0) {
      // For multi-select, we need to check each path's status
      // Since we don't have direct access to status here, we'll add all selected paths
      // The SVN add command will fail for already-versioned files, which is acceptable
      pathsToAdd.push(...Array.from(selectedPaths));
    } else if (selectedEntry?.status === '?') {
      pathsToAdd.push(selectedEntry.path);
    }

    if (pathsToAdd.length > 0) {
      await svnActions.add(pathsToAdd);
      onRefresh();
    }
  }, [selectedPaths, selectedEntry, svnActions, onRefresh]);

  // Delete selected (supports multiple)
  const handleDeleteSelected = useCallback(async () => {
    const paths = getSelectedPaths();
    if (paths.length > 0) {
      const message =
        paths.length === 1
          ? `Are you sure you want to delete "${paths[0]}"?`
          : `Are you sure you want to delete ${paths.length} selected files?`;

      if (confirm(message)) {
        await svnActions.delete(paths);
        onRefresh();
      }
    }
  }, [getSelectedPaths, svnActions, onRefresh]);

  // Lock selected
  const handleLockSelected = useCallback(async () => {
    const paths = getSelectedPaths();
    if (paths.length > 0) {
      const message = prompt('Lock message (optional):');
      // Lock each path
      for (const path of paths) {
        await svnActions.lock(path, message || undefined);
      }
      onRefresh();
    }
  }, [getSelectedPaths, svnActions, onRefresh]);

  // Unlock selected
  const handleUnlockSelected = useCallback(async () => {
    const paths = getSelectedPaths();
    if (paths.length > 0) {
      for (const path of paths) {
        await svnActions.unlock(path);
      }
      onRefresh();
    }
  }, [getSelectedPaths, svnActions, onRefresh]);

  // Resolve selected conflict
  const handleResolveSelected = useCallback(
    async (
      resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
    ) => {
      const paths = getSelectedPaths();
      if (paths.length > 0) {
        for (const path of paths) {
          await svnActions.resolve(path, resolution);
        }
        onRefresh();
      }
    },
    [getSelectedPaths, svnActions, onRefresh]
  );

  // Manage locks - opens the lock management dialog
  const handleManageLocks = useCallback(
    (entry?: SvnStatusEntry) => {
      const path = entry?.path || selectedEntry?.path;
      lockManagement.openLockDialog(currentPath, path);
    },
    [currentPath, selectedEntry, lockManagement]
  );

  // Submit commit
  const handleSubmitCommit = useCallback(
    async (paths: string[], message: string) => {
      const result = await svnActions.commit(paths, message);
      if (result.success) {
        setCommitDialogOpen(false);
        onRefresh();
      }
      return result;
    },
    [svnActions, onRefresh]
  );

  return {
    // Actions
    handleUpdate,
    handleCommit,
    handleCommitSelected,
    handleRevertSelected,
    handleAddSelected,
    handleDeleteSelected,
    handleLockSelected,
    handleUnlockSelected,
    handleResolveSelected,
    handleManageLocks,
    cleanup: svnActions.cleanup,

    // Commit dialog
    commitDialogOpen,
    commitPaths,
    closeCommitDialog: () => setCommitDialogOpen(false),
    handleSubmitCommit,

    // Lock management dialog
    lockDialogOpen: lockManagement.lockDialogOpen,
    lockDialogPath: lockManagement.lockDialogPath,
    selectedLockPath: lockManagement.selectedLockPath,
    closeLockDialog: lockManagement.closeLockDialog,

    // State
    isUpdating: svnActions.isUpdating,
    lastError: svnActions.lastError,
    clearError: svnActions.clearError,
  };
}
