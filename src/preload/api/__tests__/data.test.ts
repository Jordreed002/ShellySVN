import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSvnCacheApi } from '../data';
import type { InvokeIpc } from '../ipc';

describe('SVN cache preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createSvnCacheApi>;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue(undefined);
    api = createSvnCacheApi(invoke as unknown as InvokeIpc);
  });

  it('maps cache reads and writes to typed IPC channels', async () => {
    await api.get('log', 'scope');
    await api.list('status');
    await api.set('info', 'path', '/repo', { revision: 10 }, 60_000, 1_000);

    expect(invoke).toHaveBeenNthCalledWith(1, 'svnCache:get', 'log', 'scope');
    expect(invoke).toHaveBeenNthCalledWith(2, 'svnCache:list', 'status');
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'svnCache:set',
      'info',
      'path',
      '/repo',
      { revision: 10 },
      60_000,
      1_000
    );
  });

  it('maps every clear operation without changing its timestamp', async () => {
    await api.clearNamespace('log', 1_000);
    await api.clearPath('/repo', 2_000);
    await api.clearAll(3_000);
    await api.delete('entries', 'repo');
    await api.stats();

    expect(invoke).toHaveBeenNthCalledWith(1, 'svnCache:clearNamespace', 'log', 1_000);
    expect(invoke).toHaveBeenNthCalledWith(2, 'svnCache:clearPath', '/repo', 2_000);
    expect(invoke).toHaveBeenNthCalledWith(3, 'svnCache:clearAll', 3_000);
    expect(invoke).toHaveBeenNthCalledWith(4, 'svnCache:delete', 'entries', 'repo');
    expect(invoke).toHaveBeenNthCalledWith(5, 'svnCache:stats');
  });
});
