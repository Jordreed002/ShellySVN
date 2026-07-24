import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  resolveSvnExecution: vi.fn(),
  run: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  resolveSvnExecution: mockState.resolveSvnExecution,
}));

vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: () => ({ run: mockState.run }),
}));

import { getWorkerFsStatus } from '../svn-status-worker';

const EMPTY_STATUS = { directStatus: {}, allEntries: [] };

describe('svn-status-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveSvnExecution.mockResolvedValue({
      svnCommand: 'svn',
      context: {},
    });
  });

  it('coalesces identical active filesystem status requests', async () => {
    let finishStatus: ((result: typeof EMPTY_STATUS) => void) | undefined;
    mockState.run.mockReturnValue(
      new Promise<typeof EMPTY_STATUS>((resolve) => {
        finishStatus = resolve;
      })
    );

    const first = getWorkerFsStatus('/repo/project', 'immediates');
    const duplicate = getWorkerFsStatus('/repo/project', 'immediates');

    await vi.waitFor(() => expect(mockState.run).toHaveBeenCalledTimes(1));
    expect(mockState.resolveSvnExecution).toHaveBeenCalledTimes(1);

    finishStatus?.(EMPTY_STATUS);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([EMPTY_STATUS, EMPTY_STATUS]);
  });

  it('allows a fresh request after the previous request settles', async () => {
    mockState.run.mockResolvedValue(EMPTY_STATUS);

    await getWorkerFsStatus('/repo/project', 'immediates');
    await getWorkerFsStatus('/repo/project', 'immediates');

    expect(mockState.run).toHaveBeenCalledTimes(2);
  });

  it('allows a retry after a shared request fails', async () => {
    mockState.run
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValueOnce(EMPTY_STATUS);

    const first = getWorkerFsStatus('/repo/retry', 'immediates');
    const duplicate = getWorkerFsStatus('/repo/retry', 'immediates');

    await expect(Promise.all([first, duplicate])).rejects.toThrow('status failed');
    await expect(getWorkerFsStatus('/repo/retry', 'immediates')).resolves.toEqual(EMPTY_STATUS);
    expect(mockState.run).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce different paths or depths', async () => {
    mockState.run.mockResolvedValue(EMPTY_STATUS);

    await Promise.all([
      getWorkerFsStatus('/repo/first', 'immediates'),
      getWorkerFsStatus('/repo/second', 'immediates'),
      getWorkerFsStatus('/repo/first', 'infinity'),
    ]);

    expect(mockState.run).toHaveBeenCalledTimes(3);
  });
});
