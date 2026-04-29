import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnLogEntry, SvnLogResult } from '@shared/types';

import { LogViewer } from '../src/components/ui/LogViewer';

const logCacheMocks = vi.hoisted(() => ({
  refreshLog: vi.fn(),
  clearCache: vi.fn(),
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
  useCachedLog: () => ({
    cachedLog: null,
    cacheInfo: null,
    hasCachedData: false,
    isRefreshing: false,
    refreshLog: logCacheMocks.refreshLog,
    clearCache: logCacheMocks.clearCache,
  }),
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
    window.api = {
      svn: {
        getWorkingCopyContext: vi.fn().mockResolvedValue({ workingCopyRoot: 'C:/repo' }),
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

    render(<LogViewer isOpen={true} path="C:/repo" onClose={vi.fn()} />);

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

    render(<LogViewer isOpen={true} path="C:/repo" onClose={vi.fn()} />);

    await screen.findByText('r203');
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: '/trunk/src' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'shell' },
    });

    await waitFor(() => {
      expect(screen.getByText('r201')).toBeInTheDocument();
    });

    expect(screen.queryByText('r203')).not.toBeInTheDocument();
    expect(screen.queryByText('r202')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1-1 of 1 matching revisions/)).toBeInTheDocument();

    expect(screen.getByText(/Refactor shell integration/)).toBeInTheDocument();
  });
});
