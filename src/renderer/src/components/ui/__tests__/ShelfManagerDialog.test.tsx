import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnShelveListResult } from '@shared/types';
import { SHELF_MANAGER_CONFIG_KEY } from '@renderer/lib/shelfManager';
import { PENDING_BACKEND_CHANNELS, ShelfManagerDialog } from '../ShelfManagerDialog';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function shelfResult(): SvnShelveListResult {
  return {
    shelves: [
      { name: 'fresh-work', message: 'wip', path: '/wc', date: daysAgo(2) },
      { name: 'ancient-experiment', path: '/wc', date: daysAgo(90) },
    ],
  };
}

describe('ShelfManagerDialog', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map([[SHELF_MANAGER_CONFIG_KEY, { maxAgeDays: 30 }]]);
    window.api = createMockElectronAPI();
    window.api.store.get = vi.fn(async (key: string) => store.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    });
    window.api.svn.shelve.list = vi.fn().mockResolvedValue(shelfResult());
    window.api.dialog.confirm = vi.fn().mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('renders the shelf table with names, ages and a stale indicator', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const table = await screen.findByRole('table', { name: 'Shelves' });
    expect(within(table).getByText('fresh-work')).toBeTruthy();
    expect(within(table).getByText('ancient-experiment')).toBeTruthy();
    expect(within(table).getByText('2 days')).toBeTruthy();
    expect(within(table).getByText('3 months')).toBeTruthy();
    expect(within(table).getByText('stale')).toBeTruthy();
    // svn shelf-list reports no file counts — column shows a placeholder.
    expect(within(table).getAllByText('—')).toHaveLength(2);
  });

  it('deletes a shelf after a stale-aware confirmation prompt', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const deleteButton = await screen.findByRole('button', {
      name: /delete shelf ancient-experiment/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(window.api.dialog.confirm).toHaveBeenCalled());
    const options = (window.api.dialog.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(options.message).toMatch(/is 3 months old/);
    expect(window.api.svn.shelve.delete).toHaveBeenCalledWith('ancient-experiment', '/wc');
  });

  it('applies a shelf via the existing IPC', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const applyButtons = await screen.findAllByRole('button', { name: /^apply/i });
    fireEvent.click(applyButtons[0]); // first row: fresh-work

    await waitFor(() =>
      expect(window.api.svn.shelve.apply).toHaveBeenCalledWith('fresh-work', '/wc')
    );
  });

  it('persists the max-age setting when saved', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const input = (await screen.findByLabelText(
      /nudge when shelves are older than/i
    )) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('30'));

    fireEvent.change(input, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(store.get(SHELF_MANAGER_CONFIG_KEY)).toEqual({ maxAgeDays: 14 });
    });
  });

  it('turns nudges off with an empty value', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const input = (await screen.findByLabelText(
      /nudge when shelves are older than/i
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(store.get(SHELF_MANAGER_CONFIG_KEY)).toEqual({ maxAgeDays: null });
    });
  });

  it('shows disabled rename/diff/export/import affordances with the exact pending channels', async () => {
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    // One disabled affordance per shelf row…
    expect(
      (await screen.findAllByRole('button', { name: /diff \(pending backend\)/i })).length
    ).toBe(2);
    expect(screen.getAllByRole('button', { name: /rename \(pending backend\)/i }).length).toBe(2);
    // …and one global export/import pair.
    expect(screen.getByRole('button', { name: /export shelf… \(pending backend\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /import shelf… \(pending backend\)/i })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      if (button.textContent?.includes('pending')) expect(button).toBeDisabled();
    }

    const pending = screen.getByTestId('pending-backend');
    for (const channel of PENDING_BACKEND_CHANNELS) {
      expect(within(pending).getByText(channel)).toBeTruthy();
    }
  });

  it('surfaces the unsupported reason from the shelf backend', async () => {
    window.api.svn.shelve.list = vi
      .fn()
      .mockResolvedValue({ shelves: [], unsupportedReason: 'svn 1.9 has no shelf support' });
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );
    expect(await screen.findByText(/svn 1\.9 has no shelf support/)).toBeTruthy();
    expect(screen.getByText('No shelves found')).toBeTruthy();
  });
});
