import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStreamEvent, AppSettings } from '@shared/types';
import type { SafeStorage } from 'electron';

/**
 * End-to-end streaming verification (#114d): a full commit-message generation
 * through the real service path (settings -> diff -> prompt -> guard ->
 * provider stream) with a fake OpenAI-compatible server, proving that
 * ai:stream events flow and ai:cancel aborts mid-stream.
 */

const state = vi.hoisted(() => ({
  userData: '/tmp/shelly-ai-stream-test',
  aiSettings: {
    enabled: true,
    provider: 'openai-compatible',
    codexModel: 'gpt-5.6-luna',
    style: 'concise',
    includeRecentHistory: false,
    historyLimit: 10,
    maxDiffBytes: 262_144,
    confirmBeforeSending: true,
    providerTimeoutMs: 10_000,
    maxSessionInvocations: 100,
    usageRetentionDays: 30,
    usageMaxEntries: 200,
  } as AppSettings['aiCommit'],
}));

const fakeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (text: string) => Buffer.from(`enc(${text})`),
  decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4, -1),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => state.userData) },
  safeStorage: fakeStorage,
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: async () => undefined,
    get: (key: string) => (key === 'aiCommit' ? state.aiSettings : {}),
  }),
}));

const DIFF = vi.hoisted(() =>
  ['Index: src/app.ts', '--- src/app.ts', '+++ src/app.ts', '+const ready = true;', ''].join('\n')
);

vi.mock('../svn-executor', () => ({ runSvnText: vi.fn(async () => DIFF) }));

import {
  cancelAiCommitMessage,
  generateAiCommitMessage,
} from '../ai-commit-message';
import { AiCredentialsStore, setAiCredentialsStoreForTests } from '../ai-credentials';
import { setProviderFetchForTests } from '../ai-providers/http-client';
import { setAiStreamListener } from '../ai-providers/stream-emitter';
import type { ProviderFetch } from '../ai-providers/types';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';

/** Stream the JSON answer in small SSE chunks with delays, honoring abort. */
function sseFetchFor(chunks: string[], delayMs: number): ProviderFetch {
  const encoder = new TextEncoder();
  return ((_input, init) => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let aborted = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    init?.signal?.addEventListener(
      'abort',
      () => {
        aborted = true;
        try {
          streamController?.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // Already closed.
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
          // Already errored.
        }
      }
    })();
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
  }) as ProviderFetch;
}

function chunked(answer: string, pieces: number): string[] {
  const size = Math.max(1, Math.ceil(answer.length / pieces));
  const parts: string[] = [];
  for (let index = 0; index < answer.length; index += size) {
    parts.push(answer.slice(index, index + size));
  }
  return parts.map(
    (part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`
  );
}

describe('AI streaming over IPC-shaped events (#109, #114d)', () => {
  let directory = '';
  let events: AiStreamEvent[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shelly-ai-stream-'));
    state.userData = directory;
    clearApprovedPathsForTests();
    approvePathForIpc(directory);
    events = [];
    setAiStreamListener((event) => events.push(event));
    const store = new AiCredentialsStore(directory, fakeStorage as unknown as SafeStorage);
    await store.saveProviderCredential({
      provider: 'openai-compatible',
      apiKey: 'stream-test-key',
      baseUrl: 'http://127.0.0.1:9/v1',
    });
    setAiCredentialsStoreForTests(store);
  });

  afterEach(async () => {
    setAiStreamListener(undefined);
    setAiCredentialsStoreForTests(undefined);
    setProviderFetchForTests(undefined);
    clearApprovedPathsForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it('streams deltas keyed by operationId and finishes with a done event', async () => {
    setProviderFetchForTests(
      sseFetchFor(chunked('{"subject":"Fix status cache","body":""}', 4), 5)
    );
    const result = await generateAiCommitMessage({
      operationId: 'stream-ok-1',
      workingCopyPath: directory,
      paths: [join(directory, 'src/app.ts')],
    });

    expect(result.message).toBe('Fix status cache');
    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('gpt-4o-mini');
    const deltas = events.filter((event) => typeof event.delta === 'string');
    expect(deltas.map((event) => event.delta).join('')).toBe('{"subject":"Fix status cache","body":""}');
    expect(events.every((event) => event.operationId === 'stream-ok-1')).toBe(true);
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ operationId: 'stream-ok-1', done: true });
    expect(terminal.error).toBeUndefined();
  });

  it('honors ai:cancel mid-stream and emits a cancelled terminal event', async () => {
    setProviderFetchForTests(
      sseFetchFor(chunked('{"subject":"Never finishing","body":""}', 6), 40)
    );
    const generation = generateAiCommitMessage(
      { operationId: 'stream-cancel-1', workingCopyPath: directory, paths: [join(directory, 'src/app.ts')] },
      99
    );
    await vi.waitFor(
      () => {
        if (!events.some((event) => typeof event.delta === 'string')) {
          throw new Error('no delta yet');
        }
      },
      { timeout: 3_000, interval: 10 }
    );
    const cancelled = await cancelAiCommitMessage('stream-cancel-1', 99);
    expect(cancelled).toBe(true);
    await expect(generation).rejects.toThrow(/\[cancelled\]/);
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ operationId: 'stream-cancel-1', done: true });
    expect(terminal.errorCode).toBe('cancelled');
    const deltaCount = events.filter((event) => typeof event.delta === 'string').length;
    expect(deltaCount).toBeLessThan(6);
  });

  it('blocks the request before any provider call when the prompt contains secrets', async () => {
    setProviderFetchForTests(((_input, _init) => {
      throw new Error('provider must not be called');
    }) as ProviderFetch);
    const secretDiff = DIFF + '+deploy_key = AKIAIOSFODNN7EXAMPLE\n';
    const { runSvnText } = await import('../svn-executor');
    vi.mocked(runSvnText).mockImplementation(async () => secretDiff);
    try {
      await expect(
        generateAiCommitMessage({
          operationId: 'stream-secret-1',
          workingCopyPath: directory,
          paths: [join(directory, 'src/app.ts')],
        })
      ).rejects.toThrow(/\[secret_detected\]/);
      const terminal = events[events.length - 1];
      expect(terminal).toMatchObject({ operationId: 'stream-secret-1', done: true });
      expect(terminal.errorCode).toBe('secret_detected');
    } finally {
      vi.mocked(runSvnText).mockImplementation(async () => DIFF);
    }
  });
});
