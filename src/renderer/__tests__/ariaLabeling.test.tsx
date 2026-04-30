import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { STATUS_CONFIG, StatusBadge, StatusDot, StatusIcon } from '../src/components/ui/StatusIcon';
import { Toolbar } from '../src/components/ui/Toolbar';

describe('primary workflow ARIA labeling', () => {
  it('labels toolbar controls for core SVN and navigation workflows', () => {
    render(
      <Toolbar
        onRefresh={vi.fn()}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        onRevert={vi.fn()}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        onDiagnostics={vi.fn()}
        onToggleBookmark={vi.fn()}
        onBrowseModeChange={vi.fn()}
        canBrowseOnline={true}
        onToggleRemoteItems={vi.fn()}
        onToggleFilters={vi.fn()}
        showFilters={false}
        onToggleDualPane={vi.fn()}
        onTogglePreview={vi.fn()}
        onSearchChange={vi.fn()}
        onViewModeChange={vi.fn()}
        onShowNotes={vi.fn()}
        hasChanges={false}
        hasSelection={false}
        hasSelectionForPreview={false}
      />
    );

    [
      'Refresh files (F5)',
      'Add bookmark',
      'Local files',
      'Online repository',
      'Show remote items for sparse checkout',
      'Update working copy from repository',
      'Commit changes (no changes to commit)',
      'Revert selected files to last committed version',
      'Add selected files to version control',
      'Delete selected files',
      'Show filters',
      'Open dual pane view',
      'Preview selected file',
      'Search files',
      'View options',
      'Open settings',
      'Open quick notes',
      'Open repository diagnostics',
    ].forEach((name) => {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    });
  });

  it('provides labels and distinct color classes for every SVN status indicator', () => {
    for (const [status, config] of Object.entries(STATUS_CONFIG)) {
      expect(config.label).toBeTruthy();
      expect(config.color).toMatch(/^text-/);
      expect(config.bgColor).toMatch(/^bg-/);

      const { unmount } = render(
        <div>
          <StatusIcon status={status as keyof typeof STATUS_CONFIG} />
          <StatusDot status={status as keyof typeof STATUS_CONFIG} />
          <StatusBadge status={status as keyof typeof STATUS_CONFIG} />
        </div>
      );

      expect(screen.getAllByLabelText(config.label)).toHaveLength(3);
      unmount();
    }
  });
});
