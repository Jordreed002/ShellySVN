// @vitest-environment node

/*
 * Platform-boundary coverage for secure-json's permission hardening.
 *
 * The sibling secure-json.test.ts verifies the 0600/0700 bits land on disk, but
 * only when the host itself is POSIX (`if (!isPosix) return`), and it never
 * asserts the Windows branch — where chmod is a no-op because Windows has no
 * POSIX permission bits. These tests force the platform and stub the fs layers
 * so the boundary is locked deterministically on every host: darwin applies the
 * restrictive chmod calls, win32 skips them entirely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  existsSync: vi.fn(() => true),
  openSync: vi.fn(() => 42),
  writeFileSync: vi.fn(),
  closeSync: vi.fn(),
  renameSync: vi.fn(),
}));

const promisesMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue({
    writeFile: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  mkdirSync: fsMocks.mkdirSync,
  chmodSync: fsMocks.chmodSync,
  existsSync: fsMocks.existsSync,
  openSync: fsMocks.openSync,
  writeFileSync: fsMocks.writeFileSync,
  closeSync: fsMocks.closeSync,
  renameSync: fsMocks.renameSync,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: promisesMocks.mkdir,
  chmod: promisesMocks.chmod,
  open: promisesMocks.open,
  rename: promisesMocks.rename,
}));

vi.mock('crypto', () => ({
  randomBytes: () => Buffer.from('deadbeefdeadbeef', 'hex'),
}));

import { hardenPrivateFile, writeSecureJson, writeSecureJsonSync } from '../secure-json';

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe('secure-json: POSIX permission hardening (macOS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('chmods the directory to 0700 and the file to 0600 on the sync path', () => {
    writeSecureJsonSync('/secure/data.json', { secret: 'x' });

    expect(fsMocks.chmodSync).toHaveBeenCalledWith('/secure', 0o700);
    expect(fsMocks.chmodSync).toHaveBeenCalledWith('/secure/data.json', 0o600);
  });

  it('chmods the directory to 0700 and the file to 0600 on the async path', async () => {
    await writeSecureJson('/secure/data.json', { secret: 'x' });

    expect(promisesMocks.chmod).toHaveBeenCalledWith('/secure', 0o700);
    expect(promisesMocks.chmod).toHaveBeenCalledWith('/secure/data.json', 0o600);
  });

  it('hardenPrivateFile tightens an existing file to 0600', () => {
    hardenPrivateFile('/secure/data.json');

    expect(fsMocks.existsSync).toHaveBeenCalledWith('/secure/data.json');
    expect(fsMocks.chmodSync).toHaveBeenCalledWith('/secure/data.json', 0o600);
  });
});

describe('secure-json: Windows skips POSIX hardening (platform boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('does not chmod on the sync path', () => {
    writeSecureJsonSync('/secure/data.json', { secret: 'x' });

    expect(fsMocks.chmodSync).not.toHaveBeenCalled();
  });

  it('does not chmod on the async path', async () => {
    await writeSecureJson('/secure/data.json', { secret: 'x' });

    expect(promisesMocks.chmod).not.toHaveBeenCalled();
  });

  it('hardenPrivateFile is a no-op on Windows', () => {
    hardenPrivateFile('/secure/data.json');

    expect(fsMocks.chmodSync).not.toHaveBeenCalled();
  });
});
