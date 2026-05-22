import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SVN_EVENTS } from '../src/lib/svnOperationEvents';
import {
  type FileExplorerOperationContext,
  useFileExplorerCommandEvents,
} from '../src/components/files/useFileExplorerCommandEvents';

function createActions() {
  return {
    handleRevertSelected: vi.fn(),
    handleAddSelected: vi.fn(),
    handleDeleteSelected: vi.fn(),
    cleanup: vi.fn(),
    handleResolveSelected: vi.fn(),
  };
}

function createOptions(overrides: Partial<FileExplorerOperationContext> = {}) {
  const actions = createActions();
  const context: FileExplorerOperationContext = {
    actions: actions as unknown as FileExplorerOperationContext['actions'],
    path: '/repo',
    queryClient: new QueryClient(),
    selectedEntry: {
      path: '/repo/file.txt',
      name: 'file.txt',
      status: 'M',
      isDirectory: false,
    },
    ...overrides,
  };

  return {
    actions,
    operationContextRef: { current: context },
    setApplyPatchPath: vi.fn(),
    setBlamePath: vi.fn(),
    setBranchTagCompareOpen: vi.fn(),
    setBranchTagMode: vi.fn(),
    setBranchTagPath: vi.fn(),
    setChangelistPath: vi.fn(),
    setCreatePatchPath: vi.fn(),
    setExportPath: vi.fn(),
    setImportDialogOpen: vi.fn(),
    setLockManagementPath: vi.fn(),
    setMergePath: vi.fn(),
    setMoveRenameTarget: vi.fn(),
    setPropertiesPath: vi.fn(),
    setRelocatePath: vi.fn(),
    setRepoBrowserUrl: vi.fn(),
    setResolveEntry: vi.fn(),
    setRevisionGraphPath: vi.fn(),
    setShelveDialogPath: vi.fn(),
    setSwitchPath: vi.fn(),
  };
}

describe('useFileExplorerCommandEvents', () => {
  it('opens branch and tag dialogs from command events', () => {
    const options = createOptions();
    renderHook(() => useFileExplorerCommandEvents(options));

    window.dispatchEvent(new Event(SVN_EVENTS.BRANCH_TAG));
    expect(options.setBranchTagPath).toHaveBeenCalledWith('/repo');
    expect(options.setBranchTagMode).toHaveBeenCalledWith('branch');

    window.dispatchEvent(new Event(SVN_EVENTS.TAG));
    expect(options.setBranchTagPath).toHaveBeenCalledWith('/repo');
    expect(options.setBranchTagMode).toHaveBeenCalledWith('tag');
  });

  it('uses the selected file for file-scoped command events', () => {
    const options = createOptions();
    renderHook(() => useFileExplorerCommandEvents(options));

    window.dispatchEvent(new Event(SVN_EVENTS.BLAME));
    window.dispatchEvent(new Event(SVN_EVENTS.PROPERTIES));
    window.dispatchEvent(new Event(SVN_EVENTS.MOVE));

    expect(options.setBlamePath).toHaveBeenCalledWith('/repo/file.txt');
    expect(options.setPropertiesPath).toHaveBeenCalledWith('/repo/file.txt');
    expect(options.setMoveRenameTarget).toHaveBeenCalledWith({
      path: '/repo/file.txt',
      mode: 'move',
    });
  });

  it('routes action command events through the latest operation context', () => {
    const options = createOptions({
      selectedEntry: {
        path: '/repo/nested',
        name: 'nested',
        status: ' ',
        isDirectory: true,
      },
    });
    renderHook(() => useFileExplorerCommandEvents(options));

    window.dispatchEvent(new Event(SVN_EVENTS.CLEANUP));
    window.dispatchEvent(new Event(SVN_EVENTS.REVERT));

    expect(options.actions.cleanup).toHaveBeenCalledWith('/repo/nested');
    expect(options.actions.handleRevertSelected).toHaveBeenCalled();
  });
});
