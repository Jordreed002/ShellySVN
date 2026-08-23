import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExternalApi, createLifecycleApi, createUpdaterApi } from '../native';
import type { InvokeIpc } from '../ipc';

describe('native preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createExternalApi>;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({ success: true });
    api = createExternalApi(invoke as unknown as InvokeIpc);
  });

  it('maps updater actions and removes event listeners', async () => {
    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const updaterApi = createUpdaterApi(ipcRenderer as never, invoke as unknown as InvokeIpc);
    const callback = vi.fn();
    const unsubscribe = updaterApi.onStateChanged(callback);

    await updaterApi.check();
    await updaterApi.download();
    expect(invoke).toHaveBeenCalledWith('updater:check');
    expect(invoke).toHaveBeenCalledWith('updater:download');
    expect(ipcRenderer.on).toHaveBeenCalledWith('updater:state', expect.any(Function));

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('updater:state', expect.any(Function));
  });

  it.each([
    ['open folder', () => api.openFolder('/wc/folder'), ['external:openFolder', '/wc/folder']],
    ['open file', () => api.openFile('/wc/file.txt'), ['external:openFile', '/wc/file.txt']],
    ['reveal path', () => api.revealPath('/wc/file.txt'), ['external:revealPath', '/wc/file.txt']],
  ])('maps %s to its external IPC channel', async (_, call, expected) => {
    await call();
    expect(invoke).toHaveBeenCalledWith(...expected);
  });
});

describe('lifecycle preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createLifecycleApi>;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({ success: true });
    const ipcRenderer = { on: vi.fn(), removeListener: vi.fn() };
    api = createLifecycleApi(ipcRenderer as never, invoke as unknown as InvokeIpc);
  });

  it.each([
    [
      'stale locks',
      () => api.getStaleWorkingCopyLocks(),
      ['lifecycle:getStaleWorkingCopyLocks'],
    ],
    [
      'remove stale lock',
      () => api.removeStaleWorkingCopyLock('/wc'),
      ['lifecycle:removeStaleWorkingCopyLock', '/wc'],
    ],
    [
      'interrupted mutations',
      () => api.getInterruptedWorkingCopyMutations(),
      ['lifecycle:getInterruptedWorkingCopyMutations'],
    ],
    [
      'clear interrupted mutations',
      () => api.clearInterruptedWorkingCopyMutations(),
      ['lifecycle:clearInterruptedWorkingCopyMutations'],
    ],
    [
      'recovery plans',
      () => api.getInterruptedMutationRecoveryPlans(),
      ['lifecycle:getInterruptedMutationRecoveryPlans'],
    ],
    [
      'execute recovery plan',
      () => api.executeInterruptedMutationRecoveryPlan('/wc'),
      ['lifecycle:executeInterruptedMutationRecoveryPlan', '/wc'],
    ],
  ])('maps %s to its lifecycle IPC channel', async (_, call, expected) => {
    await call();
    expect(invoke).toHaveBeenCalledWith(...expected);
  });

  it('subscribes to recovery-plan events and unsubscribes cleanly', () => {
    const ipcRenderer = { on: vi.fn(), removeListener: vi.fn() };
    const lifecycleApi = createLifecycleApi(
      ipcRenderer as never,
      invoke as unknown as InvokeIpc
    );
    const callback = vi.fn();
    const unsubscribe = lifecycleApi.onInterruptedMutationRecoveryPlan(callback);

    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'lifecycle:interruptedMutationRecoveryPlan',
      expect.any(Function)
    );

    const handler = ipcRenderer.on.mock.calls[0][1] as (_: unknown, plan: unknown) => void;
    handler({}, { workingCopyPath: '/wc', steps: [] });
    expect(callback).toHaveBeenCalledWith({ workingCopyPath: '/wc', steps: [] });

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'lifecycle:interruptedMutationRecoveryPlan',
      expect.any(Function)
    );
  });
});
