import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../src/components/ui/CommandPalette';
import { getSvnContextMenuItems } from '../src/components/ui/ContextMenu';

describe('SVN workflow reachability', () => {
  it('lists every callback-backed user command in the command palette', () => {
    const props: React.ComponentProps<typeof CommandPalette> = {
      isOpen: true,
      onClose: vi.fn(),
      currentPath: 'C:\\work\\project',
      onCommit: vi.fn(),
      onUpdate: vi.fn(),
      onRevert: vi.fn(),
      onShowLog: vi.fn(),
      onRefresh: vi.fn(),
      onOpenSettings: vi.fn(),
      onTogglePreview: vi.fn(),
      onToggleDualPane: vi.fn(),
      onToggleFilters: vi.fn(),
      onShowShortcuts: vi.fn(),
      onShowNotes: vi.fn(),
      onQuickCommit: vi.fn(),
      onAddBookmark: vi.fn(),
      onGoToPath: vi.fn(),
      onBranchTag: vi.fn(),
      onTag: vi.fn(),
      onBranchTagCompare: vi.fn(),
      onSwitch: vi.fn(),
      onMerge: vi.fn(),
      onRelocate: vi.fn(),
      onBlame: vi.fn(),
      onProperties: vi.fn(),
      onChangelist: vi.fn(),
      onShelve: vi.fn(),
      onUnshelve: vi.fn(),
      onLock: vi.fn(),
      onUnlock: vi.fn(),
      onExport: vi.fn(),
      onImport: vi.fn(),
      onRepoBrowser: vi.fn(),
      onRevisionGraph: vi.fn(),
      onCreatePatch: vi.fn(),
      onApplyPatch: vi.fn(),
      onManagePlugins: vi.fn(),
      recentPaths: ['C:\\work\\project', 'C:\\work\\legacy'],
      bookmarks: [{ path: 'C:\\work\\trunk', name: 'Trunk' }],
    };

    render(<CommandPalette {...props} />);

    [
      'Commit Changes',
      'Update Working Copy',
      'Revert Changes',
      'Show Log',
      'Quick Commit',
      'Create Branch...',
      'Create Tag...',
      'Compare Branches/Tags...',
      'Switch...',
      'Merge...',
      'Relocate...',
      'Blame/Annotate',
      'Properties...',
      'Changelist...',
      'Shelve Changes...',
      'Unshelve Changes...',
      'Lock...',
      'Unlock...',
      'Export...',
      'Import...',
      'Repository Browser',
      'Revision Graph',
      'Create Patch...',
      'Apply Patch...',
      'Refresh',
      'Go to: project',
      'Go to: legacy',
      'Bookmark: Trunk',
      'Add Bookmark',
      'Toggle Preview Panel',
      'Toggle Dual Pane',
      'Toggle Filter Bar',
      'Quick Notes',
      'Keyboard Shortcuts',
      'Open Settings',
      'Manage Plugins',
    ].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });

  it('omits unavailable command-palette actions and does not execute them', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();

    render(<CommandPalette isOpen={true} onClose={onClose} onCommit={onCommit} />);

    expect(screen.getByText('Commit Changes')).toBeInTheDocument();
    expect(screen.queryByText('Update Working Copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Branch...')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Bookmark')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Commit Changes'));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists branch, tag, switch, merge, and relocate in the command palette', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={vi.fn()}
        onBranchTag={vi.fn()}
        onTag={vi.fn()}
        onSwitch={vi.fn()}
        onMerge={vi.fn()}
        onRelocate={vi.fn()}
      />
    );

    expect(screen.getByText('Create Branch...')).toBeInTheDocument();
    expect(screen.getByText('Create Tag...')).toBeInTheDocument();
    expect(screen.getByText('Switch...')).toBeInTheDocument();
    expect(screen.getByText('Merge...')).toBeInTheDocument();
    expect(screen.getByText('Relocate...')).toBeInTheDocument();
  });

  it('lists branch, tag, switch, merge, and relocate in versioned context menus', () => {
    const items = getSvnContextMenuItems('M', true, {
      onBranchTag: vi.fn(),
      onTag: vi.fn(),
      onSwitch: vi.fn(),
      onMerge: vi.fn(),
      onRelocate: vi.fn(),
    });
    const labels = items.map((item) => item.label);

    expect(labels).toContain('Create Branch...');
    expect(labels).toContain('Create Tag...');
    expect(labels).toContain('Switch...');
    expect(labels).toContain('Merge...');
    expect(labels).toContain('Relocate...');
  });
});
