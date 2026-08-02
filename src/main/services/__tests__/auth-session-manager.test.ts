// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  ready: vi.fn().mockResolvedValue(undefined),
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
  set: vi.fn(),
  get: vi.fn(),
  findForUrl: vi.fn(),
}));

vi.mock('../../auth-cache', () => ({ getAuthCache: () => cache }));

import {
  beginAuthSession,
  clearAuthSessions,
  resolveAuthSession,
  resumeAuthSession,
} from '../auth-session-manager';

describe('main-process authentication sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    cache.isEncryptionAvailable.mockReturnValue(true);
    cache.get.mockReturnValue(null);
    cache.findForUrl.mockReturnValue(null);
    clearAuthSessions();
  });

  afterEach(() => {
    clearAuthSessions();
    vi.useRealTimers();
  });

  it('returns an opaque renderer-bound session without exposing the password', async () => {
    const session = await beginAuthSession(7, {
      realm: 'https://svn.example.com/repo',
      username: 'alice',
      password: 'very-secret',
      persistence: 'session',
    });

    expect(session.id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(session)).not.toContain('very-secret');
    expect(resolveAuthSession(7, session.id, 'https://svn.example.com/other')).toEqual({
      username: 'alice',
      password: 'very-secret',
    });
    expect(() => resolveAuthSession(8, session.id)).toThrow('Invalid authentication session');
  });

  it('rejects use against another repository origin and expires idle sessions', async () => {
    const session = await beginAuthSession(7, {
      realm: 'https://svn.example.com/repo',
      username: 'alice',
      password: 'secret',
      persistence: 'session',
    });

    expect(() => resolveAuthSession(7, session.id, 'https://evil.example/repo')).toThrow(
      'does not match'
    );
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(() => resolveAuthSession(7, session.id)).toThrow('expired');
  });

  it('resumes encrypted credentials without returning their password', async () => {
    cache.get.mockReturnValue({ username: 'alice', password: 'stored-secret' });
    const session = await resumeAuthSession(7, 'https://svn.example.com/repo');

    expect(session).toMatchObject({ username: 'alice', persistent: true, expiresAt: null });
    expect(JSON.stringify(session)).not.toContain('stored-secret');
  });
});
