import { createServer as createNetServer, type AddressInfo, type Server, type Socket } from 'net';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'http';
import { chmodSync, existsSync, unlinkSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';

import { getStatusService } from './status-service';

export const DEFAULT_LOCAL_STATUS_MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * Preferred TCP port for the loopback HTTP transport. Arbitrary unregistered
 * port in the dynamic range; collisions are handled by bounded incrementing
 * retries plus a final OS-assigned fallback (see `startHttp`).
 */
export const DEFAULT_LOCAL_STATUS_HTTP_PORT = 47832;
export const MAX_LOCAL_STATUS_HTTP_PORT_ATTEMPTS = 10;

/** The HTTP transport must never bind to anything except IPv4 loopback. */
const LOOPBACK_BIND_ADDRESS = '127.0.0.1';

/**
 * DNS-rebinding defense for the HTTP transport: browsers can be made to send
 * requests to a name that resolves to 127.0.0.1, but the Host header then
 * carries the attacker's hostname, not a literal loopback origin.
 */
const ALLOWED_HTTP_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export const LOCAL_STATUS_INFO_IPC_CHANNEL = 'status:local-server-info';

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
  /** Preferred port for the loopback HTTP listener. */
  httpPort?: number;
  /** Bounded EADDRINUSE retry attempts before falling back to an ephemeral port. */
  httpPortAttempts?: number;
}

/** Discovery payload for the loopback HTTP transport (port + bearer token). */
export interface LocalStatusHttpInfo {
  port: number;
  token: string;
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

function isEaddrInuse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE';
}

/**
 * Request handling is transport-agnostic: each transport authenticates on its
 * own terms (Unix socket/named pipe: token field in the JSON payload; HTTP:
 * `Authorization: Bearer` header) and then dispatches here.
 */
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
    default:
      return { id: request.id, ok: false, error: 'unsupported request type' };
  }
}

class HttpJsonError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export class LocalStatusServer {
  private server: Server | null = null;
  private httpServer: HttpServer | null = null;
  private boundHttpPort: number | null = null;
  readonly socketPath: string;
  readonly authToken: string;
  private readonly maxMessageBytes: number;
  private readonly preferredHttpPort: number;
  private readonly httpPortAttempts: number;

  constructor(options: LocalStatusServerOptions) {
    this.socketPath = options.socketPath ?? getDefaultLocalStatusSocketPath(options.userDataPath);
    this.authToken = options.authToken ?? generateAuthToken();
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_LOCAL_STATUS_MAX_MESSAGE_BYTES;
    this.preferredHttpPort = options.httpPort ?? DEFAULT_LOCAL_STATUS_HTTP_PORT;
    this.httpPortAttempts = Math.max(
      1,
      Math.min(
        options.httpPortAttempts ?? MAX_LOCAL_STATUS_HTTP_PORT_ATTEMPTS,
        MAX_LOCAL_STATUS_HTTP_PORT_ATTEMPTS
      )
    );
  }

  /** Port the loopback HTTP listener actually bound to, once started. */
  get httpPort(): number | null {
    return this.boundHttpPort;
  }

  async start(): Promise<void> {
    if (this.server) return;

    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    const server = createNetServer((socket) => this.handleConnection(socket));
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const handleStartupError = (error: Error) => reject(error);
        server.once('error', handleStartupError);
        server.listen(this.socketPath, () => {
          server.off('error', handleStartupError);
          try {
            if (process.platform !== 'win32') {
              chmodSync(this.socketPath, 0o600);
            }
            server.on('error', this.handleServerError);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      await this.stopSocket(server);
      throw error;
    }

    try {
      await this.startHttp();
    } catch (error) {
      await this.stopSocket(server);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const socketServer = this.server;
    this.server = null;
    await this.stopSocket(socketServer);

    const httpServer = this.httpServer;
    this.httpServer = null;
    this.boundHttpPort = null;
    if (httpServer?.listening) {
      httpServer.removeListener('error', this.handleServerError);
      // Keep-alive sockets would otherwise hold close() open indefinitely.
      httpServer.closeIdleConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  private async stopSocket(socketServer: Server | null): Promise<void> {
    if (!socketServer) return;

    socketServer.removeListener('error', this.handleServerError);
    if (socketServer.listening) {
      await new Promise<void>((resolve) => socketServer.close(() => resolve()));
    }
    if (this.server === socketServer) {
      this.server = null;
    }
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }

  /**
   * Binds the HTTP listener strictly to 127.0.0.1. On EADDRINUSE the port is
   * incremented for a bounded number of attempts, then the final attempt asks
   * the OS for an ephemeral port. The chosen port is exposed via `httpPort`.
   */
  private async startHttp(): Promise<void> {
    if (this.httpServer) return;

    if (this.preferredHttpPort === 0) {
      await this.listenHttp(0);
      return;
    }

    for (let attempt = 0; attempt < this.httpPortAttempts; attempt++) {
      try {
        await this.listenHttp(this.preferredHttpPort + attempt);
        return;
      } catch (error) {
        if (!isEaddrInuse(error)) throw error;
      }
    }

    await this.listenHttp(0);
  }

  private listenHttp(port: number): Promise<void> {
    const httpServer = createHttpServer((request, response) => this.handleHttpRequest(request, response));

    return new Promise<void>((resolve, reject) => {
      const handleStartupError = (error: Error) => {
        httpServer.off('error', handleStartupError);
        reject(error);
      };
      httpServer.once('error', handleStartupError);
      httpServer.listen(port, LOOPBACK_BIND_ADDRESS, () => {
        httpServer.off('error', handleStartupError);
        this.httpServer = httpServer;
        this.boundHttpPort = (httpServer.address() as AddressInfo).port;
        httpServer.on('error', this.handleServerError);
        resolve();
      });
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, body: LocalStatusResponse): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(statusCode === 401 ? { 'WWW-Authenticate': 'Bearer realm="shellysvn-status"' } : {}),
      ...(statusCode === 413 ? { Connection: 'close' } : {}),
    });
    response.end(JSON.stringify(body));
  }

  /** Bearer-token check applied to every HTTP request regardless of route. */
  private isAuthorizedHttp(authorization: string | undefined): boolean {
    if (typeof authorization !== 'string') return false;
    const match = /^Bearer\s+(.+)$/.exec(authorization.trim());
    return match !== null && isExpectedToken(match[1], this.authToken);
  }

  private handleHttpRequest(request: IncomingMessage, response: ServerResponse): void {
    try {
      this.routeHttpRequest(request, response);
    } catch (error) {
      if (!response.headersSent) {
        this.sendJson(response, 500, { ok: false, error: 'internal error' });
      }
      if (!(error instanceof HttpJsonError)) {
        console.error(
          '[local-status-server] HTTP handler error:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private routeHttpRequest(request: IncomingMessage, response: ServerResponse): void {
    // DNS-rebinding / cross-site defense: the Host must be a literal loopback
    // origin, and browser-initiated cross-site requests (which carry Origin or
    // Referer) are refused outright.
    const host = request.headers.host;
    if (typeof host !== 'string' || !ALLOWED_HTTP_HOST_PATTERN.test(host)) {
      this.sendJson(response, 403, { ok: false, error: 'forbidden host' });
      return;
    }
    if (request.headers.origin !== undefined || request.headers.referer !== undefined) {
      this.sendJson(response, 403, { ok: false, error: 'cross-site requests are not allowed' });
      return;
    }

    if (!this.isAuthorizedHttp(request.headers.authorization)) {
      this.sendJson(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

    if (pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        this.sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      this.sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === '/status') {
      if (request.method !== 'POST') {
        this.sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      this.handleStatusPost(request, response);
      return;
    }

    this.sendJson(response, 404, { ok: false, error: 'not found' });
  }

  private handleStatusPost(request: IncomingMessage, response: ServerResponse): void {
    this.readJsonBody(request)
      .then((body) => {
        if (!isValidRequest(body)) {
          this.sendJson(response, 400, { ok: false, error: 'invalid request' });
          return;
        }
        this.sendJson(response, 200, handleRequest(body));
      })
      .catch((error: unknown) => {
        if (!response.headersSent) {
          if (error instanceof HttpJsonError) {
            this.sendJson(response, error.statusCode, { ok: false, error: error.message });
          } else {
            this.sendJson(response, 500, { ok: false, error: 'internal error' });
          }
        }
        if (!(error instanceof HttpJsonError)) {
          console.error(
            '[local-status-server] HTTP handler error:',
            error instanceof Error ? error.message : String(error)
          );
        }
      });
  }

  private readJsonBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxMessageBytes) {
          // Stop buffering and drain the remainder so the 413 response can be
          // written and flushed before the connection is closed.
          request.removeAllListeners('data');
          request.removeAllListeners('end');
          request.resume();
          reject(new HttpJsonError(413, 'message too large'));
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpJsonError(400, 'malformed JSON'));
        }
      });
      request.on('error', (error) => reject(error));
    });
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('error', (error) => {
      console.warn('[local-status-server] Socket error:', error.message);
    });

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
            } else if (!isExpectedToken(request.token, this.authToken)) {
              writeResponse(socket, { id: request.id, ok: false, error: 'unauthorized' });
            } else {
              writeResponse(socket, handleRequest(request));
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

  private readonly handleServerError = (error: Error): void => {
    console.error('[local-status-server] Server error:', error);
  };
}

let localStatusServer: LocalStatusServer | null = null;

export async function startLocalStatusServer(userDataPath: string): Promise<LocalStatusServer> {
  const server = localStatusServer ?? new LocalStatusServer({ userDataPath });
  localStatusServer = server;
  try {
    await server.start();
    await registerLocalStatusInfoChannel();
    return server;
  } catch (error) {
    if (localStatusServer === server) {
      localStatusServer = null;
    }
    throw error;
  }
}

export function getLocalStatusServerAuthToken(): string | null {
  return localStatusServer?.authToken ?? null;
}

/** Loopback HTTP discovery: the bound port plus the per-session bearer token. */
export function getLocalStatusServerHttpInfo(): LocalStatusHttpInfo | null {
  const server = localStatusServer;
  return server?.httpPort != null ? { port: server.httpPort, token: server.authToken } : null;
}

export async function stopLocalStatusServer(): Promise<void> {
  await localStatusServer?.stop();
  localStatusServer = null;
}

let localStatusInfoChannelRegistered = false;

/**
 * Exposes `{ port, token }` to the renderer over a typed IPC channel so HTTP
 * consumers can discover the loopback endpoint without polling. Electron is
 * imported lazily and shape-checked: outside the packaged app (unit tests,
 * CLI) the import yields no `ipcMain` and registration is skipped silently.
 */
async function registerLocalStatusInfoChannel(): Promise<void> {
  if (localStatusInfoChannelRegistered) return;

  try {
    const electron = (await import('electron')) as unknown as {
      ipcMain?: { handle?: (channel: string, handler: () => unknown) => void };
    };
    if (typeof electron?.ipcMain?.handle !== 'function') return;

    electron.ipcMain.handle(LOCAL_STATUS_INFO_IPC_CHANNEL, () => getLocalStatusServerHttpInfo());
    localStatusInfoChannelRegistered = true;
  } catch {
    // Electron unavailable — the channel only matters inside the app.
  }
}
