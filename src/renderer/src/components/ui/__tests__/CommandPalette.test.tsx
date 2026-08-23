import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CommandPalette } from '../CommandPalette';

async function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const view = render(
    <CommandPalette
      isOpen
      onClose={vi.fn()}
      onCommit={vi.fn()}
      onUpdate={vi.fn()}
      onRevert={vi.fn()}
      onGoToRoute={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenAiReviewCenter={vi.fn()}
      {...props}
    />
  );
  // Flush the async recent-usage load triggered on open.
  await act(async () => {});
  return view;
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Run a command…'), {
    target: { value },
  });
}

describe('CommandPalette fuzzy search', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  it('matches subsequence queries that share no substring', async () => {
    await renderPalette();
    typeQuery('cmmt');

    // "cmmt" is a subsequence of "Commit changes" but not a substring.
    await waitFor(() => expect(screen.getByText('Commit changes')).toBeInTheDocument());
    expect(screen.queryByText('Revert changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to Home')).not.toBeInTheDocument();
  });

  it('matches keywords beyond titles', async () => {
    await renderPalette();
    typeQuery('checkin');

    await waitFor(() => expect(screen.getByText('Commit changes')).toBeInTheDocument());
  });

  it('ranks early title hits above later ones', async () => {
    await renderPalette();
    typeQuery('o');

    // "o" is an early substring of "Commit changes" and a late one of
    // "Update working copy", so commit ranks first without any boost.
    const list = document.querySelector('.command-palette-list');
    await waitFor(() => expect(list?.textContent).toContain('Update working copy'));
    expect(list!.textContent.indexOf('Commit changes')).toBeLessThan(
      list!.textContent.indexOf('Update working copy')
    );
  });

  it('shows the empty state for queries that match nothing', async () => {
    await renderPalette();
    typeQuery('zzzz');

    await waitFor(() => expect(screen.getByText('No commands found')).toBeInTheDocument());
  });

  it('boosts recently executed commands above similar matches', async () => {
    window.api = {
      store: { get: vi.fn().mockResolvedValue({ update: 1234 }), set: vi.fn() },
    } as unknown as Window['api'];
    await renderPalette();

    // "o" is an early substring of "Commit changes" and a later one of
    // "Update working copy", so only the recency boost can flip the order.
    typeQuery('o');
    const list = document.querySelector('.command-palette-list');
    await waitFor(() =>
      expect(list!.textContent.indexOf('Update working copy')).toBeLessThan(
        list!.textContent.indexOf('Commit changes')
      )
    );
  });

  it('executes the selected command and closes', async () => {
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    await renderPalette({ onClose, onOpenSettings });
    typeQuery('settings');

    const item = await screen.findByText('Open settings');
    fireEvent.click(item.closest('.command-palette-item')!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes the shell navigation and window actions the controller wires', async () => {
    await renderPalette({
      onMinimizeWindow: vi.fn(),
      onCloseWindow: vi.fn(),
    });
    expect(screen.getByText('Go to Home')).toBeInTheDocument();
    expect(screen.getByText('Go to Repository browser')).toBeInTheDocument();
    expect(screen.getByText('Open AI Review Center')).toBeInTheDocument();
    expect(screen.getByText('Minimize window')).toBeInTheDocument();
    expect(screen.getByText('Close window')).toBeInTheDocument();
  });

  it('omits history navigation when no working path is current', async () => {
    await renderPalette();
    expect(screen.queryByText('Go to History')).not.toBeInTheDocument();
  });
});
