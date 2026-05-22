import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConnection } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalStatusServer, getDefaultLocalStatusSocketPath } from '../local-status-server';
import { getStatusService } from '../status-service';

let server: LocalStatusServer | null = null;
let tempDir: string | null = null;

async function request(socketPath: string, payload: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`);
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
    tempDir = await mkdtemp(join(tmpdir(), 'shellysvn-status-server-'));
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\shellysvn-status-test-${Date.now()}`
        : join(tempDir, 'status.sock');

    getStatusService().setDeepStatus('C:\\repo', {
      directStatus: {},
      allEntries: [{ status: 'M', fullPath: 'C:\\repo\\src\\file.ts' }],
    });

    server = new LocalStatusServer({ userDataPath: tempDir, socketPath });
    await server.start();

    await expect(
      request(socketPath, {
        id: '1',
        type: 'status.getPathStatus',
        path: 'C:\\repo\\src',
      })
    ).resolves.toMatchObject({
      id: '1',
      ok: true,
      result: 'M',
    });
  });
});
