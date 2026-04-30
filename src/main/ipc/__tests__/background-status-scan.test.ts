import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
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
}));

import {
  getBackgroundStatusScanStateForTests,
  MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
  startDeepScan,
} from '../fs';

interface PendingSvnCall {
  resolve: (value: string) => void;
}

const pendingCalls: PendingSvnCall[] = [];

function statusXml(path: string): string {
  return `<?xml version="1.0"?><status><target path="${path}"><entry path="${path}/file.txt"><wc-status item="modified"><commit revision="1"><author>alice</author></commit></wc-status></entry></target></status>`;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingCalls.length = 0;
  mockState.runSvnText.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        pendingCalls.push({ resolve });
      })
  );
});

describe('background status scan queue', () => {
  it('limits concurrent deep status scans and starts queued work as slots free up', async () => {
    const first = startDeepScan('/repo/a');
    const second = startDeepScan('/repo/b');
    const third = startDeepScan('/repo/c');

    await flushMicrotasks();

    expect(mockState.runSvnText).toHaveBeenCalledTimes(MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY);
    expect(getBackgroundStatusScanStateForTests()).toMatchObject({
      activeScanCount: MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY,
      queuedScanCount: 1,
    });

    pendingCalls[0].resolve(statusXml('/repo/a'));
    await expect(first).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ status: 'M', fullPath: expect.stringContaining('file.txt') })],
    });
    await flushMicrotasks();

    expect(mockState.runSvnText).toHaveBeenCalledTimes(3);
    expect(getBackgroundStatusScanStateForTests().queuedScanCount).toBe(0);

    pendingCalls[1].resolve(statusXml('/repo/b'));
    pendingCalls[2].resolve(statusXml('/repo/c'));
    await expect(second).resolves.toMatchObject({ allEntries: expect.any(Array) });
    await expect(third).resolves.toMatchObject({ allEntries: expect.any(Array) });
  });

  it('cancels a queued stale scan when a newer scan for the same path is requested', async () => {
    const first = startDeepScan('/repo/a');
    const second = startDeepScan('/repo/b');
    const stale = startDeepScan('/repo/c');

    await flushMicrotasks();
    expect(mockState.runSvnText).toHaveBeenCalledTimes(MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY);

    const replacement = startDeepScan('/repo/c');

    await expect(stale).resolves.toEqual({ directStatus: {}, allEntries: [] });
    expect(getBackgroundStatusScanStateForTests().queuedScanCount).toBe(1);

    pendingCalls[0].resolve(statusXml('/repo/a'));
    await first;
    await flushMicrotasks();

    expect(mockState.runSvnText).toHaveBeenCalledTimes(3);

    pendingCalls[1].resolve(statusXml('/repo/b'));
    pendingCalls[2].resolve(statusXml('/repo/c'));
    await second;
    await expect(replacement).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ status: 'M' })],
    });
  });
});
