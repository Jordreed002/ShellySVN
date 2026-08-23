import type { ProviderFetch, ProviderHttpRequest } from './types';
import { redactDiagnosticsText } from './redact';

/**
 * Shared HTTP transport for AI providers.
 *
 * - global fetch only (no new dependencies)
 * - bounded timeout, bounded retry with backoff (pre-stream failures only)
 * - external AbortSignal honored mid-stream (the abort/timeout wiring stays
 *   alive until the response body has been fully consumed)
 * - hand-rolled SSE parsing (`data:` lines separated by blank lines)
 * - every error path is redacted: no Authorization headers, no key material,
 *   and no prompt bodies ever appear in thrown messages
 */

export class HttpProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpProviderError';
    this.status = status;
  }
}

/** How a parsed SSE `data:` payload contributes to the assistant text. */
export interface SseEventSemantics {
  /** Extract the text delta from one parsed SSE JSON payload (if any). */
  extractDelta(payload: unknown): string | undefined;
  /** Return a safe error message when the payload is a provider error event. */
  extractError(payload: unknown): string | undefined;
}

export interface HttpCallOptions {
  request: ProviderHttpRequest;
  timeoutMs: number;
  /** Operation cancellation; aborts the in-flight request and stream. */
  signal?: AbortSignal;
  /** Extra retries after the first attempt for retryable failures (default 1, max 3). */
  retries?: number;
  /** Key material that must never surface in error messages. */
  secrets?: readonly string[];
}

export interface HttpStreamOptions extends HttpCallOptions {
  sse: SseEventSemantics;
  onDelta: (delta: string) => void;
}

const MAX_ERROR_BODY_EXCERPT = 300;
const DEFAULT_RETRIES = 1;
const RETRY_BACKOFF_MS = 250;
const TIMEOUT_REASON = '__shellysvn_timeout__';
const CANCEL_REASON = '__shellysvn_cancelled__';

let providerFetch: ProviderFetch = (input, init) => globalThis.fetch(input, init);

/** Test seam: serve canned responses without touching the network. */
export function setProviderFetchForTests(fetchImpl: ProviderFetch | undefined): void {
  providerFetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
}

function cancelledError(): Error {
  return new Error('AI provider request was cancelled.');
}

function timeoutError(timeoutMs: number): Error {
  return new HttpProviderError(`AI provider timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

function safeExcerpt(body: string, secrets: readonly string[]): string {
  const excerpt = body.slice(0, MAX_ERROR_BODY_EXCERPT).replace(/\s+/g, ' ').trim();
  return redactDiagnosticsText(excerpt, secrets);
}

function statusError(status: number, body: string, secrets: readonly string[]): HttpProviderError {
  return new HttpProviderError(
    `AI provider HTTP request failed with status ${status}. ${safeExcerpt(body, secrets)}`.trim(),
    status
  );
}

function connectError(errorText: string, secrets: readonly string[]): HttpProviderError {
  return new HttpProviderError(
    `AI provider could not connect (${redactDiagnosticsText(errorText, secrets)}).`.trim()
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface AttemptOutcome {
  response?: Response;
  retryable?: boolean;
  status?: number;
  errorText?: string;
}

interface AttemptHandle {
  promise: Promise<AttemptOutcome>;
  /** Release the timeout + cancellation wiring once the body is consumed. */
  dispose: () => void;
}

/**
 * Start one fetch attempt. The internal AbortController combines the timeout
 * and the external cancellation signal; its wiring deliberately outlives the
 * fetch promise so aborting still errors a slowly-streaming response body.
 */
function startAttempt(options: HttpCallOptions): AttemptHandle {
  const { request, timeoutMs, signal } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(TIMEOUT_REASON)), timeoutMs);
  const forwardAbort = () => controller.abort(new Error(CANCEL_REASON));
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const promise = (async (): Promise<AttemptOutcome> => {
    try {
      const response = await providerFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      if (!response.ok && isRetryableStatus(response.status)) {
        const errorText = await response.text().catch(() => '');
        return { retryable: true, status: response.status, errorText };
      }
      return { response };
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      const reason: unknown = controller.signal.reason;
      if (reason instanceof Error && reason.message === TIMEOUT_REASON) throw timeoutError(timeoutMs);
      if (reason instanceof Error && reason.message === CANCEL_REASON) throw cancelledError();
      // fetch() rejects with TypeError on network/DNS/TLS failures.
      return {
        retryable: true,
        errorText: error instanceof Error ? error.message : 'network error',
      };
    }
  })();
  return {
    promise,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    },
  };
}

/**
 * Execute a provider request with bounded retries for retryable pre-stream
 * failures and return the full response body text. Non-2xx responses throw.
 */
export async function callHttpProvider(
  options: HttpCallOptions
): Promise<{ status: number; body: string }> {
  const retries = Math.max(0, Math.min(options.retries ?? DEFAULT_RETRIES, 3));
  let lastStatus = 0;
  let lastErrorText = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt, options.signal);
    const handle = startAttempt(options);
    let outcome: AttemptOutcome;
    try {
      outcome = await handle.promise;
      if (outcome.response) {
        const body = await outcome.response.text().catch(() => '');
        if (!outcome.response.ok) {
          throw statusError(outcome.response.status, body, options.secrets ?? []);
        }
        return { status: outcome.response.status, body };
      }
    } finally {
      handle.dispose();
    }
    lastStatus = outcome!.status ?? 0;
    lastErrorText = outcome!.errorText ?? '';
  }
  if (lastStatus > 0) throw statusError(lastStatus, lastErrorText, options.secrets ?? []);
  throw connectError(lastErrorText || 'no response', options.secrets ?? []);
}

/**
 * Execute a streaming (SSE) provider request. Deltas are forwarded to
 * `onDelta` as they arrive; the full accumulated text is returned. Retrying
 * stops at the first emitted delta so partial answers are never duplicated.
 */
export async function streamHttpProvider(options: HttpStreamOptions): Promise<string> {
  const retries = Math.max(0, Math.min(options.retries ?? DEFAULT_RETRIES, 3));
  let deltasEmitted = false;
  let lastStatus = 0;
  let lastErrorText = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt, options.signal);
    const handle = startAttempt(options);
    let outcome: AttemptOutcome;
    try {
      outcome = await handle.promise;
      if (!outcome.response) {
        lastStatus = outcome.status ?? 0;
        lastErrorText = outcome.errorText ?? '';
        continue;
      }
      const response = outcome.response;
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw statusError(response.status, errorBody, options.secrets ?? []);
      }
      const context: StreamContext = {
        sse: options.sse,
        onDelta: options.onDelta,
        secrets: options.secrets ?? [],
        markEmitted: () => {
          deltasEmitted = true;
        },
      };
      const hasEmitted = () => deltasEmitted;
      if (!response.body) {
        // Server ignored the stream request; parse the full body as SSE text.
        const body = await response.text().catch(() => '');
        return consumeSseBody(body, context);
      }
      return await consumeSseStream(response.body, context, options, hasEmitted);
    } catch (error) {
      if (!(error instanceof RetryableStreamError)) throw error;
      lastStatus = 0;
      lastErrorText = error.message;
    } finally {
      handle.dispose();
    }
  }
  if (lastStatus > 0) throw statusError(lastStatus, lastErrorText, options.secrets ?? []);
  throw connectError(lastErrorText || 'no response', options.secrets ?? []);
}

interface StreamContext {
  sse: SseEventSemantics;
  onDelta: (delta: string) => void;
  secrets: readonly string[];
  markEmitted: () => void;
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  context: StreamContext,
  options: HttpStreamOptions,
  hasEmitted: () => boolean
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) break;
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        accumulated = applySseEvent(rawEvent, accumulated, context);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) accumulated = applySseEvent(buffer, accumulated, context);
    return accumulated;
  } catch (error) {
    if (options.signal?.aborted) throw cancelledError();
    if (error instanceof HttpProviderError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw timeoutError(options.timeoutMs);
    }
    if (hasEmitted()) {
      // Never retry after partial output; surface a safe stream failure.
      throw new HttpProviderError('AI provider stream ended unexpectedly.');
    }
    // No output yet: let the caller retry the attempt.
    throw new RetryableStreamError(error instanceof Error ? error.message : 'stream error');
  }
}

class RetryableStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableStreamError';
  }
}

function consumeSseBody(body: string, context: StreamContext): string {
  let accumulated = '';
  for (const rawEvent of body.split('\n\n')) {
    accumulated = applySseEvent(rawEvent, accumulated, context);
  }
  return accumulated;
}

function applySseEvent(rawEvent: string, accumulated: string, context: StreamContext): string {
  const data = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return accumulated;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return accumulated;
  }
  const streamError = context.sse.extractError(payload);
  if (streamError) throw new HttpProviderError(safeExcerpt(streamError, context.secrets));
  const delta = context.sse.extractDelta(payload);
  if (typeof delta === 'string' && delta.length > 0) {
    context.markEmitted();
    context.onDelta(delta);
    return accumulated + delta;
  }
  return accumulated;
}
