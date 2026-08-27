// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvn: mockState.runSvn,
}));

import { isNativeShelvingSupported } from '../svn-capabilities';

describe('svn-capabilities', () => {
  beforeEach(() => {
    mockState.runSvn.mockReset();
  });

  it('reports native shelving when the client answers `svn help shelve`', async () => {
    mockState.runSvn.mockResolvedValue({ code: 0, stdout: 'shelve: Change working copy data...', stderr: '' });

    await expect(isNativeShelvingSupported()).resolves.toBe(true);
    expect(mockState.runSvn).toHaveBeenCalledWith(['help', 'shelve']);
  });

  it('reports shelving missing for unknown-command clients', async () => {
    mockState.runSvn.mockRejectedValue(new Error('"shelve": unknown command.'));

    await expect(isNativeShelvingSupported()).resolves.toBe(false);
  });

  it('reports shelving missing when help exits 0 with only a stderr note', async () => {
    // TortoiseSVN's CLI: `svn help shelve` exits 0 with empty stdout and the
    // explanation on stderr — indistinguishable from success by exit code or
    // by stdout alone.
    mockState.runSvn.mockResolvedValue({ code: 0, stdout: '', stderr: '"shelve": unknown command.' });

    await expect(isNativeShelvingSupported()).resolves.toBe(false);
  });

  it('reports shelving missing when the option parser rejects before the subcommand', async () => {
    // TortoiseSVN's CLI parses options before resolving the subcommand, so
    // `shelve --list` there never even reaches "unknown command".
    mockState.runSvn.mockRejectedValue(new Error('svn.exe: invalid option: --list'));

    await expect(isNativeShelvingSupported()).resolves.toBe(false);
  });

  it('treats unrelated probe failures as supported so real commands report them', async () => {
    mockState.runSvn.mockRejectedValue(new Error('spawn svn.exe ENOENT'));

    await expect(isNativeShelvingSupported()).resolves.toBe(true);
  });
});
