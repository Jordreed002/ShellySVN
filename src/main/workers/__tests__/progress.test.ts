// @vitest-environment node

import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { forwardWorkerProgressToRenderer } from '../progress';

describe('worker progress forwarding', () => {
  it('sends worker progress on the existing renderer event channel', () => {
    const send = vi.fn();
    const event = { sender: { send } } as unknown as IpcMainInvokeEvent;

    forwardWorkerProgressToRenderer(event, {
      channel: 'svn:operation:progress',
      payload: { operationId: 'job-1', phase: 'running' },
    });

    expect(send).toHaveBeenCalledWith('svn:operation:progress', {
      operationId: 'job-1',
      phase: 'running',
    });
  });
});
