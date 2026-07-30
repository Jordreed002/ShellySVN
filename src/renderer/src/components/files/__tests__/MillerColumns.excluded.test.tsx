/**
 * "Exclude and remove locally" deletes the folder from disk, and the Miller
 * columns list the disk — so the folder it removed had no row left, and with no
 * row there was nothing to right-click to fetch it back. The offline
 * `svn info --depth immediates` read still knows about it; these tests cover
 * that it reaches the column and carries the URL the fetch needs.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import type { SvnStatusEntry } from '@shared/types';

import { MillerColumns } from '../MillerColumns';

const listDirectory = vi.fn();
const getStatus = vi.fn();
const childCommits = vi.fn();

function renderColumns(actions: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MillerColumns
        path="/wc"
        baseRoot="/wc"
        onNavigate={vi.fn()}
        onSelect={vi.fn()}
        actions={actions}
        workingCopyRoot="/wc"
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listDirectory.mockResolvedValue([
    { name: 'keep', path: '/wc/keep', isDirectory: true, size: 0, modifiedTime: '' },
  ]);
  getStatus.mockResolvedValue({ directStatus: {}, allEntries: [] });
  childCommits.mockResolvedValue({
    keep: { revision: 3, author: 'ana', date: '2026-02-01T00:00:00Z' },
    sub: {
      revision: 7,
      author: 'ben',
      date: '2026-03-01T00:00:00Z',
      excluded: true,
      url: 'https://svn.example.com/repo/trunk/sub',
    },
  });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { listDirectory, getStatus }, svn: { childCommits } },
  });
});

describe('MillerColumns with an excluded folder', () => {
  it('shows the folder that is in the working copy but not on disk', async () => {
    renderColumns();

    expect(await screen.findByText('sub')).toBeInTheDocument();
    expect(screen.getByText('Not checked out')).toBeInTheDocument();
    expect(childCommits).toHaveBeenCalledWith('/wc');
  });

  it('offers "Add to working copy…" on it, with the repository URL to fetch', async () => {
    const onDownload = vi.fn();
    renderColumns({ onDownload });

    fireEvent.contextMenu(await screen.findByText('sub'));

    const item = await screen.findByText('Add to working copy…');
    fireEvent.click(item);

    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    const entry = onDownload.mock.calls[0][0] as SvnStatusEntry;
    expect(entry).toMatchObject({
      path: '/wc/sub',
      status: 'O',
      remoteUrl: 'https://svn.example.com/repo/trunk/sub',
      isDirectory: true,
    });
  });

  it('does not read the working copy for folders outside it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MillerColumns
          path="/elsewhere"
          baseRoot="/elsewhere"
          onNavigate={vi.fn()}
          onSelect={vi.fn()}
          actions={{}}
          workingCopyRoot="/wc"
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(listDirectory).toHaveBeenCalledWith('/elsewhere'));
    expect(childCommits).not.toHaveBeenCalled();
  });
});
