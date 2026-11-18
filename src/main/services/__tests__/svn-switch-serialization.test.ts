// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const runSvnText = vi.hoisted(() => vi.fn());
vi.mock('../svn-executor', () => ({ runSvnText }));
vi.mock('../svn-progress', () => ({ runSvnOperationWithProgress: vi.fn() }));
vi.mock('../svn-working-copy', () => ({ getWorkingCopyContext: vi.fn() }));
vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: vi.fn(),
  getNetworkOptionsForWorkingCopyPath: vi.fn(),
}));

describe('switch working-copy mutation lifecycle', () => {
  let root: string;
  beforeEach(async () => {
    vi.resetModules();
    runSvnText.mockReset();
    root = await mkdtemp(join(tmpdir(), 'shellysvn-switch-queue-'));
    await Promise.all([mkdir(join(root, '.svn')), mkdir(join(root, 'child'))]);
  });
  afterEach(async () => {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('shellysvn-switch-queue-')) {
      throw new Error('Unexpected temporary working-copy path');
    }
    await rm(root, { recursive: true, force: true });
  });

  it('waits for a mutation of the same root before switching a nested path', async () => {
    const { runSerializedWorkingCopyMutation } = await import('../svn-mutation-queue');
    const { switchWorkingCopy } = await import('../svn-repository-ops');
    let release!: () => void;
    const blocker = runSerializedWorkingCopyMutation(
      root,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    runSvnText.mockResolvedValue('Updated to revision 42.');
    const switching = switchWorkingCopy(join(root, 'child'), 'https://example.test/repo/branch');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runSvnText).not.toHaveBeenCalled();
    release();
    await blocker;
    await expect(switching).resolves.toMatchObject({ success: true, revision: 42 });
    expect(runSvnText).toHaveBeenCalledOnce();
  });

  it('tracks an active switch during shutdown and rejects new switches', async () => {
    const queue = await import('../svn-mutation-queue');
    const { switchWorkingCopy } = await import('../svn-repository-ops');
    let release!: () => void;
    runSvnText.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('Updated to revision 42.');
        })
    );
    const switching = switchWorkingCopy(root, 'https://example.test/repo/branch');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(queue.getActiveWorkingCopyMutations()).toContain(await realpath(root));
    queue.beginWorkingCopyMutationShutdown();
    await expect(switchWorkingCopy(root, 'https://example.test/repo/other')).rejects.toThrow(
      'shutting down'
    );
    expect(runSvnText).toHaveBeenCalledOnce();
    let drained = false;
    const waiting = queue.waitForWorkingCopyMutations().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([switching, waiting]);
    expect(queue.hasActiveWorkingCopyMutations()).toBe(false);
  });
});
