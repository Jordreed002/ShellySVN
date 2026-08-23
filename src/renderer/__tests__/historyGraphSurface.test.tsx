import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HistorySurface } from '../src/routes/history/index';

// jsdom does no layout, so the real virtualizer sees a zero-height scroll
// element and renders no rows. Stub it to render every row — the repo's
// ChooseItemsDialog test uses the same pattern. The graph panel has its own
// windowing and needs no stub.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: () => number;
  }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

/**
 * Integration test for the History surface wiring (#45): the list/graph
 * toggle, the graph panel beside the commit list, and two-way selection sync.
 * HistorySurface is mounted through a real (in-memory) router so its
 * useSearch({ from: '/history/' }) reads the ?path= search param exactly like
 * production.
 */

const svnApi = {
  log: vi.fn(),
  getWorkingCopyContext: vi.fn(),
};

function logEntry(
  revision: number,
  message: string,
  path: string,
  copyFromPath?: string,
  copyFromRev?: number
) {
  return {
    revision,
    author: 'alice',
    date: '2026-04-25T10:00:00.000Z',
    message,
    paths: [{ action: copyFromPath ? 'A' : 'M', path, copyFromPath, copyFromRev }],
  };
}

const FIXTURE = () => [
  logEntry(300, 'Merge branches/feature into trunk', '/trunk/src/app.ts'),
  logEntry(250, 'Create release tag', '/tags/v1.0', '/trunk', 200),
  logEntry(220, 'Feature work', '/branches/feature/src/app.ts'),
  logEntry(200, 'Trunk baseline', '/trunk/src/app.ts'),
];

function renderHistorySurface(initialEntry = '/history/?path=/wc/repo') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rootRoute = createRootRoute();
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history/',
    validateSearch: (search: Record<string, unknown>) => ({
      path: (search.path as string) || '/',
    }),
    component: HistorySurface,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([historyRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('History surface graph integration (#45)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    svnApi.log.mockResolvedValue({
      entries: FIXTURE(),
      startRevision: 200,
      endRevision: 300,
    });
    svnApi.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: '/wc/repo' });
    window.api = {
      svn: svnApi,
      store: {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Window['api'];
  });

  it('shows the log list without the graph by default', async () => {
    renderHistorySurface();

    expect(await screen.findByText('Trunk baseline')).toBeInTheDocument();
    expect(screen.getByText('Commit History')).toBeInTheDocument();
    expect(screen.queryByTestId('revision-graph-panel')).not.toBeInTheDocument();
  });

  it('mounts the graph panel beside the list after toggling', async () => {
    renderHistorySurface();

    await screen.findByText('Commit History');
    fireEvent.click(screen.getByTestId('history-view-graph'));

    expect(await screen.findByTestId('revision-graph-panel')).toBeInTheDocument();
    expect(screen.getByTestId('revision-graph-node-r300')).toBeInTheDocument();
    // The log list stays mounted next to it.
    expect(await screen.findByText('Feature work')).toBeInTheDocument();
    // Mode is persisted for the next visit.
    expect(localStorage.getItem('shellysvn:history:view-mode')).toBe('graph');
  });

  it('syncs selection from the graph to the log list', async () => {
    renderHistorySurface();
    await screen.findByText('Commit History');
    fireEvent.click(screen.getByTestId('history-view-graph'));

    fireEvent.click(await screen.findByTestId('revision-graph-node-r220'));
    await screen.findByText('r220');

    await waitFor(() => {
      const highlightedRow = screen.getByText('r220').closest('div[aria-current="true"]');
      expect(highlightedRow).not.toBeNull();
    });
  });

  it('syncs selection from the log list back to the graph', async () => {
    renderHistorySurface();
    await screen.findByText('Commit History');
    fireEvent.click(screen.getByTestId('history-view-graph'));
    await screen.findByTestId('revision-graph-panel');

    // Clicking anywhere on the log row selects that revision.
    fireEvent.click(await screen.findByText('Trunk baseline'));

    await waitFor(() => {
      expect(screen.getByTestId('revision-graph-node-r200')).toHaveAttribute(
        'aria-current',
        'true'
      );
    });
  });

  it('restores graph mode from the previous session', async () => {
    localStorage.setItem('shellysvn:history:view-mode', 'graph');
    renderHistorySurface();
    expect(await screen.findByTestId('revision-graph-panel')).toBeInTheDocument();
  });

  it('toggles back to list and drops the panel', async () => {
    localStorage.setItem('shellysvn:history:view-mode', 'graph');
    renderHistorySurface();
    await screen.findByTestId('revision-graph-panel');
    fireEvent.click(screen.getByTestId('history-view-list'));
    await waitFor(() => {
      expect(screen.queryByTestId('revision-graph-panel')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Commit History')).toBeInTheDocument();
  });
});
