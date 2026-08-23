/**
 * LogViewer end-to-end wiring for the log-search surface (#66/#67/#72):
 * filter bar (search + regex + fields), saved views, CSV export, and the
 * "Show changes" action from both the row button and keyboard selection.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnLogResult } from '@shared/types';

const mocks = vi.hoisted(() => ({
  refreshLog: vi.fn(),
}));

vi.mock('@renderer/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: { enabled: false, issueIdPattern: '[A-Z]+-\\d+' },
    isLoading: false,
  }),
}));

vi.mock('@renderer/hooks/useLogCache', () => ({
  useCachedLog: () => ({
    cachedLog: null,
    cacheInfo: null,
    hasCachedData: false,
    isRefreshing: false,
    refreshLog: mocks.refreshLog,
    clearCache: vi.fn(),
  }),
}));

import { LogViewer } from '../LogViewer';

const logResult: SvnLogResult = {
  entries: [
    {
      revision: 121,
      author: 'alice',
      date: '2026-04-26T12:00:00.000Z',
      message: 'APP-9 Update lock manager',
      paths: [{ action: 'M', path: '/trunk/src/locks.ts' }],
    },
    {
      revision: 122,
      author: 'bob',
      date: '2026-04-27T14:00:00.000Z',
      message: 'Merge feature-x into trunk',
      paths: [{ action: 'M', path: '/trunk/src/log.tsx' }],
    },
    {
      revision: 123,
      author: 'alice',
      date: '2026-04-28T14:00:00.000Z',
      message: 'Refactor log viewer',
      paths: [{ action: 'M', path: '/trunk/src/log.tsx' }],
    },
  ],
  startRevision: 121,
  endRevision: 123,
};

const diffResult = {
  files: [
    {
      oldPath: '/trunk/src/locks.ts',
      newPath: '/trunk/src/locks.ts',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [{ type: 'added', content: 'new line', newLineNumber: 1 }],
        },
      ],
    },
  ],
  hasChanges: true,
};

function setupStore() {
  const data = new Map<string, unknown>();
  window.api.store.get = vi.fn(async (key: string) => data.get(key));
  window.api.store.set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value);
  });
}

describe('LogViewer — log search surface', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    setupStore();
    mocks.refreshLog.mockResolvedValue(logResult);
    window.api.svn.diff = vi.fn().mockResolvedValue(diffResult);
    window.api.svn.revisionImpact = vi.fn().mockResolvedValue({ groups: [], changedPathCount: 0 });
    window.api.dialog.saveFile = vi.fn().mockResolvedValue('/tmp/svn-log.csv');
    window.api.fs.writeFile = vi.fn().mockResolvedValue({ success: true });
  });
  afterEach(cleanup);

  // The log-search state's optimistic delete seam uses `useMutation` (#92),
  // which needs a QueryClientProvider like the one main.tsx mounts.
  const open = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <LogViewer isOpen path="/wc/repo" onClose={vi.fn()} />
      </QueryClientProvider>
    );
  };

  // The filter pipeline debounces (200ms); generous timeouts keep the suite
  // stable on a busy machine.
  const waitForIt = (assertion: () => void) => waitFor(assertion, { timeout: 4000 });

  async function rows() {
    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(3)
    );
    return screen.getAllByRole('button', { name: /^Show changes for r\d+$/ });
  }

  it('filters the list through the search input (debounced)', async () => {
    open();
    await rows();

    fireEvent.change(screen.getByLabelText('Search revisions'), { target: { value: 'alice' } });

    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(2)
    );
  });

  it('shows an inline error for an invalid regex and keeps the list usable', async () => {
    open();
    await rows();

    fireEvent.click(screen.getByTitle(/regular expressions/i));
    fireEvent.change(screen.getByLabelText('Search revisions'), { target: { value: '[oops' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Message:|Search:/);
    // The broken filter is inert, not a silent substring fallback.
    expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(3);
    // Saving a view under a broken regex is disabled.
    expect(screen.getByRole('button', { name: /save view/i })).toBeDisabled();
  });

  it('applies a valid regex via the toggle', async () => {
    open();
    await rows();

    fireEvent.click(screen.getByTitle(/regular expressions/i));
    fireEvent.change(screen.getByLabelText('Search revisions'), {
      target: { value: 'APP-\\d+' },
    });

    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(1)
    );
    expect(screen.getByRole('button', { name: /^Show changes for r121$/ })).toBeTruthy();
  });

  it('sorts by clicking the column headers', async () => {
    open();
    await rows();

    // Default is revision desc (r123 first); clicking the header flips to asc.
    fireEvent.click(screen.getByRole('button', { name: /sorted by revision/i }));
    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })[0]).toHaveAccessibleName(
        'Show changes for r121'
      )
    );
  });

  it('applies a saved view from the dropdown and ships the built-ins', async () => {
    open();
    await rows();

    const select = await screen.findByLabelText('Saved log views');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('Last 7 days (built-in)');
    expect(options).toContain('Merge-free (built-in)');

    fireEvent.change(select, { target: { value: 'builtin:merge-free' } });

    // The merge commit drops out of the list.
    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(2)
    );
    expect(screen.queryByRole('button', { name: 'Show changes for r122' })).toBeNull();
  });

  it('exports the current filtered set to CSV via the save dialog', async () => {
    open();
    await rows();

    fireEvent.change(screen.getByLabelText('Search revisions'), { target: { value: 'alice' } });
    await waitForIt(() =>
      expect(screen.getAllByRole('button', { name: /^Show changes for r\d+$/ })).toHaveLength(2)
    );

    fireEvent.click(screen.getByRole('button', { name: /^CSV$/ }));

    await waitFor(() => expect(window.api.dialog.saveFile).toHaveBeenCalled());
    const [, content] = (window.api.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain('121,2026-04-26T12:00:00.000Z,alice,');
    expect(content).not.toContain(',bob,');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/));
  });

  it('opens the revision diff from the row Show-changes button (#72)', async () => {
    open();
    await rows();

    fireEvent.click(screen.getByRole('button', { name: 'Show changes for r122' }));

    expect(window.api.svn.diff).toHaveBeenCalledWith('/wc/repo', '122');
    await waitFor(() => {
      expect(screen.getByText(/r121 → r122/)).toBeTruthy();
    });
  });

  it('opens the revision diff from keyboard selection (#72)', async () => {
    open();
    await rows();

    // Select the newest revision, then walk down and press Enter.
    fireEvent.click(screen.getByRole('button', { name: 'Show changes for r123' }).closest(
      '[data-revision]'
    ) as HTMLElement);
    const list = screen.getByRole('button', { name: 'Show changes for r123' }).closest(
      '.overflow-auto'
    ) as HTMLElement;

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitForIt(() =>
      expect(screen.getByLabelText('Show changes for r122').closest('[data-revision]')).toHaveFocus()
    );

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(window.api.svn.diff).toHaveBeenCalledWith('/wc/repo', '122');
  });

  it('shows changes from the detail pane too', async () => {
    open();
    await rows();

    fireEvent.click(screen.getByText('Refactor log viewer'));
    fireEvent.click(screen.getByRole('button', { name: /^Show changes$/i }));

    expect(window.api.svn.diff).toHaveBeenCalledWith('/wc/repo', '123');
    await waitFor(() => {
      expect(screen.getByText(/r122 → r123/)).toBeTruthy();
    });
  });
});
