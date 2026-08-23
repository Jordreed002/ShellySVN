import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  resolveSvnExecution: vi.fn(),
  workerRun: vi.fn(),
  workerCancel: vi.fn(),
  chokidarWatch: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('chokidar', () => ({
  default: {
    watch: mockState.chokidarWatch,
  },
}));

vi.mock('../../services/svn-executor', () => ({
  runSvnText: mockState.runSvnText,
  resolveSvnExecution: mockState.resolveSvnExecution,
}));

vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: () => ({
    run: mockState.workerRun,
    cancel: mockState.workerCancel,
  }),
}));

import {
  closeAllFileWatchers,
  closeFileWatchersForPath,
  FILE_WATCH_EVENT_DEBOUNCE_MS,
  getActiveFileWatcherPathsForTests,
  getBackgroundStatusScanStateForTests,
  MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
  registerFsHandlers,
  startDeepScan,
} from '../fs';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';
import { ipcMain } from 'electron';

interface PendingSvnCall {
  id: string;
  resolve: (value: {
    directStatus: {};
    allEntries: Array<{ status: string; fullPath: string }>;
  }) => void;
}

const pendingCalls: PendingSvnCall[] = [];

function statusResult(path: string) {
  return {
    directStatus: {},
    allEntries: [{ status: 'M', fullPath: `${path}/file.txt` }],
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingCalls.length = 0;
  mockState.resolveSvnExecution.mockResolvedValue({
    svnCommand: 'svn',
    context: {},
  });
  mockState.workerRun.mockImplementation(
    (_name: string, _payload: unknown, options: { id: string }) =>
      new Promise((resolve) => {
        pendingCalls.push({ id: options.id, resolve });
      })
  );
  mockState.workerCancel.mockReturnValue(true);
});

describe('background status scan queue', () => {
  it('emits queued, running, and complete progress for deep scans', async () => {
    const onProgress = vi.fn();
    const scan = startDeepScan('/repo/progress', onProgress);

    await flushMicrotasks();

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/repo/progress',
        jobId: 'deep-status:/repo/progress',
        phase: 'queued',
      })
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/repo/progress',
        phase: 'running',
      })
    );

    pendingCalls[0].resolve(statusResult('/repo/progress'));
    await expect(scan).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ status: 'M' })],
    });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/repo/progress',
        phase: 'complete',
        filesFound: 1,
      })
    );
  });

  it('limits concurrent deep status scans and starts queued work as slots free up', async () => {
    const first = startDeepScan('/repo/a');
    const second = startDeepScan('/repo/b');
    const third = startDeepScan('/repo/c');

    await flushMicrotasks();

    expect(mockState.workerRun).toHaveBeenCalledTimes(MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY);
    expect(getBackgroundStatusScanStateForTests()).toMatchObject({
      activeScanCount: MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
      queuedScanCount: 1,
    });

    pendingCalls[0].resolve(statusResult('/repo/a'));
    await expect(first).resolves.toMatchObject({
      allEntries: [
        expect.objectContaining({ status: 'M', fullPath: expect.stringContaining('file.txt') }),
      ],
    });
    await flushMicrotasks();

    expect(mockState.workerRun).toHaveBeenCalledTimes(3);
    expect(getBackgroundStatusScanStateForTests().queuedScanCount).toBe(0);

    pendingCalls[1].resolve(statusResult('/repo/b'));
    pendingCalls[2].resolve(statusResult('/repo/c'));
    await expect(second).resolves.toMatchObject({ allEntries: expect.any(Array) });
    await expect(third).resolves.toMatchObject({ allEntries: expect.any(Array) });
  });

  it('cancels a queued stale scan when a newer scan for the same path is requested', async () => {
    const first = startDeepScan('/repo/a');
    const second = startDeepScan('/repo/b');
    const stale = startDeepScan('/repo/c');

    await flushMicrotasks();
    expect(mockState.workerRun).toHaveBeenCalledTimes(MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY);

    const replacement = startDeepScan('/repo/c');

    await expect(stale).resolves.toEqual({ directStatus: {}, allEntries: [] });
    expect(mockState.workerCancel).toHaveBeenCalledWith('deep-status:/repo/c');
    expect(getBackgroundStatusScanStateForTests().queuedScanCount).toBe(1);

    pendingCalls[0].resolve(statusResult('/repo/a'));
    await first;
    await flushMicrotasks();

    expect(mockState.workerRun).toHaveBeenCalledTimes(3);

    pendingCalls[1].resolve(statusResult('/repo/b'));
    pendingCalls[2].resolve(statusResult('/repo/c'));
    await second;
    await expect(replacement).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ status: 'M' })],
    });
  });

  it('queues navigation-triggered deep scans immediately while existing scans are active', async () => {
    const first = startDeepScan('/repo/a');
    const second = startDeepScan('/repo/b');

    await flushMicrotasks();
    expect(getBackgroundStatusScanStateForTests()).toMatchObject({
      activeScanCount: MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
      queuedScanCount: 0,
    });

    const startedAt = performance.now();
    const navigationScan = startDeepScan('/repo/navigated');
    const queueDurationMs = performance.now() - startedAt;

    expect(queueDurationMs).toBeLessThan(50);
    expect(getBackgroundStatusScanStateForTests()).toMatchObject({
      activeScanCount: MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
      queuedScanCount: 1,
    });

    pendingCalls[0].resolve(statusResult('/repo/a'));
    await first;
    await flushMicrotasks();

    expect(mockState.workerRun).toHaveBeenCalledTimes(3);

    pendingCalls[1].resolve(statusResult('/repo/b'));
    pendingCalls[2].resolve(statusResult('/repo/navigated'));
    await second;
    await expect(navigationScan).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: expect.stringContaining('navigated') })],
    });
  });
});

/*
 * Watcher lifecycle, end to end against the real approved-roots registry and
 * the real path-guard symlink auditing (this file does not mock node:fs).
 */
describe('file watcher lifecycle and hardening', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

  beforeEach(async () => {
    clearApprovedPathsForTests();
    await closeAllFileWatchers();
    handlers.clear();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );
    mockState.chokidarWatch.mockImplementation(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    registerFsHandlers();
  });

  afterEach(async () => {
    await closeAllFileWatchers();
    clearApprovedPathsForTests();
  });

  function makeSender(id: number) {
    return {
      id,
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
    };
  }

  function lastWatcher(): { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
    const results = mockState.chokidarWatch.mock.results;
    return results[results.length - 1].value as {
      on: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  }

  it('closes a watcher on a real approved working-copy path when it is removed', async () => {
    const workingCopy = await mkdtemp(join(tmpdir(), 'shellysvn-wc-'));
    approvePathForIpc(workingCopy);

    const sender = makeSender(41);
    const result = (await handlers.get('fs:watch')!({ sender }, workingCopy)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(true);
    expect(mockState.chokidarWatch).toHaveBeenCalledTimes(1);
    expect(getActiveFileWatcherPathsForTests()).toHaveLength(1);

    await closeFileWatchersForPath(workingCopy);

    expect(lastWatcher().close).toHaveBeenCalledTimes(1);
    expect(getActiveFileWatcherPathsForTests()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses to watch through a symlink that escapes the approved root',
    async () => {
      const base = await mkdtemp(join(tmpdir(), 'shellysvn-symlink-'));
      const approved = join(base, 'approved');
      const outside = join(base, 'outside');
      await Promise.all([mkdir(approved, { recursive: true }), mkdir(outside, { recursive: true })]);
      await symlink(outside, join(approved, 'escape'));
      approvePathForIpc(approved);

      const sender = makeSender(42);
      const result = (await handlers.get('fs:watch')!({ sender }, join(approved, 'escape'))) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      // The escape is caught by approved-roots canonicalization and/or the
      // path-guard realpath audit — either way, no watcher is created.
      expect(result.error).toMatch(/selected through ShellySVN|symlink/);
      expect(mockState.chokidarWatch).not.toHaveBeenCalled();
      expect(getActiveFileWatcherPathsForTests()).toEqual([]);
    }
  );

  it('coalesces a burst of watcher events into one renderer notification (real timers)', async () => {
    const workingCopy = await mkdtemp(join(tmpdir(), 'shellysvn-wc-'));
    approvePathForIpc(workingCopy);

    const sender = makeSender(43);
    await handlers.get('fs:watch')!({ sender }, workingCopy);

    const watcher = mockState.chokidarWatch.mock.results[0].value as { on: ReturnType<typeof vi.fn> };
    const onAll = watcher.on.mock.calls.find(([event]) => event === 'all')?.[1] as (
      eventType: string,
      changedPath: string
    ) => void;

    for (let index = 0; index < 20; index++) {
      onAll('change', join(workingCopy, `file-${index}.ts`));
    }
    await sleep(FILE_WATCH_EVENT_DEBOUNCE_MS + 250);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(
      'fs:watch:change',
      expect.objectContaining({
        path: workingCopy,
        eventType: 'change',
        changedPath: join(workingCopy, 'file-19.ts'),
      })
    );
  });
});
