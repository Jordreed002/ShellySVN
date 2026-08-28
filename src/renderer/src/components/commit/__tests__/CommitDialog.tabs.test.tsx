import React, { createElement, type PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { CommitDialog } from '../../ui/CommitDialog';

/*
 * Layout-level coverage for the tabbed commit dialog: the message and diff
 * panes are tabs (the old stacked layout squeezed the diff out of the modal),
 * changed-path rows jump to the Diff tab, and the changed-paths sidebar
 * collapses with the preference persisted.
 */

const settings = {
  ...DEFAULT_SETTINGS,
  aiCommit: {
    ...DEFAULT_SETTINGS.aiCommit,
    enabled: true,
    provider: 'codex' as const,
    confirmBeforeSending: false,
  },
};

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings, isLoading: false, updateSettings: vi.fn() }),
}));
vi.mock('@renderer/hooks/useCommitMessageHistory', () => ({
  useCommitMessageHistory: () => ({ history: [], addMessage: vi.fn() }),
}));
vi.mock('@renderer/hooks/useCommitTemplates', () => ({
  setTemplateContext: vi.fn(),
  useCommitTemplates: () => ({ templates: [], applyTemplate: vi.fn() }),
}));
vi.mock('@renderer/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: { enabled: false, issueIdPattern: '', issueUrlTemplate: '' },
    updateConfig: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/useCommitRules', () => ({
  useCommitRules: () => ({
    rules: {
      minMessageLength: 0,
      maxSubjectLength: 0,
      requireIssueId: false,
      issueIdPattern: '',
      conventionalCommits: false,
      allowedTypes: [],
    },
    updateRules: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

/*
 * jsdom gives the virtualized file list a zero-height scroll container, so
 * `useVirtualizer` reports no visible rows. Hand back every row instead —
 * these tests exercise layout wiring, not virtualization.
 */
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 84,
    getVirtualItems: () => [
      { index: 0, size: 42, start: 0, key: 0 },
      { index: 1, size: 42, start: 42, key: 1 },
    ],
  }),
}));

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

const status = vi.fn().mockResolvedValue({
  entries: [
    { path: '/repo/src/app.ts', status: 'M', isDirectory: false },
    { path: '/repo/src/util.ts', status: 'M', isDirectory: false },
  ],
});
const diff = vi.fn().mockResolvedValue({ hasChanges: true, files: [] });

function renderDialog() {
  return render(
    <CommitDialog
      isOpen
      workingCopyPath="/repo"
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue({ success: true })}
    />,
    { wrapper }
  );
}

describe('CommitDialog message/diff tabs and collapsible sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.api = {
      ai: {
        providers: vi
          .fn()
          .mockResolvedValue([
            { provider: 'codex', available: true, authenticated: true, version: '1.0.0' },
          ]),
        generateCommitMessage: vi.fn(),
        transformDraft: vi.fn(),
        repositoryProfile: { get: vi.fn().mockResolvedValue(null) },
        cancel: vi.fn().mockResolvedValue({ success: true }),
      },
      svn: { status, diff },
      fs: { getDeepStatus: vi.fn().mockResolvedValue({ allEntries: [] }) },
    } as unknown as Window['api'];
  });

  it('renders Message and Diff tabs with Message selected first', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: 'Commit changes' });
    await within(dialog).findByRole('option', { name: /app\.ts/ }, { timeout: 5000 });

    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(within(dialog).getByRole('combobox', { name: 'Commit message' })).toBeInTheDocument();
  });

  it('shows the diff empty state when the Diff tab is activated', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('tab', { name: /^Diff/ }));

    expect(screen.getByRole('tab', { name: /^Diff/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Message/ })).toHaveAttribute('aria-selected', 'false');
    await waitFor(() =>
      expect(screen.getByText('Select a file to view changes')).toBeInTheDocument()
    );
    expect(diff).not.toHaveBeenCalled();
  });

  it('switches to the Diff tab when a changed path is clicked', async () => {
    renderDialog();

    const row = await screen.findByRole('option', { name: /app\.ts/ }, { timeout: 5000 });
    fireEvent.click(row);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Diff/ })).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.getByRole('tab', { name: /^Message/ })).toHaveAttribute('aria-selected', 'false');
    await waitFor(() =>
      expect(diff).toHaveBeenCalledWith(
        '/repo/src/app.ts',
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
  });

  it('collapses the changed-paths sidebar to a rail and restores it', async () => {
    renderDialog();
    await screen.findByRole('region', { name: 'Files to commit' });

    fireEvent.click(screen.getByRole('button', { name: 'Hide changed paths sidebar' }));

    expect(screen.getByRole('region', { name: 'Changed paths' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Files to commit' })).toBeNull();
    expect(localStorage.getItem('shellysvn.commitDialog.filesCollapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Show changed paths sidebar' }));

    expect(await screen.findByRole('region', { name: 'Files to commit' })).toBeInTheDocument();
    expect(localStorage.getItem('shellysvn.commitDialog.filesCollapsed')).toBe('0');
  });

  it('restores the collapsed sidebar when the dialog reopens', async () => {
    const { unmount } = renderDialog();
    await screen.findByRole('region', { name: 'Files to commit' });

    fireEvent.click(screen.getByRole('button', { name: 'Hide changed paths sidebar' }));
    unmount();
    renderDialog();

    expect(screen.getByRole('button', { name: 'Show changed paths sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Files to commit' })).toBeNull();
  });
});
