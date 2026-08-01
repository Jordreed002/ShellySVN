// @vitest-environment node

/*
 * macOS/POSIX socket-path derivation for the local status server.
 *
 * The sibling local-status-server tests pin the Windows named-pipe branch in a
 * forced-win32 describe, but the POSIX branch — where the Finder Sync helper
 * discovers the status socket as a Unix-domain socket under the user-data
 * directory — is only checked via a host-dependent if/else. Force darwin here so
 * the branch runs on every host and the macOS contract is locked: a
 * shellysvn-status.sock file inside userData, deterministic and distinct per
 * user, embedding the raw path (the direct contrast to Windows' hashed pipe).
 */
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDefaultLocalStatusSocketPath } from '../local-status-server';

describe('getDefaultLocalStatusSocketPath — macOS/POSIX', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  const USER_DATA = '/Users/test/Library/Application Support/ShellySVN';

  it('places the socket file inside the user-data directory', () => {
    const socketPath = getDefaultLocalStatusSocketPath(USER_DATA);
    expect(socketPath).toBe(join(USER_DATA, 'shellysvn-status.sock'));
  });

  it('uses the .sock Unix-domain-socket extension', () => {
    expect(getDefaultLocalStatusSocketPath(USER_DATA).endsWith('shellysvn-status.sock')).toBe(true);
  });

  it('is deterministic for the same user-data path', () => {
    expect(getDefaultLocalStatusSocketPath(USER_DATA)).toBe(getDefaultLocalStatusSocketPath(USER_DATA));
  });

  it('yields distinct socket paths for distinct user-data paths', () => {
    const alice = getDefaultLocalStatusSocketPath(
      '/Users/alice/Library/Application Support/ShellySVN'
    );
    const bob = getDefaultLocalStatusSocketPath(
      '/Users/bob/Library/Application Support/ShellySVN'
    );
    expect(alice).not.toBe(bob);
  });

  it('embeds the user-data path directly (unlike the hashed Windows pipe name)', () => {
    // POSIX socket lives under userData, so the raw path is present — the
    // opposite of Windows, which hashes the path to keep the pipe name short.
    const socketPath = getDefaultLocalStatusSocketPath('/Users/secret-user/Library/ShellySVN');
    expect(socketPath).toContain('secret-user');
  });
});
