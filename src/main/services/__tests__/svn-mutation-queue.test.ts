// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  getMutationQueueStateForTests,
  runSerializedWorkingCopyMutation,
} from '../svn-mutation-queue';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

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

    await flushMicrotasks();
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
});
