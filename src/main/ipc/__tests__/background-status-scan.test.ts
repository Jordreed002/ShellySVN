import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  resolveSvnExecution: vi.fn(),
  workerRun: vi.fn(),
  workerCancel: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(),
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
  getBackgroundStatusScanStateForTests,
  MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
  startDeepScan,
} from '../fs';

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
