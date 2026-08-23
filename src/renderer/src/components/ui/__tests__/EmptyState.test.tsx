/**
 * EmptyState (#93): icon + title + description + primary/secondary CTA, in the
 * welcome screen's visual language. CTAs must be real buttons that fire.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderOpen, GitBranch } from 'lucide-react';

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the icon, title, description and hint', () => {
    const { container } = render(
      <EmptyState
        icon={FolderOpen}
        title="No working copy selected"
        description="Open a repository, then History shows its commit log."
        hint="press ⌘K for commands"
      />
    );
    expect(screen.getByText('No working copy selected')).toBeInTheDocument();
    expect(
      screen.getByText('Open a repository, then History shows its commit log.')
    ).toBeInTheDocument();
    expect(screen.getByText('press ⌘K for commands')).toBeInTheDocument();
    // The icon is decorative — rendered, never announced.
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('fires the primary and secondary CTA callbacks', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <EmptyState
        icon={GitBranch}
        title="No working copies yet"
        primaryAction={{ label: 'Checkout…', onClick: onPrimary, icon: GitBranch }}
        secondaryAction={{ label: 'Open working copy…', onClick: onSecondary }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Checkout…/ }));
    expect(onPrimary).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Open working copy…/ }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('uses the illustration slot instead of the icon chip when given', () => {
    render(
      <EmptyState illustration={<svg data-testid="illus" />} title="Nothing here" />
    );
    expect(screen.getByTestId('illus')).toBeInTheDocument();
  });

  it('renders the section variant without centring fills', () => {
    const { container } = render(
      <EmptyState variant="section" icon={FolderOpen} title="No shelves" />
    );
    expect(container.firstElementChild?.className).not.toContain('flex-1');
    expect(screen.getByText('No shelves')).toBeInTheDocument();
  });
});
