import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnStatusResult } from '@shared/types';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';

import {
  SILENT_FORM_EVENT,
  useOutOfDateCommitGate,
  useWorkingCopyMixedRevisions,
} from '../useWorkingCopyFreshness';

const WORKING_COPY = '/wc';

function makeRemoteStatus(entries: Partial<SvnStatusResult['entries'][number]>[]) {
  return {
    path: WORKING_COPY,
    revision: 0,
    remoteChecked: true,
    entries: entries.map((entry) => ({
      path: '',
      status: 'M' as const,
      isDirectory: false,
      ...entry,
    })),
  } satisfies SvnStatusResult;
}

/** A form event shaped like the one the dialog's submit handler receives. */
const submitEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

interface GateHarness {
  runCommit: ReturnType<typeof vi.fn>;
  runUpdate: ReturnType<typeof vi.fn>;
  onUpdated: ReturnType<typeof vi.fn>;
}

function setupGate(
  overrides?: Partial<Parameters<typeof useOutOfDateCommitGate>[0]> & { ready?: boolean }
) {
  const harness: GateHarness = {
    runCommit: vi.fn(),
    runUpdate: vi.fn(),
    onUpdated: vi.fn(),
  };
  const hook = renderHook(() =>
    useOutOfDateCommitGate({
      workingCopyPath: WORKING_COPY,
      isCommitReady: () => overrides?.ready ?? true,
      getSelectedPaths: () => [`${WORKING_COPY}/src/a.ts`],
      runCommit: harness.runCommit,
      runUpdate: harness.runUpdate,
      onUpdated: harness.onUpdated,
    })
  );
  return { harness, ...hook };
}

describe('useOutOfDateCommitGate', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.statusRemote = vi.fn();
  });

  afterEach(cleanup);

  it('never spends a repository round trip when the commit fails fast locally', async () => {
    const { harness, result } = setupGate({ ready: false });

    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });

    expect(window.api.svn.statusRemote).not.toHaveBeenCalled();
    expect(harness.runCommit).toHaveBeenCalledWith(submitEvent);
    expect(result.current.state.phase).toBe('idle');
  });

  it('lets the commit through when the repository holds nothing newer', async () => {
    window.api.svn.statusRemote = vi
      .fn()
      .mockResolvedValue(makeRemoteStatus([{ path: 'src/a.ts', revision: 5 }]));

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });

    await waitFor(() => expect(harness.runCommit).toHaveBeenCalledOnce());
    expect(harness.runCommit).toHaveBeenCalledWith(submitEvent);
    expect(result.current.state.phase).toBe('idle');
  });

  it('blocks the commit and reports the incoming paths and revisions', async () => {
    window.api.svn.statusRemote = vi.fn().mockResolvedValue(
      makeRemoteStatus([
        { path: 'src/a.ts', revision: 5, remoteStatus: 'M', remoteRevision: 9 },
        { path: 'docs/x.md', revision: 2, remoteStatus: 'M', remoteRevision: 9 },
      ])
    );

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });

    expect(harness.runCommit).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('blocked');
    expect(result.current.state.incoming).toEqual([
      { path: 'src/a.ts', baseRevision: 5, headRevision: 9 },
    ]);
  });

  it('fails open when the check errors — the commit path is never the casualty', async () => {
    window.api.svn.statusRemote = vi.fn().mockRejectedValue(new Error('E170013: unable to connect'));

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });

    await waitFor(() => expect(harness.runCommit).toHaveBeenCalledOnce());
    expect(result.current.state.phase).toBe('idle');
  });

  it('fails open when the read itself reports an error', async () => {
    window.api.svn.statusRemote = vi
      .fn()
      .mockResolvedValue({ ...makeRemoteStatus([]), remoteChecked: true, error: 'E175002' });

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });

    await waitFor(() => expect(harness.runCommit).toHaveBeenCalledOnce());
    expect(result.current.state.phase).toBe('idle');
  });

  it('commits after "Commit anyway" without a second check', async () => {
    window.api.svn.statusRemote = vi.fn().mockResolvedValue(
      makeRemoteStatus([{ path: 'src/a.ts', revision: 5, remoteStatus: 'M', remoteRevision: 9 }])
    );

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(result.current.state.phase).toBe('blocked');

    await act(async () => {
      result.current.commitAnyway();
    });
    expect(harness.runCommit).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe('idle');
  });

  it('"Update and retry" updates via the existing action, refreshes, then commits once', async () => {
    window.api.svn.statusRemote = vi.fn().mockResolvedValue(
      makeRemoteStatus([{ path: 'src/a.ts', revision: 5, remoteStatus: 'M', remoteRevision: 9 }])
    );
    const runUpdate = vi.fn().mockResolvedValue({ success: true, revision: 9 });

    const harness: GateHarness = { runCommit: vi.fn(), runUpdate, onUpdated: vi.fn() };
    const { result } = renderHook(() =>
      useOutOfDateCommitGate({
        workingCopyPath: WORKING_COPY,
        isCommitReady: () => true,
        getSelectedPaths: () => [`${WORKING_COPY}/src/a.ts`],
        runCommit: harness.runCommit,
        runUpdate: harness.runUpdate,
        onUpdated: harness.onUpdated,
      })
    );

    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(result.current.state.phase).toBe('blocked');

    await act(async () => {
      await result.current.updateAndRetry();
    });

    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(harness.onUpdated).toHaveBeenCalledOnce();
    expect(harness.runCommit).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('idle');
  });

  it('holds the commit with the failure reported when the update fails', async () => {
    window.api.svn.statusRemote = vi.fn().mockResolvedValue(
      makeRemoteStatus([{ path: 'src/a.ts', revision: 5, remoteStatus: 'M', remoteRevision: 9 }])
    );

    const { harness, result } = setupGate();
    harness.runUpdate.mockResolvedValue({ success: false, message: 'E155004: locked' });

    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    await act(async () => {
      await result.current.updateAndRetry();
    });

    expect(harness.runCommit).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.error).toBe('E155004: locked');

    // The escape hatches still work from the failed state.
    await act(async () => {
      result.current.commitAnyway();
    });
    expect(harness.runCommit).toHaveBeenCalledOnce();
  });

  it('ignores a second submit while a check is in flight', async () => {
    let release: ((value: SvnStatusResult) => void) | undefined;
    window.api.svn.statusRemote = vi.fn().mockImplementation(
      () =>
        new Promise<SvnStatusResult>((resolve) => {
          release = resolve;
        })
    );

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(result.current.state.phase).toBe('checking');

    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(window.api.svn.statusRemote).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.(makeRemoteStatus([]));
    });
    await waitFor(() => expect(harness.runCommit).toHaveBeenCalledOnce());
  });

  it('passes an abort signal so the check is cancellable, and cancel holds the commit', async () => {
    let release: ((value: SvnStatusResult) => void) | undefined;
    window.api.svn.statusRemote = vi.fn().mockImplementation(
      (_path: string, options?: { signal?: AbortSignal }) =>
        new Promise<SvnStatusResult>((resolve) => {
          options?.signal?.addEventListener('abort', () => {
            resolve(makeRemoteStatus([]));
          });
          release = resolve;
        })
    );

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(result.current.state.phase).toBe('checking');

    await act(async () => {
      result.current.cancel();
    });
    // Resolution after cancellation must not resurrect the commit.
    await act(async () => {
      release?.(makeRemoteStatus([{ path: 'src/a.ts', remoteStatus: 'M' }]));
    });

    expect(harness.runCommit).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('idle');
  });

  it('skipCheck commits immediately without waiting for the answer', async () => {
    window.api.svn.statusRemote = vi.fn().mockImplementation(
      () => new Promise<SvnStatusResult>(() => undefined) // never resolves
    );

    const { harness, result } = setupGate();
    await act(async () => {
      result.current.gateSubmit(submitEvent);
    });
    expect(result.current.state.phase).toBe('checking');

    await act(async () => {
      result.current.skipCheck();
    });
    expect(harness.runCommit).toHaveBeenCalledWith(SILENT_FORM_EVENT);
    expect(result.current.state.phase).toBe('idle');
  });
});

describe('useWorkingCopyMixedRevisions', () => {
  afterEach(cleanup);

  function setup(cacheSeed?: (client: QueryClient) => void) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cacheSeed?.(client);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(
      ({ path }: { path?: string }) => useWorkingCopyMixedRevisions(path ?? '/wc', 18),
      { wrapper, initialProps: {} }
    );
  }

  it('derives the mixed state from cached deep status and child commits — no new reads', () => {
    const spy = vi.fn();
    window.api = createMockElectronAPI();
    window.api.fs.getDeepStatus = spy;

    const { result } = setup((client) => {
      client.setQueryData(['fs:getDeepStatus', '/wc'], {
        directStatus: {},
        allEntries: [{ status: 'M', fullPath: '/wc/src/a.ts', revision: 22 }],
      });
      client.setQueryData(['svn:childCommits', '/wc'], {
        lib: { revision: 25, author: 'jordan', date: '' },
      });
    });

    expect(result.current).not.toBeNull();
    expect(result.current?.maxRevision).toBe(25);
    expect(result.current?.itemCount).toBe(2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays silent when the Files surface has not read that working copy yet', () => {
    const { result } = setup();
    expect(result.current).toBeNull();
  });
});
