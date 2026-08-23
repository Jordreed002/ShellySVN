import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callHttpProvider,
  setProviderFetchForTests,
  streamHttpProvider,
} from '../ai-providers/http-client';
import { anthropicSseSemantics } from '../ai-providers/anthropic';
import { openAiChatSseSemantics } from '../ai-providers/openai-chat';
import type { ProviderFetch } from '../ai-providers/types';
import {
  describeProviderRequestSafely,
  redactDiagnosticsText,
  redactSensitiveHeaders,
} from '../ai-providers/redact';

const API_KEY = 'sk-ant-api03-super-secret-value-DO-NOT-LEAK';

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** SSE response whose chunks arrive with delay and abort like a real fetch body. */
function sseResponse(chunks: string[], delayMs: number, abortSignal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let aborted = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  abortSignal?.addEventListener(
    'abort',
    () => {
      aborted = true;
      try {
        streamController?.error(new DOMException('Aborted', 'AbortError'));
      } catch {
        // Stream already closed.
      }
    },
    { once: true }
  );
  void (async () => {
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (aborted) return;
      try {
        streamController?.enqueue(encoder.encode(chunk));
      } catch {
        return;
      }
    }
    if (!aborted) {
      try {
        streamController?.close();
      } catch {
        // Stream already errored by an abort.
      }
    }
  })();
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function sseFetch(chunks: string[], delayMs = 5): ProviderFetch {
  return ((_input, init) =>
    Promise.resolve(sseResponse(chunks, delayMs, init?.signal))) as ProviderFetch;
}

afterEach(() => {
  setProviderFetchForTests(undefined);
});

describe('provider SSE streaming', () => {
  it('parses Anthropic content_block_delta events into deltas and full text', async () => {
    setProviderFetchForTests(
      sseFetch([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"Fix "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"cache"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ])
    );
    const deltas: string[] = [];
    const text = await streamHttpProvider({
      request: {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: { 'x-api-key': API_KEY },
      },
      timeoutMs: 5_000,
      sse: anthropicSseSemantics,
      onDelta: (delta) => deltas.push(delta),
      secrets: [API_KEY],
    });
    expect(deltas).toEqual(['Fix ', 'cache']);
    expect(text).toBe('Fix cache');
  });

  it('parses OpenAI-compatible chat chunks and ignores [DONE]', async () => {
    setProviderFetchForTests(
      sseFetch([
        'data: {"choices":[{"delta":{"content":"Group "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"paths"}}]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const deltas: string[] = [];
    const text = await streamHttpProvider({
      request: { url: 'http://127.0.0.1:11434/v1/chat/completions', method: 'POST', headers: {} },
      timeoutMs: 5_000,
      sse: openAiChatSseSemantics,
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(['Group ', 'paths']);
    expect(text).toBe('Group paths');
  });

  it('handles SSE events split across chunk boundaries', async () => {
    setProviderFetchForTests(
      sseFetch(['data: {"choices":[{"delta":{"content":"He', 'llo"}}]}\n\ndata: [DONE]\n\n'])
    );
    const text = await streamHttpProvider({
      request: { url: 'http://127.0.0.1:11434/v1/chat/completions', method: 'POST', headers: {} },
      timeoutMs: 5_000,
      sse: openAiChatSseSemantics,
      onDelta: () => undefined,
    });
    expect(text).toBe('Hello');
  });

  it('surfaces provider SSE error events as safe errors', async () => {
    setProviderFetchForTests(sseFetch(['data: {"type":"error","error":{"message":"rate limited"}}\n\n']));
    await expect(
      streamHttpProvider({
        request: { url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {} },
        timeoutMs: 5_000,
        sse: anthropicSseSemantics,
        onDelta: () => undefined,
      })
    ).rejects.toThrow(/rate limited/);
  });

  it('retries retryable pre-stream failures and then succeeds', async () => {
    let calls = 0;
    setProviderFetchForTests((async () => {
      calls += 1;
      if (calls <= 2) return textResponse('temporary failure', 503);
      return textResponse('{"ok":true}', 200);
    }) as ProviderFetch);
    const result = await callHttpProvider({
      request: { url: 'https://example.invalid/v1/chat/completions', method: 'POST', headers: {} },
      timeoutMs: 5_000,
      retries: 2,
    });
    expect(calls).toBe(3);
    expect(result.status).toBe(200);
  });

  it('does not retry non-retryable failures', async () => {
    let calls = 0;
    setProviderFetchForTests((async () => {
      calls += 1;
      return textResponse('invalid api key provided', 401);
    }) as ProviderFetch);
    await expect(
      callHttpProvider({
        request: {
          url: 'https://example.invalid/v1/chat/completions',
          method: 'POST',
          headers: { authorization: `Bearer ${API_KEY}` },
        },
        timeoutMs: 5_000,
        retries: 2,
        secrets: [API_KEY],
      })
    ).rejects.toThrow(/status 401/);
    expect(calls).toBe(1);
  });

  it('honors cancellation mid-stream through the external AbortSignal', async () => {
    const external = new AbortController();
    setProviderFetchForTests(
      sseFetch(
        [
          'data: {"choices":[{"delta":{"content":"one"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"two"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"three"}}]}\n\n',
        ],
        15
      )
    );
    const deltas: string[] = [];
    const attempt = streamHttpProvider({
      request: { url: 'http://127.0.0.1:11434/v1/chat/completions', method: 'POST', headers: {} },
      timeoutMs: 10_000,
      signal: external.signal,
      sse: openAiChatSseSemantics,
      onDelta: (delta) => {
        deltas.push(delta);
        if (deltas.length === 1) external.abort();
      },
    });
    await expect(attempt).rejects.toThrow(/cancelled/);
    expect(deltas).toEqual(['one']);
  });

  it('fails with a timeout error when the server never answers in time', async () => {
    setProviderFetchForTests(
      sseFetch(['data: {"choices":[{"delta":{"content":"slow"}}]}\n\n'], 400)
    );
    await expect(
      streamHttpProvider({
        request: { url: 'http://127.0.0.1:11434/v1/chat/completions', method: 'POST', headers: {} },
        timeoutMs: 100,
        retries: 0,
        sse: openAiChatSseSemantics,
        onDelta: () => undefined,
      })
    ).rejects.toThrow(/timed out/);
  });
});

describe('provider diagnostics redaction (#20, #114b)', () => {
  it('never places Authorization headers or key material in error messages or logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setProviderFetchForTests(
      (async () => textResponse(`Bearer ${API_KEY} rejected`, 500)) as ProviderFetch
    );
    try {
      const thrown = await callHttpProvider({
        request: {
          url: 'https://api.example.com/v1/chat/completions',
          method: 'POST',
          headers: { authorization: `Bearer ${API_KEY}`, 'x-api-key': API_KEY },
        },
        timeoutMs: 5_000,
        retries: 0,
        secrets: [API_KEY],
      }).then(
        () => '',
        (error: Error) => error.message
      );
      expect(thrown).toMatch(/status 500/);
      expect(thrown).not.toContain(API_KEY);
      expect(thrown).not.toContain(`Bearer ${API_KEY}`);
      for (const call of [...consoleError.mock.calls, ...consoleLog.mock.calls].flat()) {
        expect(String(call)).not.toContain(API_KEY);
      }
    } finally {
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('masks sensitive header values and raw key material in diagnostics helpers', () => {
    expect(
      redactSensitiveHeaders({
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      })
    ).toEqual({
      authorization: '[REDACTED]',
      'content-type': 'application/json',
    });
    const description = describeProviderRequestSafely(
      'https://api.example.com/v1/x?api-key=hidden123',
      { authorization: `Bearer ${API_KEY}` },
      [API_KEY]
    );
    expect(description).not.toContain(API_KEY);
    expect(description).not.toContain('hidden123');
    expect(description).toContain('[REDACTED]');
    expect(redactDiagnosticsText(`Authorization: Bearer ${API_KEY}`, [API_KEY])).not.toContain(API_KEY);
  });
});
