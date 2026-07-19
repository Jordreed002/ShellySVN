import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

import { Toolbar } from '../src/components/ui/Toolbar';

// "Show remote items" now lives inside the View options menu (it's a view
// setting), so these tests open that menu before asserting.
function openViewMenu() {
  fireEvent.click(screen.getByLabelText('View options'));
}

describe('Toolbar - Show Remote Items Toggle', () => {
  const mockOnToggleRemoteItems = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers the remote items toggle in the view menu when versioned and local', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show remote items' })).toBeInTheDocument();
  });

  it('does not offer the toggle when not versioned', () => {
    render(
      <Toolbar
        isVersioned={false}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show remote items' })).not.toBeInTheDocument();
  });

  it('does not offer the toggle when in online mode', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="online"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show remote items' })).not.toBeInTheDocument();
  });

  it('calls onToggleRemoteItems when chosen', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show remote items' }));

    expect(mockOnToggleRemoteItems).toHaveBeenCalledTimes(1);
  });

  it('marks the toggle checked when remote items are shown', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={true}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show remote items' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});

describe('Toolbar - Browse Mode Toggle Integration', () => {
  const mockOnBrowseModeChange = vi.fn();
  const mockOnToggleRemoteItems = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the local/online toggle and offers remote items in the view menu', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        canBrowseOnline={true}
        onBrowseModeChange={mockOnBrowseModeChange}
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    openViewMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show remote items' })).toBeInTheDocument();
  });

  it('does not offer remote items when in online mode', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="online"
        canBrowseOnline={true}
        onBrowseModeChange={mockOnBrowseModeChange}
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    openViewMenu();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show remote items' })).not.toBeInTheDocument();
  });
});
