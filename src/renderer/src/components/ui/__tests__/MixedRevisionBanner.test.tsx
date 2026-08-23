import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import { MixedRevisionBanner } from '../MixedRevisionBanner';
import type { MixedRevisionSummary } from '@renderer/lib/workingCopyFreshness';

function makeSummary(overrides: Partial<MixedRevisionSummary> = {}): MixedRevisionSummary {
  return {
    baseRevision: 18,
    maxRevision: 22,
    itemCount: 2,
    items: ['/wc/src/a.ts', '/wc/src/b.ts'],
    signature: '18:22:2',
    ...overrides,
  };
}

describe('MixedRevisionBanner', () => {
  afterEach(cleanup);

  it('renders nothing without a mixed state', () => {
    const { container } = render(
      <MixedRevisionBanner summary={null} onUpdateToHead={vi.fn()} />
    );
    expect(container.childElementCount).toBe(0);
  });

  it('renders nothing when the summary carries no items', () => {
    const { container } = render(
      <MixedRevisionBanner summary={makeSummary({ itemCount: 0, items: [] })} onUpdateToHead={vi.fn()} />
    );
    expect(container.childElementCount).toBe(0);
  });

  it('states the revision range, the item count, and sample paths', () => {
    render(<MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} />);
    expect(screen.getByText(/r18…r22 · 2 items/)).toBeInTheDocument();
    expect(screen.getByText(/\/wc\/src\/a\.ts, \/wc\/src\/b\.ts/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Mixed-revision working copy' })).toBeInTheDocument();
  });

  it('summarises long item lists instead of listing every path', () => {
    render(
      <MixedRevisionBanner
        summary={makeSummary({
          itemCount: 5,
          items: ['/wc/a', '/wc/b', '/wc/c', '/wc/d', '/wc/e'],
          signature: '18:22:5',
        })}
        onUpdateToHead={vi.fn()}
      />
    );
    expect(screen.getByText(/\/wc\/a, \/wc\/b, \/wc\/c \+2 more/)).toBeInTheDocument();
  });

  it('runs the update action from the Update to HEAD button', () => {
    const onUpdateToHead = vi.fn();
    render(<MixedRevisionBanner summary={makeSummary()} onUpdateToHead={onUpdateToHead} />);
    fireEvent.click(screen.getByRole('button', { name: /update to head/i }));
    expect(onUpdateToHead).toHaveBeenCalledOnce();
  });

  it('disables the action and shows progress while an update runs', () => {
    render(
      <MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} isUpdating />
    );
    const button = screen.getByRole('button', { name: /updating…/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /update to head/i })).not.toBeInTheDocument();
  });

  it('dismisses per mixed state and returns when the state changes', () => {
    const { rerender } = render(
      <MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss mixed-revision notice/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Same signature stays dismissed…
    rerender(
      <MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} />
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // …a genuinely different mixed state is surfaced again.
    rerender(
      <MixedRevisionBanner
        summary={makeSummary({ baseRevision: 19, maxRevision: 23, signature: '19:23:2' })}
        onUpdateToHead={vi.fn()}
      />
    );
    expect(screen.getByText(/r19…r23 · 2 items/)).toBeInTheDocument();
  });

  it('re-arms dismissal when an update starts, so its outcome is reported', () => {
    const { rerender } = render(
      <MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss mixed-revision notice/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(
      <MixedRevisionBanner summary={makeSummary()} onUpdateToHead={vi.fn()} isUpdating />
    );
    expect(screen.getByRole('status', { name: 'Mixed-revision working copy' })).toBeInTheDocument();
  });
});
