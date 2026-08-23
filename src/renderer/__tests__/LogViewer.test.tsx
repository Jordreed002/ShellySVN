import React, { type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnLogEntry, SvnLogResult } from '@shared/types';

import { LogViewer } from '../src/components/ui/LogViewer';

/**
 * LogViewer's saved-view surface (useLogViewState) reads the query cache for
 * optimistic deletes, so it — like the app itself — runs under a provider.
 */
function renderViewer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<LogViewer isOpen={true} path="C:/repo" onClose={vi.fn()} />, { wrapper });
}

const logCacheMocks = vi.hoisted(() => ({
  refreshLog: vi.fn(),
  clearCache: vi.fn(),
  useCachedLog: vi.fn(),
}));

vi.mock('@renderer/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: {
      enabled: true,
      issueIdPattern: '[A-Z]+-\\d+',
      issueUrlTemplate: '',
    },
  }),
}));

vi.mock('@renderer/hooks/useLogCache', () => ({
  useCachedLog: logCacheMocks.useCachedLog,
}));

function makeLog(entries: SvnLogEntry[]): SvnLogResult {
  return {
    entries,
    startRevision: entries.at(-1)?.revision ?? 0,
    endRevision: entries[0]?.revision ?? 0,
  };
}

function makeEntry(revision: number, path: string, message = `Change ${revision}`): SvnLogEntry {
  return {
    revision,
    author: revision % 2 === 0 ? 'alice' : 'bob',
    date: '2026-04-25T10:00:00.000Z',
    message,
    paths: [{ action: 'M', path }],
  };
}

describe('LogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logCacheMocks.useCachedLog.mockReturnValue({
      cachedLog: null,
      cacheInfo: null,
      hasCachedData: false,
      isRefreshing: false,
      refreshLog: logCacheMocks.refreshLog,
      clearCache: logCacheMocks.clearCache,
    });
    window.api = {
      svn: {
        getWorkingCopyContext: vi.fn().mockResolvedValue({ workingCopyRoot: 'C:/repo' }),
        revisionImpact: vi.fn().mockImplementation((_path, _limit, revision) =>
          Promise.resolve({
            target: 'C:/repo',
            revisions: [revision],
            authors: ['alice'],
            changedPathCount: 1,
            truncated: false,
            groups: [
              {
                category: 'source',
                evidence: [{ revision, path: '/trunk/src/app.ts', action: 'M' }],
              },
            ],
          })
        ),
      },
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];
  });

  it('paginates loaded revisions and reports matching counts', async () => {
    logCacheMocks.refreshLog.mockResolvedValue(
      makeLog(
        Array.from({ length: 30 }, (_, index) =>
          makeEntry(130 - index, `/trunk/src/file-${index}.ts`)
        )
      )
    );

    renderViewer();

    await screen.findByText('r130');
    expect(screen.getByText('r106')).toBeInTheDocument();
    expect(screen.queryByText('r105')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1-25 of 30 matching revisions/)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('r105')).toBeInTheDocument();
    expect(screen.queryByText('r106')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 26-30 of 30 matching revisions/)).toBeInTheDocument();
  });

  it('filters by changed paths and message search before paginating', async () => {
    logCacheMocks.refreshLog.mockResolvedValue(
      makeLog([
        makeEntry(203, '/branches/release/src/app.ts', 'APP-203 Release fixes'),
        makeEntry(202, '/trunk/docs/readme.md', 'Update documentation'),
        makeEntry(201, '/trunk/src/app.ts', 'APP-201 Refactor shell integration'),
      ])
    );

    renderViewer();

    await screen.findByText('r203');
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: '/trunk/src' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'shell' },
    });

    // Filters are debounced, so wait on the post-filter footer rather than on
    // an entry that is also present before filtering.
    await waitFor(() => {
      expect(screen.getByText(/Showing 1-1 of 1 matching revisions/)).toBeInTheDocument();
    });

    expect(screen.queryByText('r203')).not.toBeInTheDocument();
    expect(screen.queryByText('r202')).not.toBeInTheDocument();

    expect(screen.getByText(/Refactor shell integration/)).toBeInTheDocument();
  });

  it('reloads log data with merge tracking enabled', async () => {
    logCacheMocks.refreshLog.mockResolvedValue(makeLog([makeEntry(300, '/trunk/src/app.ts')]));

    renderViewer();

    await screen.findByText('r300');
    expect(logCacheMocks.useCachedLog).toHaveBeenLastCalledWith('C:/repo', 50, false, {
      stopOnCopy: false,
      strictNodeHistory: false,
      includeAllRevisionProperties: false,
      revisionProperties: [],
    });

    fireEvent.click(screen.getByLabelText('Merged revisions'));

    await waitFor(() => {
      expect(logCacheMocks.useCachedLog).toHaveBeenLastCalledWith('C:/repo', 50, true, {
        stopOnCopy: false,
        strictNodeHistory: false,
        includeAllRevisionProperties: false,
        revisionProperties: [],
      });
    });
  });

  it('requests and displays selected revision properties', async () => {
    logCacheMocks.refreshLog.mockResolvedValue(
      makeLog([
        {
          ...makeEntry(401, '/trunk/src/app.ts'),
          revisionProperties: { 'review:status': 'approved' },
        },
      ])
    );

    renderViewer();

    await screen.findByText('r401');
    fireEvent.change(screen.getByLabelText('Revision properties'), {
      target: { value: 'review:status, build:id' },
    });

    await waitFor(() => {
      expect(logCacheMocks.useCachedLog).toHaveBeenLastCalledWith('C:/repo', 50, false, {
        stopOnCopy: false,
        strictNodeHistory: false,
        includeAllRevisionProperties: false,
        revisionProperties: ['review:status', 'build:id'],
      });
    });

    fireEvent.click(screen.getByText('r401'));
    expect(screen.getByText('review:status')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.api.svn.revisionImpact).toHaveBeenCalledWith('C:/repo', 1, 401);
      expect(screen.getByText('1 paths')).toBeInTheDocument();
    });
  });
});
