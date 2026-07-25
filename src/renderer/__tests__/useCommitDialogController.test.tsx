import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/hooks/useCommitMessageHistory', () => ({
  useCommitMessageHistory: () => ({
    history: [],
    addMessage: vi.fn(),
  }),
}));

vi.mock('../src/hooks/useCommitTemplates', () => ({
  setTemplateContext: vi.fn(),
  useCommitTemplates: () => ({
    templates: [],
    applyTemplate: vi.fn().mockResolvedValue(''),
  }),
}));

vi.mock('../src/hooks/useCommitRules', () => ({
  useCommitRules: () => ({
    rules: {},
    updateRules: vi.fn(),
  }),
}));

vi.mock('../src/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

vi.mock('../src/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: {},
    updateConfig: vi.fn(),
  }),
}));

import { useCommitDialogController } from '../src/components/commit/useCommitDialogController';
import { CommitDialog } from '../src/components/ui/CommitDialog';

const ENFORCE_STRICT_PERF = process.env.SHELLYSVN_STRICT_PERF === '1';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createWrapperWithClient(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const statusEntries = [
  { path: 'src/modified.ts', status: 'M', isDirectory: false },
  { path: 'src/added.ts', status: 'A', isDirectory: false },
  { path: 'src/deleted.ts', status: 'D', isDirectory: false },
  { path: 'src/conflicted.ts', status: 'C', isDirectory: false },
  { path: 'src/unversioned.ts', status: '?', isDirectory: false },
  { path: 'src/missing.ts', status: '!', isDirectory: false },
  { path: 'vendor/external', status: 'X', isDirectory: true },
  {
    path: 'src/changelist.ts',
    status: 'M',
    isDirectory: false,
    changelist: 'review',
  },
] as const;

describe('useCommitDialogController file selection and filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = {
      svn: {
        status: vi.fn().mockResolvedValue({ entries: statusEntries }),
        diff: vi.fn(),
      },
      fs: {
        getDeepStatus: vi.fn().mockResolvedValue({ directStatus: {}, allEntries: [] }),
      },
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];
  });

  it('loads versioned, unversioned, missing, changelist, external, and nested items with commit selection parity', async () => {
    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: 'C:\\wc',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(statusEntries.length);
    });

    expect(result.current.files.map((file) => file.path)).toEqual(
      statusEntries.map((entry) => entry.path)
    );
    expect(result.current.files.find((file) => file.path === 'src/unversioned.ts')).toMatchObject({
      committable: true,
      selected: false,
    });
    expect(result.current.files.find((file) => file.path === 'src/conflicted.ts')).toMatchObject({
      committable: false,
      selected: false,
    });
    expect(result.current.files.find((file) => file.path === 'src/missing.ts')).toMatchObject({
      committable: false,
      selected: false,
    });
    expect(result.current.files.find((file) => file.path === 'vendor/external')).toMatchObject({
      committable: false,
      selected: false,
      isDirectory: true,
    });
    expect(result.current.files.find((file) => file.path === 'src/changelist.ts')).toMatchObject({
      changelist: 'review',
      selected: true,
    });
  });

  it('filters changed files by status, changelist, and external path groups', async () => {
    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: 'C:\\wc',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(statusEntries.length);
    });

    act(() => result.current.setFileFilter('added'));
    expect(result.current.filteredFiles.map((file) => file.path)).toEqual([
      'src/added.ts',
      'src/unversioned.ts',
    ]);

    act(() => result.current.setFileFilter('deleted'));
    expect(result.current.filteredFiles.map((file) => file.path)).toEqual([
      'src/deleted.ts',
      'src/missing.ts',
    ]);

    act(() => result.current.setFileFilter('changelist'));
    expect(result.current.filteredFiles.map((file) => file.path)).toEqual(['src/changelist.ts']);

    act(() => result.current.setFileFilter('external'));
    expect(result.current.filteredFiles.map((file) => file.path)).toEqual(['vendor/external']);
  });

  it('supports selective inclusion and exclusion including multi-select helpers', async () => {
    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: 'C:\\wc',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(statusEntries.length);
    });

    act(() => result.current.handleToggleFile('src/modified.ts'));
    expect(result.current.files.find((file) => file.path === 'src/modified.ts')?.selected).toBe(
      false
    );

    act(() => result.current.handleSelectAll());
    expect(
      result.current.files.filter((file) => file.committable).every((file) => file.selected)
    ).toBe(true);
    expect(result.current.files.find((file) => file.path === 'src/missing.ts')?.selected).toBe(
      false
    );

    act(() => result.current.handleDeselectAll());
    expect(result.current.files.every((file) => !file.selected)).toBe(true);
  });

  it('shows the commit modal shell immediately while status loading is slow', () => {
    window.api = {
      svn: {
        status: vi.fn().mockReturnValue(new Promise(() => {})),
        diff: vi.fn(),
      },
      fs: {
        getDeepStatus: vi.fn().mockReturnValue(new Promise(() => {})),
      },
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];

    const startedAt = performance.now();
    render(
      <CommitDialog isOpen={true} workingCopyPath="C:\\wc" onClose={vi.fn()} onSubmit={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    const renderDurationMs = performance.now() - startedAt;

    expect(Number.isFinite(renderDurationMs)).toBe(true);
    if (ENFORCE_STRICT_PERF) {
      expect(renderDurationMs).toBeLessThan(100);
    }
    expect(screen.getByRole('dialog', { name: /commit changes/i })).toBeTruthy();
    expect(screen.getByRole('status', { name: /loading files/i })).toBeTruthy();
  });

  it('refetches status when opened even if an empty status result is cached', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['svn:status', 'C:\\wc'], { entries: [] });
    const status = vi.fn().mockResolvedValue({ entries: statusEntries });
    window.api = {
      svn: {
        status,
        diff: vi.fn(),
      },
      fs: {
        getDeepStatus: vi.fn().mockResolvedValue({ directStatus: {}, allEntries: [] }),
      },
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];

    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: 'C:\\wc',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper: createWrapperWithClient(queryClient) }
    );

    await waitFor(() => {
      expect(status).toHaveBeenCalled();
      expect(result.current.files).toHaveLength(statusEntries.length);
    });
  });

  it('falls back to deep status when SVN status returns no entries', async () => {
    window.api = {
      svn: {
        status: vi.fn().mockResolvedValue({ entries: [] }),
        diff: vi.fn(),
      },
      fs: {
        getDeepStatus: vi.fn().mockResolvedValue({
          directStatus: {},
          allEntries: [
            {
              fullPath: 'C:\\wc\\src\\modified.ts',
              status: 'M',
              revision: 123,
              author: 'dev',
            },
            {
              fullPath: 'C:\\wc\\src\\added.ts',
              status: 'A',
            },
          ],
        }),
      },
      app: {
        openExternal: vi.fn(),
      },
    } as unknown as Window['api'];

    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: 'C:\\wc',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.files.map((file) => file.path)).toEqual([
        'C:\\wc\\src\\modified.ts',
        'C:\\wc\\src\\added.ts',
      ]);
    });
    expect(result.current.selectedCount).toBe(2);
  });
});
