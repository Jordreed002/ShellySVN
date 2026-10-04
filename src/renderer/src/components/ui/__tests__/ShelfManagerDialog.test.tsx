import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnShelveListResult } from '@shared/types';
import { SHELF_MANAGER_CONFIG_KEY } from '@renderer/lib/shelfManager';
import { ShelfManagerDialog } from '../ShelfManagerDialog';

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

  it('renames a shelf through the rename IPC after inline editing', async () => {
    window.api.svn.shelve.rename = vi.fn().mockResolvedValue({ success: true });
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const renameButtons = await screen.findAllByRole('button', { name: /^rename/i });
    fireEvent.click(renameButtons[0]); // first row: fresh-work

    const editor = screen.getByTestId('shelf-rename-editor');
    const input = within(editor).getByLabelText(/new name for shelf fresh-work/i);
    fireEvent.change(input, { target: { value: 'fresh-work-renamed' } });
    fireEvent.click(within(editor).getByRole('button', { name: /confirm rename/i }));

    await waitFor(() =>
      expect(window.api.svn.shelve.rename).toHaveBeenCalledWith(
        'fresh-work',
        '/wc',
        'fresh-work-renamed'
      )
    );
    expect(await screen.findByTestId('shelf-action-notice')).toBeTruthy();
  });

  it('surfaces a failed rename as a dismissible error', async () => {
    window.api.svn.shelve.rename = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'A shelf named "x" already exists.' });
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const renameButtons = await screen.findAllByRole('button', { name: /^rename/i });
    fireEvent.click(renameButtons[0]);
    const editor = screen.getByTestId('shelf-rename-editor');
    fireEvent.change(within(editor).getByLabelText(/new name for shelf fresh-work/i), {
      target: { value: 'taken' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: /confirm rename/i }));

    const alert = await screen.findByTestId('shelf-action-error');
    expect(alert.textContent).toContain('already exists');
    // A failed rename keeps the editor so the name can be corrected.
    expect(screen.getByTestId('shelf-rename-editor')).toBeTruthy();
  });

  it('shows the shelf diff and re-runs it against HEAD on toggle', async () => {
    window.api.svn.shelve.diff = vi
      .fn()
      .mockResolvedValue({ success: true, diff: '--- a/README\n+++ b/README\n', against: 'working-copy' });
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const diffButtons = await screen.findAllByRole('button', { name: /^diff/i });
    fireEvent.click(diffButtons[0]);

    const panel = await screen.findByTestId('shelf-diff-panel');
    expect(panel.textContent).toContain('+++ b/README');
    expect(window.api.svn.shelve.diff).toHaveBeenCalledWith('fresh-work', '/wc', 'working-copy');

    fireEvent.click(within(panel).getByRole('button', { name: /vs head/i }));
    await waitFor(() =>
      expect(window.api.svn.shelve.diff).toHaveBeenCalledWith('fresh-work', '/wc', 'HEAD')
    );
  });

  it('exports a shelf into a picked directory through the export IPC', async () => {
    window.api.svn.shelve.export = vi
      .fn()
      .mockResolvedValue({ success: true, output: '/out/portable-shelf-fresh-work' });
    window.api.dialog.openDirectory = vi.fn().mockResolvedValue('/out');
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    const exportButton = await screen.findByRole('button', {
      name: /export shelf fresh-work as a portable bundle/i,
    });
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(window.api.svn.shelve.export).toHaveBeenCalledWith('fresh-work', '/wc', '/out')
    );
    const notice = await screen.findByTestId('shelf-action-notice');
    expect(notice.textContent).toContain('/out/portable-shelf-fresh-work');
  });

  it('imports a picked portable shelf bundle into the working copy', async () => {
    window.api.svn.shelve.import = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'Imported shelf "fresh-work".' });
    window.api.dialog.openDirectory = vi
      .fn()
      .mockResolvedValue('/bundles/portable-shelf-fresh-work');
    renderWithQueryClient(
      <ShelfManagerDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    fireEvent.click(await screen.findByRole('button', { name: /^import shelf…/i }));

    await waitFor(() =>
      expect(window.api.svn.shelve.import).toHaveBeenCalledWith(
        '/bundles/portable-shelf-fresh-work',
        '/wc'
      )
    );
    expect(await screen.findByTestId('shelf-action-notice')).toBeTruthy();
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
