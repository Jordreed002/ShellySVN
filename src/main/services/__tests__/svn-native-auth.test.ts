// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ runSvnText: vi.fn() }));
vi.mock('../svn-executor', () => ({ runSvnText: state.runSvnText }));
import { listNativeAuth, parseNativeAuthList, removeNativeAuth } from '../svn-native-auth';

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
});
