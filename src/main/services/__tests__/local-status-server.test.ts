import { existsSync, statSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConnection } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalStatusServer, getDefaultLocalStatusSocketPath } from '../local-status-server';
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
});
