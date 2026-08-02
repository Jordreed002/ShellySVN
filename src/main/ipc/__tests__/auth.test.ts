import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => ({
  ready: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  clear: vi.fn(),
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
}));
const beginAuthSession = vi.hoisted(() => vi.fn());
const resumeAuthSession = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ ipcMain: { handle } }));
vi.mock('../../auth-cache', () => ({ getAuthCache: () => cache }));
vi.mock('../../services/auth-session-manager', () => ({ beginAuthSession, resumeAuthSession }));

import { registerAuthHandlers } from '../auth';

describe('Auth IPC handlers', () => {
  const handlers = new Map<string, (...args: any[]) => any>();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    cache.list.mockReturnValue([]);
    handle.mockImplementation((channel, listener) => handlers.set(channel, listener));
    registerAuthHandlers();
  });

  it('exposes session and metadata APIs but no password-reading API', () => {
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'auth:getStatus',
        'auth:beginSession',
        'auth:resumeSession',
        'auth:delete',
        'auth:list',
        'auth:clear',
        'auth:isEncryptionAvailable',
      ])
    );
    expect(handlers.has('auth:get')).toBe(false);
    expect(handlers.has('auth:set')).toBe(false);
  });

  it('returns password-free credential status', async () => {
    cache.list.mockReturnValue([
      { realm: 'https://svn.example.com', username: 'alice', createdAt: 1 },
    ]);
    await expect(handlers.get('auth:getStatus')!({}, 'https://svn.example.com')).resolves.toEqual({
      available: true,
      username: 'alice',
      persistent: true,
    });
  });

  it('binds new and resumed sessions to the sender id', async () => {
    const event = { sender: { id: 42 } };
    const request = {
      realm: 'https://svn.example.com',
      username: 'alice',
      password: 'secret',
      persistence: 'session',
    };
    await handlers.get('auth:beginSession')!(event, request);
    await handlers.get('auth:resumeSession')!(event, request.realm);
    expect(beginAuthSession).toHaveBeenCalledWith(42, request);
    expect(resumeAuthSession).toHaveBeenCalledWith(42, request.realm);
  });

  it('filters webhook secret records from SVN credential listings', async () => {
    cache.list.mockReturnValue([
      { realm: 'webhook:webhook-1', username: 'webhook', createdAt: 1 },
      { realm: 'https://svn.example.com', username: 'alice', createdAt: 2 },
    ]);
    expect(handlers.get('auth:list')!({})).toEqual([
      { realm: 'https://svn.example.com', username: 'alice', createdAt: 2 },
    ]);
  });

  it('deletes and clears stored credentials', async () => {
    expect(handlers.get('auth:delete')!({}, 'realm')).toEqual({ success: true });
    expect(handlers.get('auth:clear')!({})).toEqual({ success: true });
    expect(cache.delete).toHaveBeenCalledWith('realm');
    expect(cache.clear).toHaveBeenCalled();
  });
});
