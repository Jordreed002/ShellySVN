import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

import { Toolbar } from '../src/components/ui/Toolbar';

/*
 * The file explorer's server-facing controls.
 *
 * `svn ls` describes the server and `svn status` describes your disk, so the
 * toolbar has exactly two things to offer about the server: a way to *go* to
 * the repository browser (the one screen that lists the server), and a way to
 * include the entries the repository has here that this disk does not — which
 * have presence, never status.
 */

// The presence toggle is a view setting, so it lives in the View options menu.
function openViewMenu() {
  fireEvent.click(screen.getByLabelText('View options'));
}

describe('Toolbar — "Show items not checked out"', () => {
  const onToggleNotCheckedOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers the toggle in the view menu inside a working copy', () => {
    render(
      <Toolbar
        isVersioned={true}
        showNotCheckedOut={false}
        onToggleNotCheckedOut={onToggleNotCheckedOut}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show items not checked out' })
    ).toBeInTheDocument();
  });

  it('does not offer the toggle outside a working copy — there is no checkout to compare against', () => {
    render(
      <Toolbar
        isVersioned={false}
        showNotCheckedOut={false}
        onToggleNotCheckedOut={onToggleNotCheckedOut}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Show items not checked out' })
    ).not.toBeInTheDocument();
  });

  it('calls onToggleNotCheckedOut when chosen', () => {
    render(
      <Toolbar
        isVersioned={true}
        showNotCheckedOut={false}
        onToggleNotCheckedOut={onToggleNotCheckedOut}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show items not checked out' }));

    expect(onToggleNotCheckedOut).toHaveBeenCalledTimes(1);
  });

  it('marks the toggle checked when those entries are shown', () => {
    render(
      <Toolbar
        isVersioned={true}
        showNotCheckedOut={true}
        onToggleNotCheckedOut={onToggleNotCheckedOut}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show items not checked out' })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('names the command it runs, so the source of those entries is never a mystery', () => {
    render(
      <Toolbar
        isVersioned={true}
        showNotCheckedOut={false}
        onToggleNotCheckedOut={onToggleNotCheckedOut}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    openViewMenu();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show items not checked out' })
    ).toHaveTextContent('svn list --depth immediates');
  });
});

describe('Toolbar — Local / Online', () => {
  const onBrowseOnline = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows both controls, with Local as the view you are in', () => {
    render(
      <Toolbar
        isVersioned={true}
        canBrowseOnline={true}
        onBrowseOnline={onBrowseOnline}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Local files')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Online repository')).toHaveAttribute('aria-checked', 'false');
  });

  it('hands off to the repository browser when Online is chosen', () => {
    render(
      <Toolbar
        isVersioned={true}
        canBrowseOnline={true}
        onBrowseOnline={onBrowseOnline}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Online repository'));

    expect(onBrowseOnline).toHaveBeenCalledTimes(1);
  });

  it('says where Online goes, rather than implying a second listing here', () => {
    render(
      <Toolbar
        isVersioned={true}
        canBrowseOnline={true}
        onBrowseOnline={onBrowseOnline}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Online repository')).toHaveAttribute(
      'title',
      'Browse the repository on the server — svn list (opens the repository browser)'
    );
  });

  it('hides the pair when no repository URL could be resolved for this folder', () => {
    render(
      <Toolbar
        isVersioned={true}
        canBrowseOnline={false}
        onBrowseOnline={onBrowseOnline}
        explorerViewMode="list"
        onExplorerViewModeChange={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Online repository')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Local files')).not.toBeInTheDocument();
  });
});
