/**
 * What these tests defend in the rail's local-fact sections:
 *
 * - Nothing is rendered for a state we have not measured, and no section
 *   invents a zero to fill the space.
 * - A shelf row acts on *its own* working copy, and says which one that is when
 *   the rail holds more than one checkout.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProblemsSection, ShelvesSection } from '../LocalFacts';
import type { RailShelf } from '../sidebarData';

const shelf = (over: Partial<RailShelf> = {}): RailShelf => ({
  workingCopyPath: '/wc/intranet',
  workingCopyName: 'intranet',
  name: 'wip-payments-ui',
  date: '2026-07-27T17:40:00Z',
  age: 'yesterday',
  ...over,
});

describe('ProblemsSection', () => {
  it('renders nothing when no measured working copy has a problem', () => {
    const { container } = render(
      <ProblemsSection problems={{ rows: [], total: 0, unmeasured: 0 }} attributeWorkingCopy />
    );

    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Problems')).toBeNull();
  });

  it('does not appear merely because working copies are still being measured', () => {
    const { container } = render(
      <ProblemsSection problems={{ rows: [], total: 0, unmeasured: 3 }} attributeWorkingCopy />
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('ShelvesSection', () => {
  const noop = () => {};

  it('renders nothing when there are no shelves, no note and nothing unsupported', () => {
    const { container } = render(
      <ShelvesSection
        shelves={[]}
        unsupported={[]}
        attributeWorkingCopy={false}
        onOpenShelves={noop}
      />
    );

    expect(container.innerHTML).toBe('');
  });

  it('names the working copy on every shelf when the rail holds several', () => {
    render(
      <ShelvesSection
        shelves={[
          shelf(),
          shelf({
            workingCopyPath: '/wc/website',
            workingCopyName: 'website',
            name: 'spike-virtual-list',
            age: 'last week',
          }),
        ]}
        unsupported={[]}
        attributeWorkingCopy
        onOpenShelves={noop}
      />
    );

    expect(screen.getByText('Shelves')).toBeTruthy();
    expect(screen.getByText('intranet · yesterday')).toBeTruthy();
    expect(screen.getByText('website · last week')).toBeTruthy();
  });

  it('leaves the working copy out of the sub-line when there is only one checkout', () => {
    render(
      <ShelvesSection
        shelves={[shelf()]}
        unsupported={[]}
        attributeWorkingCopy={false}
        onOpenShelves={noop}
      />
    );

    expect(screen.getByText('yesterday')).toBeTruthy();
  });

  it('opens the shelf manager for the working copy the shelf belongs to', () => {
    const onOpenShelves = vi.fn();
    render(
      <ShelvesSection
        shelves={[shelf({ workingCopyPath: '/wc/website', workingCopyName: 'website' })]}
        unsupported={[]}
        attributeWorkingCopy
        onOpenShelves={onOpenShelves}
      />
    );

    fireEvent.click(screen.getByLabelText('Shelf wip-payments-ui in website'));
    expect(onOpenShelves).toHaveBeenCalledWith('/wc/website');
  });

  it('states plainly that a client cannot shelve instead of reporting a failure', () => {
    render(
      <ShelvesSection
        shelves={[]}
        unsupported={[
          { path: '/wc/website', name: 'website', reason: 'unknown command: shelf-list' },
        ]}
        attributeWorkingCopy={false}
        onOpenShelves={noop}
      />
    );

    expect(screen.getByText(/does not support shelving/)).toBeTruthy();
    expect(screen.getByText(/needs Subversion 1.14 or newer/)).toBeTruthy();
  });

  it('offers the shelve affordance for the named working copy only', () => {
    const onOpenShelves = vi.fn();
    render(
      <ShelvesSection
        shelves={[]}
        unsupported={[]}
        attributeWorkingCopy={false}
        onOpenShelves={onOpenShelves}
        shelveTarget={{ path: '/wc/intranet', name: 'intranet', hasChanges: true }}
        emptyNote="No shelves in intranet"
      />
    );

    expect(screen.getByText('No shelves in intranet')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Shelve changes in intranet'));
    expect(onOpenShelves).toHaveBeenCalledWith('/wc/intranet');
  });

  it('does not promise a shelve when the working copy has no local changes', () => {
    render(
      <ShelvesSection
        shelves={[shelf()]}
        unsupported={[]}
        attributeWorkingCopy={false}
        onOpenShelves={noop}
        shelveTarget={{ path: '/wc/intranet', name: 'intranet', hasChanges: false }}
      />
    );

    expect(screen.getByLabelText('Shelves in intranet')).toBeTruthy();
  });
});
