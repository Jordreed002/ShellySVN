import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { useFileExplorerKeyboardNavigation } from '../src/components/files/useFileExplorerSelection';
import { KeyboardShortcutsDialog } from '../src/components/ui/KeyboardShortcutsDialog';
import { useShortcutBindings } from '../src/hooks/useShortcutBindings';

const entries = [
  { path: 'C:\\wc\\src', name: 'src', status: 'normal', isDirectory: true },
  { path: 'C:\\wc\\src\\app.ts', name: 'app.ts', status: 'M', isDirectory: false },
] as const;

describe('keyboard shortcut parity', () => {
  it('documents file explorer, SVN, diff, log, conflict, and dialog shortcuts', () => {
    render(<KeyboardShortcutsDialog isOpen={true} onClose={vi.fn()} />);

    [
      'Navigation',
      'Selection',
      'SVN Actions',
      'Conflicts',
      'View',
      'General',
      'Dialogs',
      'Navigate files',
      'Open folder',
      'Delete selected files',
      'Commit changes',
      'Update working copy',
      'Show diff',
      'Show log',
      'Next conflict',
      'Previous conflict',
      'Save merge result',
      'Close conflict editor',
      'Confirm focused action',
      'Close dialog',
    ].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('keeps customizable SVN shortcut defaults aligned with the shortcut reference', async () => {
    window.api = {
      store: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
      },
    } as unknown as Window['api'];

    const { result } = renderHook(() => useShortcutBindings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'commit', currentKey: 'Ctrl+S', enabled: true }),
        expect.objectContaining({ id: 'update', currentKey: 'Ctrl+U', enabled: true }),
        expect.objectContaining({ id: 'revert', currentKey: 'Ctrl+R', enabled: true }),
        expect.objectContaining({ id: 'diff', currentKey: 'Ctrl+D', enabled: true }),
        expect.objectContaining({ id: 'log', currentKey: 'Ctrl+L', enabled: true }),
        expect.objectContaining({ id: 'command-palette', currentKey: 'Ctrl+Shift+P', enabled: true }),
      ])
    );
  });

  it('handles file explorer keyboard navigation and selection shortcuts', () => {
    const setSelectedPaths = vi.fn();
    const setFocusedIndex = vi.fn();
    const scrollToIndex = vi.fn();

    renderHook(() =>
      useFileExplorerKeyboardNavigation({
        entries,
        selectedPaths: new Set(),
        focusedIndex: -1,
        virtualizer: { scrollToIndex },
        disabled: false,
        onNavigateToEntry: vi.fn(),
        setSelectedPaths,
        setFocusedIndex,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

    expect(setSelectedPaths).toHaveBeenCalledWith(new Set(['C:\\wc\\src']));
    expect(setFocusedIndex).toHaveBeenCalledWith(0);
    expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'auto' });
  });

  it('opens folders, selects all files, and clears selection from file explorer shortcuts', () => {
    const onNavigateToEntry = vi.fn();
    const setSelectedPaths = vi.fn();
    const setFocusedIndex = vi.fn();

    renderHook(() =>
      useFileExplorerKeyboardNavigation({
        entries,
        selectedPaths: new Set(['C:\\wc\\src']),
        focusedIndex: 0,
        virtualizer: { scrollToIndex: vi.fn() },
        disabled: false,
        onNavigateToEntry,
        setSelectedPaths,
        setFocusedIndex,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onNavigateToEntry).toHaveBeenCalledWith(entries[0]);
    expect(setSelectedPaths).toHaveBeenCalledWith(
      new Set(['C:\\wc\\src', 'C:\\wc\\src\\app.ts'])
    );
    expect(setSelectedPaths).toHaveBeenCalledWith(new Set());
    expect(setFocusedIndex).toHaveBeenCalledWith(-1);
  });
});
