import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BlameViewer } from '../src/components/ui/BlameViewer';

vi.mock('@renderer/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: {
      enabled: true,
      issueIdPattern: '[A-Z]+-\\d+',
      issueUrlTemplate: '',
    },
  }),
}));

const svnApi = {
  blame: vi.fn(),
  log: vi.fn(),
  getWorkingCopyContext: vi.fn(),
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('BlameViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svnApi.blame.mockResolvedValue({
      path: 'C:/repo/src/app.ts',
      startRevision: 40,
      endRevision: 42,
      lines: [
        {
          lineNumber: 1,
          revision: 42,
          author: 'alice',
          date: '2026-04-25T10:00:00.000Z',
          content: 'export const answer = 42;',
        },
      ],
    });
    svnApi.log.mockResolvedValue({
      entries: [
        {
          revision: 42,
          author: 'alice',
          date: '2026-04-25T10:00:00.000Z',
          message: 'APP-42 Add answer export',
          paths: [{ action: 'M', path: '/trunk/src/app.ts' }],
        },
      ],
      startRevision: 42,
      endRevision: 42,
    });
    svnApi.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: 'C:/repo' });

    window.api = {
      svn: svnApi,
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];
  });

  it('shows line-level revision, author, date, content, issue, and log message context', async () => {
    renderWithQueryClient(
      <BlameViewer isOpen={true} filePath="C:/repo/src/app.ts" onClose={vi.fn()} />
    );

    expect(await screen.findByText('r42')).toBeInTheDocument();
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.getByText('export const answer = 42;')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('APP-42').length).toBeGreaterThan(0);
    });
    expect(await screen.findByText('APP-42 Add answer export')).toBeInTheDocument();
    expect(svnApi.blame).toHaveBeenCalledWith('C:/repo/src/app.ts', undefined, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(svnApi.log).toHaveBeenCalledWith(
      'C:/repo/src/app.ts',
      200,
      undefined,
      undefined,
      false,
      {
        signal: expect.any(AbortSignal),
      }
    );
  });

  it('filters blame lines by revision log message text', async () => {
    renderWithQueryClient(
      <BlameViewer isOpen={true} filePath="C:/repo/src/app.ts" onClose={vi.fn()} />
    );

    await screen.findByText('APP-42 Add answer export');
    fireEvent.change(screen.getByPlaceholderText(/message/), {
      target: { value: 'answer export' },
    });

    await waitFor(() => {
      expect(screen.getByText('export const answer = 42;')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/message/), {
      target: { value: 'unrelated text' },
    });

    expect(await screen.findByText('No results found')).toBeInTheDocument();
  });
});
