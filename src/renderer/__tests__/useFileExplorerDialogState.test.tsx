import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFileExplorerDialogState } from '../src/components/files/useFileExplorerDialogState';

describe('useFileExplorerDialogState', () => {
  it('starts with all optional dialogs closed', () => {
    const { result } = renderHook(() => useFileExplorerDialogState());

    expect(result.current.diffViewerPath).toBeNull();
    expect(result.current.logViewerPath).toBeNull();
    expect(result.current.settingsDialogOpen).toBe(false);
    expect(result.current.updateDialogOpen).toBe(false);
    expect(result.current.branchTagPath).toBeNull();
    expect(result.current.branchTagCompareOpen).toBe(false);
    expect(result.current.isImportDialogOpen).toBe(false);
    expect(result.current.showPreview).toBe(false);
    expect(result.current.showNotes).toBe(false);
  });

  it('keeps related dialog values independently updatable', () => {
    const { result } = renderHook(() => useFileExplorerDialogState());

    act(() => {
      result.current.setBranchTagPath('C:/repo');
      result.current.setBranchTagMode('tag');
      result.current.setMoveRenameTarget({ path: 'C:/repo/file.txt', mode: 'rename' });
      result.current.setShowPreview(true);
    });

    expect(result.current.branchTagPath).toBe('C:/repo');
    expect(result.current.branchTagMode).toBe('tag');
    expect(result.current.moveRenameTarget).toEqual({ path: 'C:/repo/file.txt', mode: 'rename' });
    expect(result.current.showPreview).toBe(true);
    expect(result.current.diffViewerPath).toBeNull();
  });
});
