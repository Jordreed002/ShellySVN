import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  handle: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  clearNamespace: vi.fn(),
  clearPath: vi.fn(),
  clearAll: vi.fn(),
  stats: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mockState.handle },
}));

vi.mock('../../services/svn-cache-service', () => ({
  getSvnCacheService: () => mockState,
}));

import { registerSvnCacheHandlers } from '../svn-cache';

describe('SVN cache IPC handlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockState.handle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );
    registerSvnCacheHandlers();
  });

  it('registers the complete cache contract', () => {
    expect([...handlers.keys()]).toEqual([
      'svnCache:get',
      'svnCache:list',
      'svnCache:set',
      'svnCache:delete',
      'svnCache:clearNamespace',
      'svnCache:clearPath',
      'svnCache:clearAll',
      'svnCache:stats',
    ]);
  });

  it('passes a validated transactional set to the service', async () => {
    mockState.set.mockResolvedValue({ success: true });

    await expect(
      handlers.get('svnCache:set')!({}, 'log', 'repo:100', '/repo', { entries: [] }, 60_000, 1_000)
    ).resolves.toEqual({ success: true });
    expect(mockState.set).toHaveBeenCalledWith(
      'log',
      'repo:100',
      '/repo',
      { entries: [] },
      { ttlMs: 60_000, operationStartedAt: 1_000 }
    );
  });

  it.each([
    ['unknown', 'key', '/repo', 60_000, 'Invalid SVN cache namespace'],
    ['log', '', '/repo', 60_000, 'Cache key must be a non-empty string'],
    ['log', 'key', '', 60_000, 'Cache path must be a non-empty string'],
    ['log', 'key', '/repo', 0, 'Cache TTL must be a positive finite number'],
  ])('rejects invalid set input', async (namespace, key, path, ttl, message) => {
    expect(() =>
      handlers.get('svnCache:set')!({}, namespace, key, path, {}, ttl, undefined)
    ).toThrow(message);
    expect(mockState.set).not.toHaveBeenCalled();
  });

  it('validates clear timestamps', () => {
    expect(() => handlers.get('svnCache:clearAll')!({}, Number.NaN)).toThrow('Cache timestamp');
    expect(mockState.clearAll).not.toHaveBeenCalled();
  });
});
