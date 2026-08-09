/**
 * Working-copy resolution.
 *
 * The rule the whole browser rests on: local status exists only inside a
 * checkout, and being *outside* one is the normal case — not an error state.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnInfoResult } from '@shared/types';

import { useWorkingCopyForPath } from '../useWorkingCopyForPath';

const REPO_ROOT = 'https://svn.example.com/repo';
const WC_URL = `${REPO_ROOT}/branches/feature`;
const WC_PATH = '/Users/dev/wc/feature';
const REPO_PATH = 'branches/feature';

const info = vi.fn();
const infoUrl = vi.fn();
const status = vi.fn();
const mergeInfo = vi.fn();
const log = vi.fn();
const externalsList = vi.fn();

function workingCopyInfo(overrides: Partial<SvnInfoResult> = {}): SvnInfoResult {
  return {
    path: WC_PATH,
    url: WC_URL,
    repositoryRoot: REPO_ROOT,
    repositoryUuid: 'uuid',
    revision: 4800,
    nodeKind: 'dir',
    lastChangedAuthor: 'priya',
    lastChangedRevision: 4800,
    lastChangedDate: '2026-01-01T00:00:00Z',
    workingCopyRoot: WC_PATH,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  info.mockResolvedValue(workingCopyInfo());
  infoUrl.mockResolvedValue(workingCopyInfo({ revision: 4821 }));
  status.mockResolvedValue({ path: WC_PATH, entries: [], revision: 4800 });
  mergeInfo.mockResolvedValue({
    source: '',
    target: '',
    kind: 'eligible',
    revisions: [],
    properties: [],
    rawOutput: '',
  });
  log.mockResolvedValue({ entries: [], startRevision: 0, endRevision: 0 });
  externalsList.mockResolvedValue({ externals: [] });

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      svn: { info, infoUrl, status, mergeInfo, log, externals: { list: externalsList } },
    },
  });
});

describe('useWorkingCopyForPath', () => {
  it('treats "not a working copy" as a normal outcome, not an error', async () => {
    info.mockRejectedValue(new Error("svn: warning: W155007: '/tmp/nope' is not a working copy"));

    const { result } = renderHook(() => useWorkingCopyForPath('trunk', '/tmp/nope'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.notAWorkingCopy).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.scope).toBe('repository');
    expect(result.current.isWorkingCopy).toBe(false);
    expect(result.current.workingCopy).toBeNull();
    // No local facts may leak out for a path the server-only view describes.
    expect(result.current.statusByPath.size).toBe(0);
    expect(result.current.problems).toEqual([]);
    // Nothing downstream of identity should have run.
    expect(status).not.toHaveBeenCalled();
    expect(externalsList).not.toHaveBeenCalled();
  });

  it('surfaces a genuine svn info failure as an error', async () => {
    info.mockRejectedValue(new Error('svn: E170013: Unable to connect to a repository'));

    const { result } = renderHook(() => useWorkingCopyForPath('trunk', WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toContain('E170013'));
    expect(result.current.notAWorkingCopy).toBe(false);
  });

  it('resolves a working copy and builds its state from info, head and status', async () => {
    status.mockResolvedValue({
      path: WC_PATH,
      revision: 4800,
      entries: [
        { path: `${WC_PATH}/src/app.ts`, status: 'M', revision: 4800, isDirectory: false },
        { path: `${WC_PATH}/src/new.ts`, status: 'A', revision: 4700, isDirectory: false },
      ],
    });

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.workingCopy).not.toBeNull());
    await waitFor(() => expect(result.current.statusByPath.size).toBe(2));

    expect(result.current.scope).toBe('working-copy');
    expect(result.current.workingCopyRepoPaths).toEqual([REPO_PATH]);

    const workingCopy = result.current.workingCopy;
    expect(workingCopy?.repoPath).toBe(REPO_PATH);
    expect(workingCopy?.baseRevision).toBe(4800);
    await waitFor(() => expect(result.current.workingCopy?.headRevision).toBe(4821));
    expect(workingCopy?.rollup).toEqual({ modified: 1, added: 1, deleted: 0, conflicted: 0 });
    // A working copy is a range: the subtree at r4700 must be visible as such.
    expect(result.current.workingCopy?.mixedRevisions).toEqual({ lowest: 4700, highest: 4800 });
  });

  it('keys status entries by repository-relative path so the listing can join them', async () => {
    status.mockResolvedValue({
      path: WC_PATH,
      revision: 4800,
      entries: [{ path: `${WC_PATH}/src/app.ts`, status: 'M', isDirectory: false }],
    });

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.statusByPath.size).toBe(1));
    expect([...result.current.statusByPath.keys()]).toEqual(['branches/feature/src/app.ts']);
  });

  it('explains a locked working copy instead of failing the whole resolution', async () => {
    status.mockResolvedValue({
      path: WC_PATH,
      revision: 4800,
      entries: [],
      error: "svn: E155004: Working copy '/Users/dev/wc/feature' locked",
      errorCode: 'E155004',
    });

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.problems.length).toBeGreaterThan(0));
    const cleanup = result.current.problems.find((problem) => problem.kind === 'needs-cleanup');
    expect(cleanup?.command).toBe(`svn cleanup "${WC_PATH}"`);
    // Still a working copy — a lock does not un-checkout it.
    expect(result.current.isWorkingCopy).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('does not block on svn status: identity resolves while status is still running', async () => {
    let releaseStatus: (() => void) | null = null;
    status.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseStatus = () => resolve({ path: WC_PATH, entries: [], revision: 4800 });
        })
    );

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isWorkingCopy).toBe(true));
    expect(result.current.isResolving).toBe(false);
    await waitFor(() => expect(result.current.isStatusPending).toBe(true));

    releaseStatus?.();
    await waitFor(() => expect(result.current.isStatusPending).toBe(false));
  });

  it('forwards an abort signal so a slow status can be cancelled', async () => {
    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(status).toHaveBeenCalledWith(
      WC_PATH,
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(typeof result.current.cancelStatus).toBe('function');
  });

  it('skips svn status entirely when the caller defers it', async () => {
    const { result } = renderHook(
      () => useWorkingCopyForPath(REPO_PATH, WC_PATH, { includeStatus: false }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isWorkingCopy).toBe(true));
    expect(status).not.toHaveBeenCalled();
    expect(result.current.workingCopy?.rollup).toEqual({
      modified: 0,
      added: 0,
      deleted: 0,
      conflicted: 0,
    });
  });

  it('reports eligible revisions as unavailable rather than zero without a merge source', async () => {
    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isWorkingCopy).toBe(true));
    expect(mergeInfo).not.toHaveBeenCalled();
    expect(result.current.eligibleRevisionsAvailable).toBe(false);
    expect(
      result.current.unsupported.some((gap) => gap.capability === 'working-copy:eligible-revisions')
    ).toBe(true);
  });

  it('counts eligible revisions with svn mergeinfo when a source is supplied', async () => {
    mergeInfo.mockResolvedValue({
      source: `${REPO_ROOT}/trunk`,
      target: WC_PATH,
      kind: 'eligible',
      revisions: [4810, 4815, 4820],
      properties: [],
      rawOutput: '',
    });

    const { result } = renderHook(
      () => useWorkingCopyForPath(REPO_PATH, WC_PATH, { mergeSource: `${REPO_ROOT}/trunk` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.workingCopy?.eligibleRevisions).toBe(3));
    expect(mergeInfo).toHaveBeenCalledWith(`${REPO_ROOT}/trunk`, WC_PATH, 'eligible');
    expect(result.current.eligibleRevisionsAvailable).toBe(true);
  });

  it('counts incoming revisions with svn log over BASE+1:HEAD', async () => {
    log.mockResolvedValue({
      entries: [{ revision: 4821 }, { revision: 4810 }],
      startRevision: 4801,
      endRevision: 4821,
    });

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.workingCopy?.incomingRevisions).toBe(2));
    expect(log).toHaveBeenCalledWith(
      WC_URL,
      expect.any(Number),
      4821,
      4801,
      false,
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('raises a floating external as an advisory problem', async () => {
    externalsList.mockResolvedValue({
      externals: [
        { name: 'fonts', url: '^/vendor/fonts', path: `${WC_PATH}/vendor/fonts` },
        {
          name: 'pinned',
          url: '^/vendor/icons',
          path: `${WC_PATH}/vendor/icons`,
          pegRevision: 2413,
        },
      ],
    });

    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, WC_PATH), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.problems.some((problem) => problem.kind === 'floating-external')).toBe(
        true
      )
    );
    const floating = result.current.problems.filter(
      (problem) => problem.kind === 'floating-external'
    );
    // Only the unpinned one is a problem.
    expect(floating).toHaveLength(1);
    expect(floating[0].path).toBe(`${WC_PATH}/vendor/fonts`);
  });

  it('does nothing at all without a local path', () => {
    const { result } = renderHook(() => useWorkingCopyForPath(REPO_PATH, null), {
      wrapper: createWrapper(),
    });

    expect(info).not.toHaveBeenCalled();
    expect(result.current.scope).toBe('repository');
    expect(result.current.notAWorkingCopy).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });
});
