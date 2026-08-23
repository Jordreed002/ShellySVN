/**
 * CommitHistory's empty and loading states (#92/#93): the ad-hoc empties are
 * now the shared EmptyState with a next-step CTA, and loading is a skeleton
 * list rather than a bare spinner.
 */

import React, { type ReactNode } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnLogResult } from '@shared/types';

let search: { path?: string } = {};
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search,
  useNavigate: () => vi.fn(),
}));

/*
 * jsdom gives the scroll parent a 0-height rect, so the real virtualizer
 * renders no rows; a flat passthrough keeps row assertions meaningful.
 */
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const size = estimateSize?.() ?? 112;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * size,
          size,
        })),
      measureElement: () => undefined,
    };
  },
}));

import { CommitHistory } from '../CommitHistory';

const logResult: SvnLogResult = {
  entries: [
    {
      revision: 7,
      author: 'alice',
      date: '2026-08-01T10:00:00.000Z',
      message: 'Add atlas module',
      paths: [{ action: 'A', path: '/trunk/atlas' }],
    },
    {
      revision: 8,
      author: 'bob',
      date: '2026-08-02T10:00:00.000Z',
      message: 'Tweak build',
      paths: [{ action: 'M', path: '/trunk/build.sh' }],
    },
  ],
  startRevision: 7,
  endRevision: 8,
};

function renderHistory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<CommitHistory />, { wrapper });
}

describe('CommitHistory — empty and loading states', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    const data = new Map<string, unknown>();
    window.api.store.get = vi.fn(async (key: string) => data.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    });
    window.api.svn.log = vi.fn().mockResolvedValue(logResult);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the shared EmptyState when no working copy is selected', () => {
    search = { path: '/' };
    const { container } = renderHistory();

    expect(screen.getByText('No working copy selected')).toBeInTheDocument();
    expect(
      screen.getByText('Open a repository, then History shows its commit log.')
    ).toBeInTheDocument();
    // The next step is a real CTA, not a dead end.
    expect(screen.getByRole('button', { name: /Open working copy…/ })).toBeInTheDocument();
    // Not the old ad-hoc markup.
    expect(container.querySelector('.spinner')).not.toBeInTheDocument();
  });

  it('shows a skeleton list while the log loads', async () => {
    let resolveLog: ((value: SvnLogResult) => void) | undefined;
    window.api.svn.log = vi.fn(
      () => new Promise<SvnLogResult>((resolve) => (resolveLog = resolve))
    );
    search = { path: '/wc/atlas' };
    renderHistory();

    const skeleton = await screen.findByRole('status');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Loading history…')).not.toBeInTheDocument();

    resolveLog?.(logResult);
    await waitFor(() =>
      expect(screen.getByText('Commit History')).toBeInTheDocument()
    );
  });

  it('offers Clear filters when every commit is filtered out', async () => {
    search = { path: '/wc/atlas' };
    renderHistory();

    await waitFor(() => expect(screen.getByText('Commit History')).toBeInTheDocument());
    expect(screen.getByText('Add atlas module')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search commits'), {
      target: { value: 'ziggurat-no-match' },
    });

    const empty = await screen.findByText('No commits match the current filters');
    expect(empty).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    // Clearing recovers the list: the filtered-out empty state goes away and
    // the rows come back.
    await waitFor(() =>
      expect(screen.queryByText('No commits match the current filters')).not.toBeInTheDocument()
    );
    await waitFor(() => expect(screen.getByText('Add atlas module')).toBeInTheDocument());
  });
});
