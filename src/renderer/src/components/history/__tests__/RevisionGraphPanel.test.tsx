import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HistoryViewToggle,
  RevisionGraphPanel,
} from '@renderer/components/history/RevisionGraphPanel';

const svnApi = {
  log: vi.fn(),
  getWorkingCopyContext: vi.fn(),
};

function mockWindowApi() {
  window.api = {
    svn: svnApi,
    store: { get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Window['api'];
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function logEntry(
  revision: number,
  message: string,
  path: string,
  copyFromPath?: string,
  copyFromRev?: number
) {
  return {
    revision,
    author: revision % 2 === 0 ? 'alice' : 'bob',
    date: '2026-04-25T10:00:00.000Z',
    message,
    paths: [
      {
        action: copyFromPath ? 'A' : 'M',
        path,
        copyFromPath,
        copyFromRev,
      },
    ],
  };
}

const FIXTURE_ENTRIES = () => [
  logEntry(300, 'Merge branches/feature into trunk', '/trunk/src/app.ts'),
  logEntry(250, 'Create release tag', '/tags/v1.0', '/trunk', 200),
  logEntry(220, 'Feature work', '/branches/feature/src/app.ts'),
  logEntry(200, 'Trunk baseline', '/trunk/src/app.ts'),
];

describe('RevisionGraphPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svnApi.log.mockResolvedValue({
      entries: FIXTURE_ENTRIES(),
      startRevision: 200,
      endRevision: 300,
    });
    svnApi.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: '/wc/repo' });
    mockWindowApi();
  });

  it('renders one selectable button per revision with the branch legend', async () => {
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" />);

    expect(await screen.findByTestId('revision-graph-node-r300')).toBeInTheDocument();
    expect(screen.getByTestId('revision-graph-node-r250')).toBeInTheDocument();
    expect(screen.getByTestId('revision-graph-node-r220')).toBeInTheDocument();
    expect(screen.getByTestId('revision-graph-node-r200')).toBeInTheDocument();

    // Legend + header stats derived from the model.
    expect(screen.getByText('trunk')).toBeInTheDocument();
    expect(screen.getByText('branches/feature')).toBeInTheDocument();
    expect(screen.getByText('tags/v1.0')).toBeInTheDocument();
    expect(screen.getByText('4 rev · 3 br')).toBeInTheDocument();
  });

  it('reports selection clicks and marks the selected revision', async () => {
    const onSelectRevision = vi.fn();
    const { rerender } = renderWithQueryClient(
      <RevisionGraphPanel path="/wc/repo" onSelectRevision={onSelectRevision} />
    );

    fireEvent.click(await screen.findByTestId('revision-graph-node-r250'));
    expect(onSelectRevision).toHaveBeenCalledWith(250);

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RevisionGraphPanel
          path="/wc/repo"
          selectedRevision={250}
          onSelectRevision={onSelectRevision}
        />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('revision-graph-node-r250')).toHaveAttribute(
        'aria-current',
        'true'
      );
    });
    expect(screen.getByTestId('revision-graph-node-r300')).not.toHaveAttribute('aria-current');
  });

  it('shows a tooltip with revision, author, branch and copy point on hover', async () => {
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" />);

    fireEvent.mouseEnter(await screen.findByTestId('revision-graph-node-r250'));

    const tooltip = await screen.findByTestId('revision-graph-tooltip');
    expect(tooltip).toHaveTextContent('r250');
    expect(tooltip).toHaveTextContent('tags/v1.0');
    expect(tooltip).toHaveTextContent('Branched from r200');
    expect(tooltip).toHaveTextContent('alice');

    fireEvent.mouseLeave(screen.getByTestId('revision-graph-node-r250'));
    expect(screen.queryByTestId('revision-graph-tooltip')).not.toBeInTheDocument();
  });

  it('annotates merge revisions in the tooltip', async () => {
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" />);

    fireEvent.mouseEnter(await screen.findByTestId('revision-graph-node-r300'));
    const tooltip = await screen.findByTestId('revision-graph-tooltip');
    expect(tooltip).toHaveTextContent('Merged from branches/feature');
  });

  it('describes copy points and merges in node labels for screen readers', async () => {
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" />);
    await screen.findByTestId('revision-graph-node-r250');
    expect(screen.getByTestId('revision-graph-node-r250')).toHaveAccessibleName(
      'Revision 250 on tags/v1.0, branched from r200'
    );
    expect(screen.getByTestId('revision-graph-node-r300')).toHaveAccessibleName(
      'Revision 300 on trunk, merge'
    );
  });

  it('renders a compact variant without header and legend', async () => {
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" variant="compact" />);

    await screen.findByTestId('revision-graph-node-r300');
    expect(screen.queryByText('4 rev · 3 br')).not.toBeInTheDocument();
    expect(screen.queryByText('tags/v1.0')).not.toBeInTheDocument();
    // Tooltips still work in compact mode (sidebar usage).
    fireEvent.mouseEnter(screen.getByTestId('revision-graph-node-r220'));
    expect(await screen.findByTestId('revision-graph-tooltip')).toHaveTextContent('r220');
  });

  it('offers a retry affordance when the log read fails', async () => {
    svnApi.log.mockRejectedValue(new Error('svn blew up'));
    renderWithQueryClient(<RevisionGraphPanel path="/wc/repo" />);

    expect(await screen.findByText('Graph failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('only reads the log for a real working copy path', () => {
    renderWithQueryClient(<RevisionGraphPanel path="/" />);
    expect(svnApi.log).not.toHaveBeenCalled();
  });
});

describe('HistoryViewToggle', () => {
  it('toggles between list and graph with pressed state', () => {
    const onChange = vi.fn();
    render(<HistoryViewToggle value="list" onChange={onChange} />);

    expect(screen.getByTestId('history-view-list')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('history-view-graph')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('history-view-graph'));
    expect(onChange).toHaveBeenCalledWith('graph');

    fireEvent.click(screen.getByTestId('history-view-list'));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});
