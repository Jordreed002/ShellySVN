import { existsSync, statSync } from 'fs';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConnection, createServer as createNetServer, type AddressInfo } from 'net';
import { request as httpRequest } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIpcMainHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

import {
  LOCAL_STATUS_INFO_IPC_CHANNEL,
  LocalStatusServer,
  getDefaultLocalStatusSocketPath,
  getLocalStatusServerHttpInfo,
  startLocalStatusServer,
  stopLocalStatusServer,
} from '../local-status-server';
import { getStatusService } from '../status-service';

let server: LocalStatusServer | null = null;
let tempDir: string | null = null;
const TEST_TOKEN = 'test-status-token';

function authHeader(token: string = TEST_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function httpJson(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/status',
        headers: options.headers,
        agent: false,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      }
    );
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function listenBlocker(): Promise<{ server: ReturnType<typeof createNetServer>; port: number }> {
  const blocker = createNetServer();
  const port = await new Promise<number>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', () => {
      resolve((blocker.address() as AddressInfo).port);
    });
  });
  return { server: blocker, port };
}

function closeBlocker(blocker: ReturnType<typeof createNetServer>): Promise<void> {
  return new Promise((resolve) => blocker.close(() => resolve()));
}

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

async function createStartedServer(
  options: { maxMessageBytes?: number; httpPort?: number; httpPortAttempts?: number } = {}
) {
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
    httpPort: options.httpPort,
    httpPortAttempts: options.httpPortAttempts,
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

describe('LocalStatusServer — loopback HTTP transport', () => {
  it('binds strictly to 127.0.0.1 and reports the chosen port', async () => {
    const { server: started } = await createStartedServer();

    expect(started.httpPort).toBeTypeOf('number');
    // The listener answers on loopback and only on loopback.
    const health = await httpJson(started.httpPort as number, {
      path: '/health',
      headers: authHeader(),
    });
    expect(health.status).toBe(200);
  });

  it('rejects every request without a bearer token with 401', async () => {
    const { server: started } = await createStartedServer();
    const port = started.httpPort as number;

    const noHeader = await httpJson(port, { path: '/health' });
    expect(noHeader.status).toBe(401);
    expect(JSON.parse(noHeader.body)).toMatchObject({ ok: false, error: 'unauthorized' });

    const wrongScheme = await httpJson(port, {
      path: '/health',
      headers: { Authorization: `Basic ${TEST_TOKEN}` },
    });
    expect(wrongScheme.status).toBe(401);
  });

  it('rejects a wrong bearer token with 401', async () => {
    const { server: started } = await createStartedServer();

    const wrong = await httpJson(started.httpPort as number, {
      path: '/health',
      headers: authHeader('wrong-token'),
    });
    expect(wrong.status).toBe(401);
  });

  it('serves path status over HTTP with the correct token', async () => {
    getStatusService().setDeepStatus('C:\\repo', {
      directStatus: {},
      allEntries: [{ status: 'M', fullPath: 'C:\\repo\\src\\file.ts' }],
    });
    const { server: started } = await createStartedServer();

    const response = await httpJson(started.httpPort as number, {
      method: 'POST',
      path: '/status',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '1',
        type: 'status.getPathStatus',
        path: 'C:\\repo\\src',
      }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: '1', ok: true, result: 'M' });
  });

  it('answers authenticated health checks', async () => {
    const { server: started } = await createStartedServer();

    const health = await httpJson(started.httpPort as number, {
      path: '/health',
      headers: authHeader(),
    });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true });
  });

  it('rejects unknown paths and wrong methods', async () => {
    const { server: started } = await createStartedServer();
    const port = started.httpPort as number;

    const notFound = await httpJson(port, { path: '/nope', headers: authHeader() });
    expect(notFound.status).toBe(404);

    const methodNotAllowed = await httpJson(port, {
      method: 'GET',
      path: '/status',
      headers: authHeader(),
    });
    expect(methodNotAllowed.status).toBe(405);
  });

  it('rejects oversized HTTP bodies with 413', async () => {
    const { server: started } = await createStartedServer({ maxMessageBytes: 64 });

    const response = await httpJson(started.httpPort as number, {
      method: 'POST',
      path: '/status',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: `${'x'.repeat(128)}`,
    });
    expect(response.status).toBe(413);
  });

  it('refuses non-loopback Host headers and cross-site browser requests', async () => {
    const { server: started } = await createStartedServer();
    const port = started.httpPort as number;

    const rebinding = await httpJson(port, {
      path: '/health',
      headers: { ...authHeader(), Host: 'rebind.attacker.example' },
    });
    expect(rebinding.status).toBe(403);

    const crossSite = await httpJson(port, {
      path: '/health',
      headers: { ...authHeader(), Origin: 'https://attacker.example' },
    });
    expect(crossSite.status).toBe(403);
  });

  it('retries on the next port when the preferred HTTP port is taken', async () => {
    const blocker = await listenBlocker();

    try {
      const { server: started } = await createStartedServer({ httpPort: blocker.port });
      expect(started.httpPort).toBe(blocker.port + 1);

      const health = await httpJson(started.httpPort as number, {
        path: '/health',
        headers: authHeader(),
      });
      expect(health.status).toBe(200);
    } finally {
      await closeBlocker(blocker.server);
    }
  });

  it('falls back to an OS-assigned port after exhausting bounded retries', async () => {
    const blocker = await listenBlocker();

    try {
      const { server: started } = await createStartedServer({
        httpPort: blocker.port,
        httpPortAttempts: 1,
      });
      expect(started.httpPort).not.toBe(blocker.port);
      expect(started.httpPort).toBeGreaterThan(0);
      expect(started.httpPort).toBeLessThan(65536);

      const health = await httpJson(started.httpPort as number, {
        path: '/health',
        headers: authHeader(),
      });
      expect(health.status).toBe(200);
    } finally {
      await closeBlocker(blocker.server);
    }
  });

  it('releases the HTTP port on stop and reports no info afterwards', async () => {
    const { server: started } = await createStartedServer();
    const port = started.httpPort as number;
    expect(getLocalStatusServerHttpInfo()).toBeNull(); // not the singleton

    await started.stop();
    server = null;

    await expect(httpJson(port, { path: '/health', headers: authHeader() })).rejects.toBeTruthy();
  });

  it('exposes port and token through the singleton info getter and IPC channel', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shellysvn-status-server-'));
    const started = await startLocalStatusServer(tempDir);
    const expectedInfo = { port: started.httpPort as number, token: started.authToken };

    expect(started.authToken).toMatch(/^[A-Za-z0-9_-]{40,}$/); // randomBytes(32) base64url
    expect(getLocalStatusServerHttpInfo()).toEqual(expectedInfo);

    const registration = mockIpcMainHandle.mock.calls.find(
      (call) => call[0] === LOCAL_STATUS_INFO_IPC_CHANNEL
    );
    expect(registration).toBeDefined();
    const handler = registration?.[1] as () => unknown;
    expect(handler()).toEqual(expectedInfo);

    await stopLocalStatusServer();
    expect(getLocalStatusServerHttpInfo()).toBeNull();
    expect(handler()).toBeNull();
  });
});
