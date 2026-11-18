import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { svnShelveList, svnStatus } from '@renderer/lib/queryKeys';
import { ShelveDialog } from '../ShelveDialog';

const WC = '/wc/project';

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ShelveDialog isOpen onClose={() => undefined} workingCopyPath={WC} />
    </QueryClientProvider>
  );
  return invalidate;
}

function enterShelf() {
  fireEvent.click(screen.getByRole('button', { name: 'Shelve Current Changes' }));
  fireEvent.change(screen.getByLabelText(/Shelve Name/), { target: { value: 'my-shelf' } });
  fireEvent.change(screen.getByLabelText('Message (optional)'), {
    target: { value: 'keep this message' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Shelve Changes' }));
}

describe('ShelveDialog mutation results', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.shelve.list = vi.fn().mockResolvedValue({
      path: WC,
      shelves: [{ name: 'existing', date: '2026-01-01T00:00:00Z' }],
    });
    window.api.svn.shelve.save = vi.fn().mockResolvedValue({ success: true });
    window.api.svn.shelve.apply = vi.fn().mockResolvedValue({ success: true });
    window.api.svn.shelve.delete = vi.fn().mockResolvedValue({ success: true });
    window.api.dialog.confirm = vi.fn().mockResolvedValue(true);
  });
  afterEach(cleanup);

  it('shows a failed save and preserves the draft until a successful retry', async () => {
    vi.mocked(window.api.svn.shelve.save).mockResolvedValueOnce({
      success: false,
      error: 'Disk is full',
    });
    const invalidate = renderDialog();
    enterShelf();
    expect((await screen.findByRole('alert')).textContent).toBe('Disk is full');
    expect((screen.getByLabelText(/Shelve Name/) as HTMLInputElement).value).toBe('my-shelf');
    expect((screen.getByLabelText('Message (optional)') as HTMLTextAreaElement).value).toBe(
      'keep this message'
    );
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Shelve Changes' }));
    await screen.findByRole('button', { name: 'Shelve Current Changes' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: svnShelveList(WC) });
  });

  it.each(['apply', 'delete'] as const)(
    'shows a failed %s without success invalidation',
    async (action) => {
      vi.mocked(window.api.svn.shelve[action]).mockResolvedValue({
        success: false,
        error: `${action} failed`,
      });
      const invalidate = renderDialog();
      const button =
        action === 'apply'
          ? await screen.findByRole('button', { name: 'Apply' })
          : await screen.findByTitle('Delete shelve');
      fireEvent.click(button);
      expect((await screen.findByRole('alert')).textContent).toBe(`${action} failed`);
      expect(screen.getByText('existing')).toBeTruthy();
      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it.each(['apply', 'delete'] as const)(
    'invalidates the appropriate data after successful %s',
    async (action) => {
      const invalidate = renderDialog();
      const button =
        action === 'apply'
          ? await screen.findByRole('button', { name: 'Apply' })
          : await screen.findByTitle('Delete shelve');
      fireEvent.click(button);
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: action === 'apply' ? svnStatus(WC) : svnShelveList(WC),
        })
      );
      expect(screen.queryByRole('alert')).toBeNull();
    }
  );

  it('shows rejected IPC errors and supplies a fallback for failure without detail', async () => {
    vi.mocked(window.api.svn.shelve.save)
      .mockRejectedValueOnce(new Error('IPC disconnected'))
      .mockResolvedValueOnce({ success: false });
    renderDialog();
    enterShelf();
    expect((await screen.findByRole('alert')).textContent).toBe('IPC disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Shelve Changes' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Failed to save shelf.')
    );
  });
});
