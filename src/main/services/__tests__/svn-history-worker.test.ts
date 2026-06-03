// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  workerRun: vi.fn(),
  resolveSvnExecution: vi.fn(),
  getNetworkOptionsForUrl: vi.fn(),
  getNetworkOptionsForWorkingCopyPath: vi.fn(),
}));

vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: () => ({
    run: mockState.workerRun,
  }),
}));

vi.mock('../svn-executor', () => ({
  resolveSvnExecution: mockState.resolveSvnExecution,
}));

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: mockState.getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath: mockState.getNetworkOptionsForWorkingCopyPath,
}));

import {
  getWorkerBlame,
  getWorkerDiff,
  getWorkerDiffStreaming,
  getWorkerLog,
  getWorkerUrlDiff,
} from '../svn-history-worker';

describe('svn-history-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveSvnExecution.mockResolvedValue({
      svnCommand: '/usr/bin/svn',
      context: { sslVerify: true },
    });
    mockState.getNetworkOptionsForUrl.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'bob', password: 'wc-secret' },
      trustSslFailures: false,
    });
    mockState.workerRun.mockResolvedValue({});
  });

  it('passes URL-derived credentials and SSL trust to URL diff jobs', async () => {
    await getWorkerUrlDiff(
      'https://svn.example.com/repo/trunk',
      'https://svn.example.com/repo/branches/feature'
    );

    expect(mockState.getNetworkOptionsForUrl).toHaveBeenCalledWith(
      'https://svn.example.com/repo/trunk'
    );
    expect(mockState.workerRun).toHaveBeenCalledWith(
      'svn:diffUrls',
      expect.objectContaining({
        leftUrl: 'https://svn.example.com/repo/trunk',
        rightUrl: 'https://svn.example.com/repo/branches/feature',
        credentials: { username: 'alice', password: 'secret' },
        trustSslFailures: true,
        trustedSslFailures: 'unknown-ca',
      }),
      expect.any(Object)
    );
  });

  it('passes working-copy-derived credentials to local-path worker jobs', async () => {
    await getWorkerLog('C:\\wc\\src\\file.ts', 25, 1, 5, true);
    await getWorkerDiff('C:\\wc\\src\\file.ts', '42');
    await getWorkerDiffStreaming('C:\\wc\\src\\file.ts', '42');
    await getWorkerBlame('C:\\wc\\src\\file.ts', 1, 5);

    expect(mockState.getNetworkOptionsForWorkingCopyPath).toHaveBeenCalledWith(
      'C:\\wc\\src\\file.ts'
    );
    expect(mockState.workerRun).toHaveBeenCalledWith(
      'svn:log',
      expect.objectContaining({
        path: 'C:\\wc\\src\\file.ts',
        credentials: { username: 'bob', password: 'wc-secret' },
        trustSslFailures: false,
      }),
      expect.any(Object)
    );
    expect(mockState.workerRun).toHaveBeenCalledWith(
      'svn:diff',
      expect.objectContaining({
        path: 'C:\\wc\\src\\file.ts',
        credentials: { username: 'bob', password: 'wc-secret' },
      }),
      expect.any(Object)
    );
    expect(mockState.workerRun).toHaveBeenCalledWith(
      'svn:diffStreaming',
      expect.objectContaining({
        path: 'C:\\wc\\src\\file.ts',
        credentials: { username: 'bob', password: 'wc-secret' },
      }),
      expect.any(Object)
    );
    expect(mockState.workerRun).toHaveBeenCalledWith(
      'svn:blame',
      expect.objectContaining({
        path: 'C:\\wc\\src\\file.ts',
        credentials: { username: 'bob', password: 'wc-secret' },
      }),
      expect.any(Object)
    );
  });
});
