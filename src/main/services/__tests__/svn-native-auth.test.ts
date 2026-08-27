// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ runSvnText: vi.fn() }));
vi.mock('../svn-executor', () => ({ runSvnText: state.runSvnText }));
import {
  classifySvnAuthFailure,
  listNativeAuth,
  parseNativeAuthList,
  removeNativeAuth,
  verifyRepositoryCredentials,
} from '../svn-native-auth';

describe('svn native auth', () => {
  beforeEach(() => vi.clearAllMocks());
  it('parses credentials without exposing password fields', () => {
    expect(
      parseNativeAuthList(`Credential kind: svn.simple
Authentication realm: <https://svn.example.com:443> Repo
Username: alice
Password: (not shown)
`)
    ).toEqual([
      { kind: 'svn.simple', realm: '<https://svn.example.com:443> Repo', username: 'alice' },
    ]);
  });
  it('never requests passwords and removes only explicit patterns', async () => {
    state.runSvnText.mockResolvedValue('');
    await listNativeAuth(['*example.com*']);
    await removeNativeAuth(['*example.com*']);
    expect(state.runSvnText).toHaveBeenNthCalledWith(1, ['auth', '*example.com*']);
    expect(state.runSvnText).toHaveBeenNthCalledWith(2, ['auth', '--remove', '*example.com*']);
    expect(state.runSvnText.mock.calls.flat(2)).not.toContain('--show-passwords');
  });

  it('classifies SVN failure text into diagnostic reasons', () => {
    expect(classifySvnAuthFailure('svn: E170001: Authentication failed')).toBe('auth');
    expect(
      classifySvnAuthFailure('svn: E215004: No more credentials or authentication attempts')
    ).toBe('unknown');
    expect(classifySvnAuthFailure("svn: E170013: Unable to connect to a repository at URL")).toBe(
      'network'
    );
    expect(classifySvnAuthFailure('svn: E230001: Server SSL certificate untrusted')).toBe('ssl');
    expect(
      classifySvnAuthFailure('svn: E175002: could not connect: authorization failed')
    ).toBe('auth');
  });
});

describe('verifyRepositoryCredentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('probes svn info with the supplied credentials and reports success', async () => {
    state.runSvnText.mockResolvedValue('<?xml version="1.0"?>');
    const result = await verifyRepositoryCredentials(
      ' https://svn.example.com/repo ',
      'alice',
      's3cret!'
    );
    expect(result).toEqual({ ok: true });
    expect(state.runSvnText).toHaveBeenCalledWith(['info', '--non-interactive', 'https://svn.example.com/repo'], {
      credentials: { username: 'alice', password: 's3cret!' },
    });
  });

  it('classifies a rejection and scrubs the password from failure text', async () => {
    state.runSvnText.mockRejectedValue(
      new Error("svn: E170001: Authorization failed for 'secret'")
    );
    const result = await verifyRepositoryCredentials('https://svn.example.com/repo', 'alice', 'secret');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('auth');
    expect(result.message).toBeDefined();
    expect(result.message).not.toContain('secret');
    expect(result.message).toContain('••••••');
  });

  it('treats unreachable repositories as non-credential failures', async () => {
    state.runSvnText.mockRejectedValue(new Error('svn: E170013: Unable to connect to a repository'));
    const result = await verifyRepositoryCredentials('https://svn.example.com/repo', 'alice', 'pw');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network');
  });

  it('rejects invalid input without spawning SVN', async () => {
    await expect(verifyRepositoryCredentials('   ', 'alice', 'pw')).rejects.toThrow(
      'Repository URL is required'
    );
    await expect(verifyRepositoryCredentials('https://svn.example.com', '  ', 'pw')).rejects.toThrow();
    expect(state.runSvnText).not.toHaveBeenCalled();
  });
});

