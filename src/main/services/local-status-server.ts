import { createServer, type Server, type Socket } from 'net';
import { existsSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

import { getStatusService } from './status-service';

export interface LocalStatusRequest {
  id?: string;
  type: 'status.getCached' | 'status.getPathStatus' | 'status.invalidate';
  path?: string;
}

export interface LocalStatusResponse {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface LocalStatusServerOptions {
  userDataPath: string;
  socketPath?: string;
}

export function getDefaultLocalStatusSocketPath(userDataPath: string): string {
  if (process.platform === 'win32') {
    const hash = createHash('sha1').update(userDataPath).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\shellysvn-status-${hash}`;
  }

  return join(userDataPath, 'shellysvn-status.sock');
}

function writeResponse(socket: Socket, response: LocalStatusResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

function handleRequest(request: LocalStatusRequest): LocalStatusResponse {
  if (!request.path && request.type !== 'status.invalidate') {
    return { id: request.id, ok: false, error: 'path is required' };
  }

  const statusService = getStatusService();

  switch (request.type) {
    case 'status.getCached':
      return {
        id: request.id,
        ok: true,
        result: request.path ? statusService.getDeepStatus(request.path) : null,
      };
    case 'status.getPathStatus':
      return {
        id: request.id,
        ok: true,
        result: request.path ? statusService.getCachedPathStatus(request.path) : null,
      };
    case 'status.invalidate':
      if (request.path) {
        statusService.invalidatePath(request.path);
      } else {
        statusService.clear();
      }
      return { id: request.id, ok: true };
  }
}

export class LocalStatusServer {
  private server: Server | null = null;
  readonly socketPath: string;

  constructor(options: LocalStatusServerOptions) {
    this.socketPath = options.socketPath ?? getDefaultLocalStatusSocketPath(options.userDataPath);
  }

  async start(): Promise<void> {
    if (this.server) return;

    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            writeResponse(socket, handleRequest(JSON.parse(line) as LocalStatusRequest));
          } catch (error) {
            writeResponse(socket, {
              ok: false,
              error: error instanceof Error ? error.message : String(error || ''),
            });
          }
        }

        newlineIndex = buffer.indexOf('\n');
      }
    });
  }
}

let localStatusServer: LocalStatusServer | null = null;

export async function startLocalStatusServer(userDataPath: string): Promise<LocalStatusServer> {
  localStatusServer ??= new LocalStatusServer({ userDataPath });
  await localStatusServer.start();
  return localStatusServer;
}

export async function stopLocalStatusServer(): Promise<void> {
  await localStatusServer?.stop();
  localStatusServer = null;
}
