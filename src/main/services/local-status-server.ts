import { createServer, type Server, type Socket } from 'net';
import { chmodSync, existsSync, unlinkSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';

import { getStatusService } from './status-service';

export const DEFAULT_LOCAL_STATUS_MAX_MESSAGE_BYTES = 64 * 1024;

export interface LocalStatusRequest {
  id?: string;
  token?: string;
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
  authToken?: string;
  maxMessageBytes?: number;
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

function generateAuthToken(): string {
  return randomBytes(32).toString('base64url');
}

function isValidRequest(value: unknown): value is LocalStatusRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isExpectedToken(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function handleRequest(request: LocalStatusRequest, authToken: string): LocalStatusResponse {
  if (!isExpectedToken(request.token, authToken)) {
    return { id: request.id, ok: false, error: 'unauthorized' };
  }

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
    default:
      return { id: request.id, ok: false, error: 'unsupported request type' };
  }
}

export class LocalStatusServer {
  private server: Server | null = null;
  readonly socketPath: string;
  readonly authToken: string;
  private readonly maxMessageBytes: number;

  constructor(options: LocalStatusServerOptions) {
    this.socketPath = options.socketPath ?? getDefaultLocalStatusSocketPath(options.userDataPath);
    this.authToken = options.authToken ?? generateAuthToken();
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_LOCAL_STATUS_MAX_MESSAGE_BYTES;
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
        if (process.platform !== 'win32') {
          chmodSync(this.socketPath, 0o600);
        }
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
      if (Buffer.byteLength(buffer, 'utf8') > this.maxMessageBytes) {
        writeResponse(socket, { ok: false, error: 'message too large' });
        socket.end();
        return;
      }

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            const request = JSON.parse(line) as unknown;
            if (!isValidRequest(request)) {
              writeResponse(socket, { ok: false, error: 'invalid request' });
            } else {
              writeResponse(socket, handleRequest(request, this.authToken));
            }
          } catch (error) {
            writeResponse(socket, {
              ok: false,
              error: error instanceof SyntaxError ? 'malformed JSON' : String(error || ''),
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

export function getLocalStatusServerAuthToken(): string | null {
  return localStatusServer?.authToken ?? null;
}

export async function stopLocalStatusServer(): Promise<void> {
  await localStatusServer?.stop();
  localStatusServer = null;
}
