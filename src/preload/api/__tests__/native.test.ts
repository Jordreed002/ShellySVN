import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExternalApi } from '../native';
import type { InvokeIpc } from '../ipc';

describe('native preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createExternalApi>;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({ success: true });
    api = createExternalApi(invoke as unknown as InvokeIpc);
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
