import { existsSync, statSync } from 'fs';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConnection } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LocalStatusServer,
  getDefaultLocalStatusSocketPath,
  startLocalStatusServer,
  stopLocalStatusServer,
} from '../local-status-server';
import { getStatusService } from '../status-service';

let server: LocalStatusServer | null = null;
let tempDir: string | null = null;
const TEST_TOKEN = 'test-status-token';

async function request(socketPath: string, payload: unknown) {
  return rawRequest(socketPath, `${JSON.stringify(payload)}\n`);
}

async function rawRequest(socketPath: string, payload: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(payload);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex >= 0) {
        socket.end();
        resolve(JSON.parse(buffer.slice(0, newlineIndex)) as Record<string, unknown>);
      }
    });
    socket.on('error', reject);
  });
}

async function createStartedServer(options: { maxMessageBytes?: number } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'shellysvn-status-server-'));
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\shellysvn-status-test-${Date.now()}`
      : join(tempDir, 'status.sock');

  server = new LocalStatusServer({
    userDataPath: tempDir,
    socketPath,
    authToken: TEST_TOKEN,
    maxMessageBytes: options.maxMessageBytes,
  });
  await server.start();
  return { socketPath, server };
}

afterEach(async () => {
  await server?.stop();
  await stopLocalStatusServer();
  server = null;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  getStatusService().clear();
});

describe('LocalStatusServer', () => {
  it('creates a platform-specific local socket path', () => {
    const socketPath = getDefaultLocalStatusSocketPath('C:\\Users\\test\\AppData\\ShellySVN');

    if (process.platform === 'win32') {
      expect(socketPath).toContain('\\\\.\\pipe\\shellysvn-status-');
    } else {
      expect(socketPath).toContain('shellysvn-status.sock');
    }
  });

  it('serves cached path status over the local socket', async () => {
    getStatusService().setDeepStatus('C:\\repo', {
      directStatus: {},
      allEntries: [{ status: 'M', fullPath: 'C:\\repo\\src\\file.ts' }],
    });

    const { socketPath } = await createStartedServer();

    await expect(
      request(socketPath, {
        id: '1',
        token: TEST_TOKEN,
        type: 'status.getPathStatus',
        path: 'C:\\repo\\src',
      })
    ).resolves.toMatchObject({
      id: '1',
      ok: true,
      result: 'M',
    });
  });

  it('rejects requests without the per-run token', async () => {
    const { socketPath } = await createStartedServer();

    await expect(
      request(socketPath, {
        id: 'missing-token',
        type: 'status.getPathStatus',
        path: 'C:\\repo',
      })
    ).resolves.toMatchObject({
      id: 'missing-token',
      ok: false,
      error: 'unauthorized',
    });
  });

  it('rejects requests with an invalid token', async () => {
    const { socketPath } = await createStartedServer();

    await expect(
      request(socketPath, {
        id: 'bad-token',
        token: 'wrong-token',
        type: 'status.getCached',
        path: 'C:\\repo',
      })
    ).resolves.toMatchObject({
      id: 'bad-token',
      ok: false,
      error: 'unauthorized',
    });
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const { socketPath } = await createStartedServer();

    await expect(rawRequest(socketPath, '{"token":\n')).resolves.toMatchObject({
      ok: false,
      error: 'malformed JSON',
    });
  });

  it('rejects oversized messages before parsing', async () => {
    const { socketPath } = await createStartedServer({ maxMessageBytes: 64 });

    await expect(rawRequest(socketPath, `${'x'.repeat(128)}\n`)).resolves.toMatchObject({
      ok: false,
      error: 'message too large',
    });
  });

  it('uses owner-only permissions for unix sockets', async () => {
    if (process.platform === 'win32') return;

    const { socketPath } = await createStartedServer();
    const mode = statSync(socketPath).mode & 0o777;

    expect(mode).toBe(0o600);
  });

  it('removes unix socket files on shutdown', async () => {
    if (process.platform === 'win32') return;

    const { socketPath } = await createStartedServer();
    expect(existsSync(socketPath)).toBe(true);

    await server?.stop();
    server = null;

    expect(existsSync(socketPath)).toBe(false);
  });

  it('can retry the same instance after listen fails', async () => {
    if (process.platform === 'win32') return;

    tempDir = await mkdtemp(join(tmpdir(), 'shellysvn-status-server-'));
    const missingParent = join(tempDir, 'missing');
    const socketPath = join(missingParent, 'status.sock');
    server = new LocalStatusServer({
      userDataPath: missingParent,
      socketPath,
      authToken: TEST_TOKEN,
    });

    await expect(server.start()).rejects.toMatchObject({ code: 'EACCES' });
    await mkdir(missingParent);
    await expect(server.start()).resolves.toBeUndefined();
    await expect(
      request(socketPath, {
        id: 'retry',
        token: TEST_TOKEN,
        type: 'status.getCached',
        path: 'C:\\repo',
      })
    ).resolves.toMatchObject({ id: 'retry', ok: true });
  });

  it('replaces the singleton after startup fails', async () => {
    if (process.platform === 'win32') return;

    // Unix-domain socket paths are short (about 104 bytes on macOS), so keep
    // this path compact while still starting with a missing parent directory.
    tempDir = await mkdtemp(join(tmpdir(), 'ss-'));
    const missingUserData = join(tempDir, 'm');

    await expect(startLocalStatusServer(missingUserData)).rejects.toBeInstanceOf(Error);
    await mkdir(missingUserData);

    const recoveredServer = await startLocalStatusServer(missingUserData);
    expect(recoveredServer.socketPath).toBe(getDefaultLocalStatusSocketPath(missingUserData));
  });
});

/*
 * Windows named-pipe path derivation. The shell helper discovers the status
 * socket via this pipe name, so it must be deterministic per user-data path,
 * distinct across different roots, and must not leak the raw user path. Host
 * platform is forced to win32 so the branch runs on any CI host.
 */
describe('getDefaultLocalStatusSocketPath — Windows', () => {
  const originalPlatform = process.platform;
  const PIPE_PREFIX = '\\\\.\\pipe\\shellysvn-status-';

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
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

  it('produces a named-pipe path with a 12-hex-char suffix', () => {
    const path = getDefaultLocalStatusSocketPath('C:\\Users\\test\\AppData\\ShellySVN');
    expect(path.startsWith(PIPE_PREFIX)).toBe(true);
    expect(path.slice(PIPE_PREFIX.length)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic for the same user-data path', () => {
    const userData = 'C:\\Users\\test\\AppData\\ShellySVN';
    expect(getDefaultLocalStatusSocketPath(userData)).toBe(
      getDefaultLocalStatusSocketPath(userData)
    );
  });

  it('yields distinct pipe names for distinct user-data paths', () => {
    const alice = getDefaultLocalStatusSocketPath('C:\\Users\\alice\\AppData\\ShellySVN');
    const bob = getDefaultLocalStatusSocketPath('C:\\Users\\bob\\AppData\\ShellySVN');
    expect(alice).not.toBe(bob);
  });

  it('hashes the user-data path so the raw path is not embedded', () => {
    const path = getDefaultLocalStatusSocketPath('C:\\Users\\secret-user\\AppData\\ShellySVN');
    expect(path).not.toContain('secret-user');
  });
});
