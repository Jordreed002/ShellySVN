import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';
import { useFileExplorerSelection } from '../src/components/files/useFileExplorerSelection';

describe('useFileExplorerSelection', () => {
  it('selects a file from an ancestor Miller column', () => {
    const childEntry: SvnStatusEntry = {
      path: '/workspace/folder/child.txt',
      status: ' ',
      isDirectory: false,
    };
    const siblingEntry: SvnStatusEntry = {
      path: '/workspace/sibling.txt',
      status: ' ',
      isDirectory: false,
    };
    const { result } = renderHook(() => useFileExplorerSelection([childEntry]));

    act(() => result.current.handleSelect(siblingEntry));

    expect(result.current.selectedPaths).toEqual(new Set([siblingEntry.path]));
    expect(result.current.selectedEntryFallback).toEqual(siblingEntry);
  });
});
