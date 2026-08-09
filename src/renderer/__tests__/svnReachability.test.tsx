import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../src/components/ui/CommandPalette';
import { flattenContextMenuItems, getSvnContextMenuItems } from '../src/components/ui/ContextMenu';
import { Toolbar } from '../src/components/ui/Toolbar';

describe('SVN workflow reachability', () => {
  it('lists every callback-backed user command in the command palette', () => {
    const props: React.ComponentProps<typeof CommandPalette> = {
      isOpen: true,
      onClose: vi.fn(),
      currentPath: 'C:\\work\\project',
      onCommit: vi.fn(),
      onUpdate: vi.fn(),
      onRevert: vi.fn(),
      onAdd: vi.fn(),
      onDelete: vi.fn(),
      onCleanup: vi.fn(),
      onResolve: vi.fn(),
      onMove: vi.fn(),
      onCopy: vi.fn(),
      onRename: vi.fn(),
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
      'Commit changes',
      'Update working copy',
      'Revert changes',
      'Add to version control',
      'Delete selected',
      'Clean up working copy',
      'Resolve conflict',
      'Move…',
      'Copy…',
      'Rename…',
      'Show log',
      'Quick commit',
      'Create branch…',
      'Create tag…',
      'Compare branches or tags…',
      'Switch…',
      'Merge…',
      'Relocate…',
      'Blame',
      'Properties…',
      'Changelist…',
      'Shelve changes…',
      'Unshelve changes…',
      'Lock…',
      'Unlock…',
      'Export…',
      'Import…',
      'Repository browser',
      'Revision graph',
      'Create patch…',
      'Apply patch…',
      'Refresh',
      'Go to: project',
      'Go to: legacy',
      'Bookmark: Trunk',
      'Add bookmark',
      'Toggle preview panel',
      'Toggle dual pane',
      'Toggle filter bar',
      'Quick notes',
      'Keyboard shortcuts',
      'Open settings',
      'Manage plugins',
    ].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });

  it('omits unavailable command-palette actions and does not execute them', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();

    render(<CommandPalette isOpen={true} onClose={onClose} onCommit={onCommit} />);

    expect(screen.getByText('Commit changes')).toBeInTheDocument();
    expect(screen.queryByText('Update working copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Create branch…')).not.toBeInTheDocument();
    expect(screen.queryByText('Add bookmark')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Commit changes'));

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

    expect(screen.getByText('Create branch…')).toBeInTheDocument();
    expect(screen.getByText('Create tag…')).toBeInTheDocument();
    expect(screen.getByText('Switch…')).toBeInTheDocument();
    expect(screen.getByText('Merge…')).toBeInTheDocument();
    expect(screen.getByText('Relocate…')).toBeInTheDocument();
  });

  it('lists branch, tag, switch, merge, and relocate in versioned context menus', () => {
    const items = getSvnContextMenuItems('M', true, {
      onBranchTag: vi.fn(),
      onTag: vi.fn(),
      onSwitch: vi.fn(),
      onMerge: vi.fn(),
      onRelocate: vi.fn(),
    });
    const labels = flattenContextMenuItems(items).map((item) => item.label);

    expect(labels).toContain('Create branch…');
    expect(labels).toContain('Create tag…');
    expect(labels).toContain('Switch…');
    expect(labels).toContain('Merge…');
    expect(labels).toContain('Relocate…');
  });

  it('exposes common working-copy actions from toolbar controls', () => {
    render(
      <Toolbar
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        onRevert={vi.fn()}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onCleanup={vi.fn()}
        onResolve={vi.fn()}
        onMove={vi.fn()}
        onCopy={vi.fn()}
        onRename={vi.fn()}
        hasChanges
        hasSelection
        isVersioned
      />
    );

    // Update and Commit are prominent toolbar buttons.
    expect(
      screen.getByRole('button', { name: 'Update working copy from repository' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit changes' })).toBeInTheDocument();

    // The remaining file actions are reachable via the "File actions" menu.
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
    [
      'Revert',
      'Add to version control',
      'Delete',
      'Cleanup',
      'Resolve conflict',
      'Move…',
      'Copy…',
      'Rename…',
    ].forEach((label) => {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    });
  });

  it('exposes common working-copy actions from context menus', () => {
    const labelsOf = (...args: Parameters<typeof getSvnContextMenuItems>) =>
      flattenContextMenuItems(getSvnContextMenuItems(...args)).map((item) => item.label);

    const modifiedFileLabels = labelsOf('M', false, {
      onRevert: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onCopy: vi.fn(),
      onRename: vi.fn(),
    });
    const unversionedLabels = labelsOf('?', false, {
      onAdd: vi.fn(),
      onDelete: vi.fn(),
    });
    const conflictedLabels = labelsOf('C', false, { onResolve: vi.fn() });
    const directoryLabels = labelsOf(' ', true, {
      onCleanup: vi.fn(),
      onExclude: vi.fn(),
    });

    expect(modifiedFileLabels).toEqual(
      expect.arrayContaining(['Revert', 'Delete (versioned)', 'Move…', 'Copy…', 'Rename…'])
    );
    expect(unversionedLabels).toEqual(expect.arrayContaining(['Add to version control', 'Delete']));
    expect(conflictedLabels).toContain('Resolve…');
    expect(directoryLabels).toContain('Clean up…');
    expect(directoryLabels).toContain('Remove from working copy…');
  });

  /*
   * 27 rows ran off the bottom of a laptop screen, so the occasional actions moved
   * into hover submenus. What must not happen is an action becoming unreachable,
   * or the top level growing back.
   */
  describe('menu grouping', () => {
    const everyAction = {
      onUpdate: vi.fn(),
      onCommit: vi.fn(),
      onRevert: vi.fn(),
      onDiff: vi.fn(),
      onPreview: vi.fn(),
      onShowLog: vi.fn(),
      onExclude: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onCopy: vi.fn(),
      onRename: vi.fn(),
      onBranchTag: vi.fn(),
      onTag: vi.fn(),
      onSwitch: vi.fn(),
      onMerge: vi.fn(),
      onRelocate: vi.fn(),
      onCreatePatch: vi.fn(),
      onApplyPatch: vi.fn(),
      onRevisionGraph: vi.fn(),
      onCheckForModifications: vi.fn(),
      onProperties: vi.fn(),
      onChangelist: vi.fn(),
      onShelve: vi.fn(),
      onCleanup: vi.fn(),
      onRepoBrowser: vi.fn(),
      onExport: vi.fn(),
      onOpenInExplorer: vi.fn(),
      onCopyPath: vi.fn(),
      editors: [{ id: 'vscode', label: 'VS Code', command: 'code' }],
      onOpenInEditor: vi.fn(),
    };

    it('keeps the top level short, with the occasional actions one level down', () => {
      const items = getSvnContextMenuItems('M', true, everyAction);
      const rows = items.filter((item) => !item.divider);

      // Was 25+ rows for a directory with everything wired.
      expect(rows.length).toBeLessThanOrEqual(12);
      expect(rows.filter((item) => item.submenu?.length).length).toBeGreaterThanOrEqual(3);

      // The daily verbs are not behind a hover.
      expect(rows.map((item) => item.id)).toEqual(
        expect.arrayContaining(['update', 'commit', 'revert', 'show-log', 'copy-path'])
      );
    });

    it('still reaches every action, and each exactly once', () => {
      const flattened = flattenContextMenuItems(getSvnContextMenuItems('M', true, everyAction));
      const ids = flattened.filter((item) => item.onClick).map((item) => item.id);

      expect(new Set(ids).size).toBe(ids.length);
      [
        'switch',
        'merge',
        'relocate',
        'create-patch',
        'apply-patch',
        'revision-graph',
        'check-mods',
        'properties',
        'changelist',
        'shelve',
        'cleanup',
        'repo-browser',
        'export',
        'move',
        'rename',
        'delete',
      ].forEach((id) => expect(ids).toContain(id));
    });

    it('names each group for what its actions are for', () => {
      const groups = getSvnContextMenuItems('M', true, everyAction)
        .filter((item) => item.submenu?.length)
        .map((item) => item.label);

      expect(groups).toEqual(
        expect.arrayContaining(['File actions', 'Branch & merge', 'Patches', 'History', 'Advanced'])
      );
    });

    it('promotes a group of one instead of hiding it behind a hover', () => {
      // Only `svn cleanup` applies, so "Advanced" would hold a single row.
      const items = getSvnContextMenuItems(' ', true, { onCleanup: vi.fn() });

      const cleanup = items.find((item) => item.id === 'cleanup');
      expect(cleanup?.label).toBe('Clean up…');
      expect(items.some((item) => item.label === 'Advanced')).toBe(false);
    });
  });

  describe('the "Open in" section', () => {
    const editors = [
      { id: 'vscode', label: 'VS Code', command: 'code' },
      { id: 'cursor', label: 'Cursor', command: 'cursor' },
    ];

    it('lists each detected editor in a submenu, naming the launcher it runs', () => {
      const onOpenInEditor = vi.fn();
      const items = getSvnContextMenuItems('M', false, { editors, onOpenInEditor });
      const openIn = items.find((item) => item.id === 'open-in-editor');

      expect(openIn?.label).toBe('Open in');
      expect(openIn?.submenu?.map((item) => item.label)).toEqual(['VS Code', 'Cursor']);
      expect(openIn?.submenu?.map((item) => item.command)).toEqual([
        'code <path>',
        'cursor <path>',
      ]);

      openIn?.submenu?.[1].onClick?.();
      expect(onOpenInEditor).toHaveBeenCalledWith('cursor');
    });

    it('offers a single editor directly — a submenu of one is a click for nothing', () => {
      const onOpenInEditor = vi.fn();
      const items = getSvnContextMenuItems('M', false, {
        editors: [editors[0]],
        onOpenInEditor,
      });

      const direct = items.find((item) => item.id === 'open-in-vscode');
      expect(direct?.label).toBe('Open in VS Code');
      expect(direct?.submenu).toBeUndefined();
      expect(items.some((item) => item.id === 'open-in-editor')).toBe(false);
      direct?.onClick?.();
      expect(onOpenInEditor).toHaveBeenCalledWith('vscode');
    });

    it('says nothing at all when no editor was found on PATH', () => {
      const items = getSvnContextMenuItems('M', false, { editors: [], onOpenInEditor: vi.fn() });
      expect(items.some((item) => item.id.startsWith('open-in-'))).toBe(false);
    });

    /* An application the user added themselves, from Settings. */
    it('offers an application only for the kind of entry it suits', () => {
      const custom = [
        {
          id: 'custom:folders-only',
          label: 'Terminal here',
          command: 'wezterm',
          appliesTo: 'folders' as const,
          custom: true,
        },
        {
          id: 'custom:files-only',
          label: 'Hex editor',
          command: 'hexed',
          appliesTo: 'files' as const,
          custom: true,
        },
        { id: 'vscode', label: 'VS Code', command: 'code' },
      ];

      const onFile = flattenContextMenuItems(
        getSvnContextMenuItems('M', false, { editors: custom, onOpenInEditor: vi.fn() })
      ).map((item) => item.label);
      const onFolder = flattenContextMenuItems(
        getSvnContextMenuItems(' ', true, { editors: custom, onOpenInEditor: vi.fn() })
      ).map((item) => item.label);

      expect(onFile).toContain('Hex editor');
      expect(onFile).not.toContain('Terminal here');
      expect(onFolder).toContain('Terminal here');
      expect(onFolder).not.toContain('Hex editor');
      // An editor with no preference suits both.
      expect(onFile).toContain('VS Code');
      expect(onFolder).toContain('VS Code');
    });

    it('offers a way to add one, at the end of the list it would appear in', () => {
      const onConfigureOpenWith = vi.fn();
      const items = getSvnContextMenuItems('M', false, {
        editors,
        onOpenInEditor: vi.fn(),
        onConfigureOpenWith,
      });
      const group = items.find((item) => item.id === 'open-in-editor');

      const last = group?.submenu?.[group.submenu.length - 1];
      expect(last?.label).toBe('Add an application…');
      last?.onClick?.();
      expect(onConfigureOpenWith).toHaveBeenCalledTimes(1);
    });
  });

  it('offers removal from the working copy for files too, not only folders', () => {
    const fileLabels = flattenContextMenuItems(
      getSvnContextMenuItems('M', false, { onExclude: vi.fn() })
    ).map((item) => item.label);
    expect(fileLabels).toContain('Remove from working copy…');

    // Nothing to exclude for a path that was never fetched, or for the root.
    const notCheckedOutLabels = flattenContextMenuItems(
      getSvnContextMenuItems('O', true, { onExclude: vi.fn() })
    ).map((item) => item.label);
    expect(notCheckedOutLabels).not.toContain('Remove from working copy…');
  });
});
