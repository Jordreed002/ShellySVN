// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMutationQueueStateForTests,
  runSerializedWorkingCopyMutation,
} from '../svn-mutation-queue';

describe('svn-mutation-queue', () => {
  it('serializes mutations for the same working-copy key', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = runSerializedWorkingCopyMutation('C:\\WC', async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
      return 'first';
    });

    const secondTask = vi.fn(async () => {
      order.push('second');
      return 'second';
    });
    const second = runSerializedWorkingCopyMutation('c:\\wc', secondTask);

    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    expect(secondTask).not.toHaveBeenCalled();

    releaseFirst();

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(getMutationQueueStateForTests().keys).toEqual([]);
  });

  it('allows independent working-copy keys to run concurrently', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = runSerializedWorkingCopyMutation('C:\\one', async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
    });

    const second = runSerializedWorkingCopyMutation('C:\\two', async () => {
      order.push('second');
    });

    await second;
    expect(order).toEqual(['first:start', 'second']);

    releaseFirst();
    await first;
  });

  it('serializes different child paths under the same administrative root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shellysvn-mutation-root-'));
    await mkdir(join(root, '.svn'));
    await mkdir(join(root, 'src'));
    const firstPath = join(root, 'src', 'first.ts');
    const secondPath = join(root, 'src', 'second.ts');
    await Promise.all([writeFile(firstPath, ''), writeFile(secondPath, '')]);
    let releaseFirst!: () => void;
    const secondTask = vi.fn(async () => undefined);

    try {
      const first = runSerializedWorkingCopyMutation(
        firstPath,
        async () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
      );
      const second = runSerializedWorkingCopyMutation(secondPath, secondTask);
      await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
      expect(secondTask).not.toHaveBeenCalled();
      releaseFirst();
      await Promise.all([first, second]);
      expect(secondTask).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
