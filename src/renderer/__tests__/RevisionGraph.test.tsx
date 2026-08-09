import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RevisionGraph } from '../src/components/ui/RevisionGraph';

const svnApi = {
  log: vi.fn(),
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
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

describe('RevisionGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svnApi.log.mockResolvedValue({
      entries: [
        logEntry(300, 'Merge branches/feature into trunk', '/trunk/src/app.ts'),
        logEntry(250, 'Create release tag', '/tags/v1.0', '/trunk', 200),
        logEntry(220, 'Feature work', '/branches/feature/src/app.ts'),
        logEntry(200, 'Trunk baseline', '/trunk/src/app.ts'),
      ],
      startRevision: 200,
      endRevision: 300,
    });

    window.api = {
      svn: svnApi,
    } as unknown as Window['api'];
  });

  it('shows branches, tags, copies, and merge context in the graph', async () => {
    renderWithQueryClient(<RevisionGraph isOpen={true} path="C:/repo" onClose={vi.fn()} />);

    expect(await screen.findAllByText('trunk')).not.toHaveLength(0);
    expect(screen.getAllByText('branches/feature')).not.toHaveLength(0);
    expect(screen.getAllByText('tags/v1.0')).not.toHaveLength(0);

    fireEvent.click(screen.getByText('r250'));
    expect(screen.getByText(/Branched from r200/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('r300'));
    expect(screen.getByText('Merge from branches/feature')).toBeInTheDocument();
    expect(screen.getByText('Merge branches/feature into trunk')).toBeInTheDocument();
  });

  it('exports the revision graph as SVG', async () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:revision-graph');
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });

    renderWithQueryClient(<RevisionGraph isOpen={true} path="C:/repo" onClose={vi.fn()} />);

    await screen.findByText('r300');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalled();
    });
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:revision-graph');
  });
});
