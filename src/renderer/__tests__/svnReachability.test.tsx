import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../src/components/ui/CommandPalette';
import { getSvnContextMenuItems } from '../src/components/ui/ContextMenu';

describe('SVN workflow reachability', () => {
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
