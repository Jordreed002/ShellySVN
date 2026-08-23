import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LONG_OPERATION_THRESHOLD_MS,
  MUTATION_GRACE_MS,
  OPERATION_DEDUPE_WINDOW_MS,
  createMutationCompletionWatcher,
  describeOperation,
  fireDesktopNotification,
  isLongOperation,
  markOperationAnnounced,
  operationPathIdentity,
  resetOperationAnnouncementsForTests,
  shouldAnnounceOperation,
  shouldRecordInCenter,
  shouldSendDesktopNotification,
  type CompletedOperation,
} from '../operationNotifications';

const op = (overrides: Partial<CompletedOperation> = {}): CompletedOperation => ({
  path: '/wc/atlas',
  label: 'Update',
  durationMs: LONG_OPERATION_THRESHOLD_MS,
  outcome: 'success',
  revision: 42,
  ...overrides,
});

describe('thresholds and gating', () => {
  it('classifies long operations at the threshold', () => {
    expect(isLongOperation(LONG_OPERATION_THRESHOLD_MS - 1)).toBe(false);
    expect(isLongOperation(LONG_OPERATION_THRESHOLD_MS)).toBe(true);
  });

  it('records failures always, but successes only when long', () => {
    expect(shouldRecordInCenter(op({ outcome: 'failed', durationMs: 50 }))).toBe(true);
    expect(shouldRecordInCenter(op({ durationMs: LONG_OPERATION_THRESHOLD_MS - 1 }))).toBe(false);
    expect(shouldRecordInCenter(op({ durationMs: LONG_OPERATION_THRESHOLD_MS }))).toBe(true);
  });

  it('sends desktop notifications only when enabled AND long', () => {
    const long = op();
    const short = op({ durationMs: 100 });
    expect(shouldSendDesktopNotification(undefined, long)).toBe(false);
    expect(
      shouldSendDesktopNotification({ notifications: { enableSystemNotifications: false } }, long)
    ).toBe(false);
    expect(
      shouldSendDesktopNotification({ notifications: { enableSystemNotifications: true } }, short)
    ).toBe(false);
    expect(
      shouldSendDesktopNotification({ notifications: { enableSystemNotifications: true } }, long)
    ).toBe(true);
  });

  it('describes an operation for humans', () => {
    expect(describeOperation(op())).toMatchObject({
      title: 'Update finished — atlas',
      body: 'r42 · 8.0s',
      type: 'success',
    });
    expect(describeOperation(op({ outcome: 'failed', detail: 'E155004' })).type).toBe('error');
    expect(describeOperation(op({ outcome: 'warning' })).type).toBe('warning');
  });

  it('normalises paths for cross-source matching', () => {
    expect(operationPathIdentity('/wc/atlas/')).toBe(operationPathIdentity('/wc/atlas'));
    expect(operationPathIdentity('C:\\Repos\\Atlas')).toBe(operationPathIdentity('c:/repos/atlas'));
  });
});

describe('desktop notification firing', () => {
  const originalApi = window.api;

  afterEach(() => {
    window.api = originalApi;
  });

  it('fires through the existing IPC, silent unless sounds are enabled', async () => {
    const show = vi.fn().mockResolvedValue(true);
    window.api = { notification: { show } } as unknown as Window['api'];

    expect(await fireDesktopNotification({ notifications: { enableSystemNotifications: false } }, op())).toBe(
      false
    );
    expect(show).not.toHaveBeenCalled();

    await fireDesktopNotification(
      { notifications: { enableSystemNotifications: true, enableSounds: false } },
      op()
    );
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Update finished — atlas', type: 'success', silent: true })
    );

    await fireDesktopNotification(
      { notifications: { enableSystemNotifications: true, enableSounds: true } },
      op()
    );
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ silent: false }));
  });

  it('degrades silently when the IPC rejects', async () => {
    window.api = {
      notification: { show: vi.fn().mockRejectedValue(new Error('no notifications')) },
    } as unknown as Window['api'];
    await expect(
      fireDesktopNotification({ notifications: { enableSystemNotifications: true } }, op())
    ).resolves.toBe(false);
  });
});

describe('completion dedupe', () => {
  beforeEach(() => {
    resetOperationAnnouncementsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetOperationAnnouncementsForTests();
  });

  it('announces once per completion within the window, then allows it again', () => {
    const path = '/wc/atlas';
    expect(shouldAnnounceOperation(path)).toBe(true);
    markOperationAnnounced(path);
    expect(shouldAnnounceOperation(path)).toBe(false);
    vi.advanceTimersByTime(OPERATION_DEDUPE_WINDOW_MS + 1);
    expect(shouldAnnounceOperation(path)).toBe(true);
  });
});

describe('createMutationCompletionWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('measures durations from the active-set transitions', () => {
    const completions: { path: string; durationMs: number; success: boolean }[] = [];
    let now = 10_000;
    const watcher = createMutationCompletionWatcher({
      onCompleted: (completion) => completions.push(completion),
      now: () => now,
      graceMs: MUTATION_GRACE_MS,
    });

    watcher.onActivePathsChanged(['/wc/atlas']);
    now += 20_000;
    watcher.onActivePathsChanged([]);
    expect(completions).toHaveLength(0); // waiting for the grace window

    vi.advanceTimersByTime(MUTATION_GRACE_MS + 1);
    expect(completions).toEqual([{ path: '/wc/atlas', durationMs: 20_000, success: false }]);
    watcher.dispose();
  });

  it('confirms success when the mutation notification covers the path (in time)', () => {
    const completions: { path: string; success: boolean; durationMs: number }[] = [];
    let now = 0;
    const watcher = createMutationCompletionWatcher({
      onCompleted: (completion) => completions.push(completion),
      now: () => now,
    });

    watcher.onActivePathsChanged(['C:\\Repos\\Atlas']);
    now += 12_000;
    watcher.onActivePathsChanged([]);
    // The notification names the same working copy in another spelling.
    watcher.onMutationNotification(['c:/repos/atlas']);
    expect(completions).toEqual([{ path: 'C:\\Repos\\Atlas', durationMs: 12_000, success: true }]);
    watcher.dispose();
  });

  it('accepts notifications naming a path under the working copy (commit of a subdir)', () => {
    const completions: { path: string; success: boolean }[] = [];
    const watcher = createMutationCompletionWatcher({
      onCompleted: (completion) => completions.push(completion),
      now: () => 0,
    });
    watcher.onActivePathsChanged(['/wc/atlas']);
    watcher.onActivePathsChanged([]);
    watcher.onMutationNotification(['/wc/atlas/trunk']);
    expect(completions).toEqual([{ path: '/wc/atlas', durationMs: 0, success: true }]);
    watcher.dispose();
  });

  it('ignores re-entries and late notifications after disposal', () => {
    const completions: { path: string; success: boolean }[] = [];
    let now = 0;
    const watcher = createMutationCompletionWatcher({
      onCompleted: (completion) => completions.push(completion),
      now: () => now,
    });

    watcher.onActivePathsChanged(['/wc/a']);
    watcher.onActivePathsChanged(['/wc/a', '/wc/b']);
    watcher.onActivePathsChanged(['/wc/a', '/wc/b']); // no-op churn
    now += 1000;
    watcher.onActivePathsChanged(['/wc/a']); // b ends
    watcher.onActivePathsChanged(['/wc/a', '/wc/b']); // b restarts quickly

    vi.advanceTimersByTime(MUTATION_GRACE_MS + 1);
    // The first b end resolves as not-successful through the grace timer.
    expect(completions.filter((entry) => entry.path === '/wc/b')).toEqual([
      { path: '/wc/b', durationMs: 1000, success: false },
    ]);

    watcher.dispose();
    const before = completions.length;
    watcher.onMutationNotification(['/wc/a']);
    vi.advanceTimersByTime(MUTATION_GRACE_MS + 1);
    expect(completions.length).toBe(before);
  });
});
