import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import { OodCheckPanel } from '../OodCheckPanel';
import type { IncomingChange } from '@renderer/lib/workingCopyFreshness';

const incoming: IncomingChange[] = [
  { path: 'src/a.ts', baseRevision: 5, headRevision: 9 },
  { path: 'src/nested/b.ts', baseRevision: 4, headRevision: 9 },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof OodCheckPanel>> = {}) {
  const props = {
    phase: 'blocked' as const,
    incoming,
    selectedCount: 2,
    onUpdateAndRetry: vi.fn(),
    onCommitAnyway: vi.fn(),
    onCancel: vi.fn(),
    onSkipCheck: vi.fn(),
    ...overrides,
  };
  const callbacks = {
    onUpdateAndRetry: props.onUpdateAndRetry,
    onCommitAnyway: props.onCommitAnyway,
    onCancel: props.onCancel,
    onSkipCheck: props.onSkipCheck,
  };
  return { callbacks, ...render(<OodCheckPanel {...props} />) };
}

describe('OodCheckPanel', () => {
  afterEach(cleanup);

  it('renders nothing when the gate is idle', () => {
    const { container } = renderPanel({ phase: 'idle' });
    expect(container.childElementCount).toBe(0);
  });

  it('shows an in-progress check with a way to skip it', () => {
    renderPanel({ phase: 'checking' });
    expect(screen.getByRole('status')).toHaveTextContent(/checking the repository/i);
    expect(screen.getByRole('button', { name: /skip check/i })).toBeInTheDocument();
  });

  it('skips the check when asked', () => {
    const { callbacks } = renderPanel({ phase: 'checking' });
    fireEvent.click(screen.getByRole('button', { name: /skip check/i }));
    expect(callbacks.onSkipCheck).toHaveBeenCalledOnce();
    expect(callbacks.onCommitAnyway).not.toHaveBeenCalled();
  });

  it('lists each incoming path with its base and head revisions', () => {
    renderPanel({ phase: 'blocked' });
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('src/nested/b.ts')).toBeInTheDocument();
    expect(screen.getByText('r5 → r9')).toBeInTheDocument();
    expect(screen.getByText('r4 → r9')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /out of date — incoming changes affect these 2 files/i })
    ).toBeInTheDocument();
  });

  it('words the singular case without a stray plural', () => {
    renderPanel({ phase: 'blocked', selectedCount: 1 });
    expect(
      screen.getByRole('heading', { name: /out of date — incoming changes affect this commit/i })
    ).toBeInTheDocument();
  });

  it('offers update-and-retry, commit-anyway and cancel from the blocked state', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /update and retry/i }));
    expect(callbacks.onUpdateAndRetry).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /commit anyway/i }));
    expect(callbacks.onCommitAnyway).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it('disables every choice while the update runs', () => {
    renderPanel({ phase: 'updating' });
    for (const name of [/cancel/i, /commit anyway/i, /update and retry|retry update/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('heading', { name: /updating working copy…/i })).toBeInTheDocument();
  });

  it('reports a failed update and offers a retry', () => {
    const { callbacks } = renderPanel({
      phase: 'failed',
      error: 'E155004: working copy locked',
    });
    expect(screen.getByText(/E155004: working copy locked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry update/i }));
    expect(callbacks.onUpdateAndRetry).toHaveBeenCalledOnce();
  });
});
