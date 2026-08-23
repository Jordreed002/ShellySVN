// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types';
import type { SafeStorage } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiCommitOutputSchema,
  aiCommitPlanOutputSchema,
  aiConflictProposalOutputSchema,
  aiDiffExplanationOutputSchema,
  aiReleaseNotesOutputSchema,
  aiReviewOutputSchema,
  buildAiProviderArguments,
  formatAiProviderExitError,
  classifyAiProviderError,
  getWindowsNpmShimScriptCandidate,
  parseClaudeAuthStatus,
  parseAiCommitMessageOutput,
  parseAiStructuredOutput,
  prepareDiffForAi,
} from '../ai-commit-message-utils';
import {
  estimateAiCostForRequest,
  generateAiCommitMessage,
  getAiCommitProviders,
  listAiProviderModels,
} from '../ai-commit-message';
import { AiCredentialsStore, setAiCredentialsStoreForTests } from '../ai-credentials';
import { setProviderFetchForTests } from '../ai-providers/http-client';
import type { ProviderFetch } from '../ai-providers/types';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';

const customState = vi.hoisted(() => ({
  userData: '/tmp/shelly-ai-custom-test',
  aiSettings: {
    enabled: true,
    provider: 'auto',
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

const DIFF = vi.hoisted(() =>
  ['Index: src/app.ts', '--- src/app.ts', '+++ src/app.ts', '+const ready = true;', ''].join('\n')
);

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => customState.userData) },
  safeStorage: fakeStorage,
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: async () => undefined,
    get: (key: string) => (key === 'aiCommit' ? customState.aiSettings : {}),
  }),
}));

vi.mock('../svn-executor', () => ({ runSvnText: vi.fn(async () => DIFF) }));

// Deterministic CLI probing: machine-installed codex/claude binaries and
// ambient credential environment variables must never influence selection.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 1 })),
  };
});

function sseFetch(body: string): ProviderFetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as ProviderFetch;
}

function openAiSse(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function anthropicSse(text: string): string {
  return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`;
}

describe('AI commit-message diff preparation', () => {
  it('reads only safe Claude CLI authentication status fields', () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'private@example.com',
          organizationName: 'Private org',
        })
      )
    ).toEqual({ loggedIn: true, authMethod: 'claude.ai' });
    expect(parseClaudeAuthStatus('not json')).toEqual({ loggedIn: false });
  });

  it('requires every structured-output property while allowing an empty body', () => {
    expect(aiCommitOutputSchema()).toMatchObject({
      required: ['subject', 'body'],
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
    });
  });

  it('defines strict structured schemas for every SVN assistant workflow', () => {
    for (const schema of [
      aiReviewOutputSchema(),
      aiCommitPlanOutputSchema(),
      aiDiffExplanationOutputSchema(),
      aiReleaseNotesOutputSchema(),
      aiConflictProposalOutputSchema(),
    ]) {
      expect(schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
  });

  it('parses direct and Claude-wrapped structured task results', () => {
    expect(parseAiStructuredOutput('{"summary":"Safe to review","findings":[]}')).toEqual({
      summary: 'Safe to review',
      findings: [],
    });
    expect(
      parseAiStructuredOutput(
        JSON.stringify({ structured_output: { title: 'Release', technical: ['Cache fix'] } })
      )
    ).toEqual({ title: 'Release', technical: ['Cache fix'] });
  });

  it('classifies provider failures without returning stderr or prompt content', () => {
    const stderr = 'user\nprivate source diff\nERROR: {"code":"invalid_json_schema"}';
    const message = formatAiProviderExitError('codex', 1, stderr);

    expect(message).toBe('Codex rejected the commit-message output schema.');
    expect(message).not.toContain('private source diff');
  });

  it('maps provider failures to stable safe error codes', () => {
    expect(classifyAiProviderError('Unauthorized: API key missing')).toBe(
      'authentication_required'
    );
    expect(classifyAiProviderError('rate_limit quota reached')).toBe('quota_exceeded');
    expect(classifyAiProviderError('provider timed out')).toBe('timeout');
    expect(classifyAiProviderError('invalid JSON returned')).toBe('invalid_output');
  });

  it('redacts common credentials before a diff leaves the process', () => {
    const result = prepareDiffForAi(
      'Index: config.env\n--- config.env\n+++ config.env\n+api_key=sk-example-secret-token-123456\n+password="hunter2"\n',
      64 * 1024
    );

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('sk-example-secret-token-123456');
    expect(result.text).toContain('[REDACTED]');
  });

  it('omits binary sections while retaining selected text changes', () => {
    const result = prepareDiffForAi(
      [
        'Index: src/app.ts\n--- src/app.ts\n+++ src/app.ts\n+const ready = true;\n',
        'Index: assets/logo.png\nCannot display: file marked as a binary type.\n',
      ].join(''),
      64 * 1024
    );

    expect(result.text).toContain('const ready = true');
    expect(result.text).not.toContain('Cannot display');
    expect(result.omittedBinaryFiles).toEqual(['assets/logo.png']);
  });

  it('caps UTF-8 diff bytes without leaving a replacement character', () => {
    const result = prepareDiffForAi(`Index: file.txt\n${'é'.repeat(100)}`, 31);

    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(31);
    expect(result.text).not.toContain('\uFFFD');
    expect(result.truncated).toBe(true);
  });

  it('builds fixed, isolated Codex arguments with no renderer-controlled argv', () => {
    expect(buildAiProviderArguments('codex', '/isolated', '/schema.json', '/output.json')).toEqual([
      'exec',
      '-C',
      '/isolated',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--model',
      'gpt-5.6-luna',
      '-c',
      'approval_policy="never"',
      '-c',
      'web_search="disabled"',
      '--output-schema',
      '/schema.json',
      '--output-last-message',
      '/output.json',
      '-',
    ]);
  });

  it('passes an explicitly selected Codex model', () => {
    const args = buildAiProviderArguments(
      'codex',
      '/isolated',
      '/schema.json',
      '/output.json',
      'gpt-5.6-terra'
    );

    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'gpt-5.6-terra',
    ]);
  });

  it('parses both direct Codex and wrapped Claude structured output', () => {
    expect(
      parseAiCommitMessageOutput('{"subject":"Fix status cache","body":"Add expiry."}')
    ).toEqual({
      subject: 'Fix status cache',
      body: 'Add expiry.',
    });
    expect(
      parseAiCommitMessageOutput(
        JSON.stringify({ structured_output: { subject: 'Handle conflicts', body: '' } })
      )
    ).toEqual({ subject: 'Handle conflicts', body: undefined });
  });

  it('accepts only local JavaScript targets from standard Windows npm shims', () => {
    const shim =
      '@ECHO off\r\n"%dp0%\\node.exe" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    expect(getWindowsNpmShimScriptCandidate(shim, 'C:\\Tools\\codex.cmd')).toBe(
      'C:\\Tools\\node_modules\\@openai\\codex\\bin\\codex.js'
    );
    expect(
      getWindowsNpmShimScriptCandidate('"%dp0%\\..\\outside.js" %*', 'C:\\Tools\\codex.cmd')
    ).toBeNull();
    expect(
      getWindowsNpmShimScriptCandidate('arbitrary command', 'C:\\Tools\\codex.cmd')
    ).toBeNull();
  });
});

describe('AI custom provider selection and status', () => {
  const CLAUDE_AUTH_ENV_KEYS = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_PROFILE',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
  ];
  const baseSettings = customState.aiSettings;
  let directory = '';
  let store: AiCredentialsStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shelly-ai-custom-'));
    customState.userData = directory;
    customState.aiSettings = { ...baseSettings, provider: 'auto' };
    for (const key of CLAUDE_AUTH_ENV_KEYS) vi.stubEnv(key, '');
    clearApprovedPathsForTests();
    approvePathForIpc(directory);
    store = new AiCredentialsStore(directory, fakeStorage as unknown as SafeStorage);
    setAiCredentialsStoreForTests(store);
  });

  afterEach(async () => {
    setAiCredentialsStoreForTests(undefined);
    setProviderFetchForTests(undefined);
    clearApprovedPathsForTests();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function addAcmeCustom(): Promise<string> {
    const { id } = await store.upsertCustomProvider({
      displayName: 'Acme',
      protocol: 'openai-compatible',
      apiKey: 'acme-key',
      baseUrl: 'http://127.0.0.1:9/v1',
      modelOverride: 'acme-model',
    });
    return id;
  }

  it('generates through an explicitly selected custom provider', async () => {
    customState.aiSettings.provider = await addAcmeCustom();
    const seenUrls: string[] = [];
    setProviderFetchForTests(((input: RequestInfo | URL) => {
      seenUrls.push(String(input));
      return Promise.resolve(
        new Response(openAiSse('{"subject":"Fix status cache","body":""}'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    }) as unknown as ProviderFetch);

    const result = await generateAiCommitMessage({
      operationId: 'custom-explicit-1',
      workingCopyPath: directory,
      paths: [join(directory, 'src/app.ts')],
    });

    expect(result.provider).toBe('custom:acme');
    expect(result.model).toBe('acme-model');
    expect(result.message).toBe('Fix status cache');
    expect(seenUrls).toEqual(['http://127.0.0.1:9/v1/chat/completions']);
  });

  it('rejects a stale custom preference like any unconfigured provider', async () => {
    customState.aiSettings.provider = 'custom:ghost';

    await expect(
      generateAiCommitMessage({
        operationId: 'custom-stale-1',
        workingCopyPath: directory,
        paths: [join(directory, 'src/app.ts')],
      })
    ).rejects.toThrow(/\[authentication_required\] Save an API key/);
  });

  it('auto-selects a configured custom provider after CLI and built-in providers fail', async () => {
    await addAcmeCustom();
    // Only the custom endpoint answers; every other probe (built-in Ollama)
    // must fail so auto selection falls through to the custom provider.
    setProviderFetchForTests(((input: RequestInfo | URL) => {
      if (String(input).startsWith('http://127.0.0.1:9')) {
        return Promise.resolve(
          new Response(openAiSse('{"subject":"Fix status cache","body":""}'), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          })
        );
      }
      return Promise.reject(new TypeError('connection refused'));
    }) as unknown as ProviderFetch);

    const result = await generateAiCommitMessage({
      operationId: 'custom-auto-1',
      workingCopyPath: directory,
      paths: [join(directory, 'src/app.ts')],
    });

    expect(result.provider).toBe('custom:acme');
  });

  it('keeps configured built-in HTTP providers ahead of customs in auto order', async () => {
    await store.saveProviderCredential({ provider: 'anthropic', apiKey: 'anthropic-key' });
    await addAcmeCustom();
    setProviderFetchForTests(sseFetch(anthropicSse('{"subject":"Fix status cache","body":""}')));

    const result = await generateAiCommitMessage({
      operationId: 'custom-order-1',
      workingCopyPath: directory,
      paths: [join(directory, 'src/app.ts')],
    });

    expect(result.provider).toBe('anthropic');
  });

  it('appends custom statuses after the built-ins, probing ollama customs', async () => {
    await addAcmeCustom();
    await store.upsertCustomProvider({
      displayName: 'Local LM',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:9',
    });
    setProviderFetchForTests((async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as ProviderFetch);

    const statuses = await getAiCommitProviders();

    expect(statuses.map((status) => status.provider)).toEqual([
      'codex',
      'claude',
      'anthropic',
      'azure-openai',
      'openai-compatible',
      'ollama',
      'custom:acme',
      'custom:local-lm',
    ]);
    expect(statuses[6]).toMatchObject({
      provider: 'custom:acme',
      kind: 'http',
      displayName: 'Acme',
      protocol: 'openai-compatible',
      available: true,
      authenticated: true,
    });
    expect(statuses[6].reason).toBeUndefined();
    expect(statuses[7]).toMatchObject({
      provider: 'custom:local-lm',
      kind: 'http',
      displayName: 'Local LM',
      protocol: 'ollama',
      available: true,
      version: 'local server at 127.0.0.1:9',
    });
  });

  it('marks unreachable ollama customs unavailable with the built-in wording', async () => {
    await store.upsertCustomProvider({
      displayName: 'Local LM',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:9',
    });

    const statuses = await getAiCommitProviders();
    const custom = statuses.find((status) => status.provider === 'custom:local-lm');

    expect(custom).toMatchObject({ available: false, authenticated: false });
    expect(custom?.reason).toBe(
      'No local Ollama or LM Studio server is reachable. Start the server or set its base URL in AI provider settings.'
    );
  });

  it('lists protocol catalog models re-tagged for a custom provider and none for unknown ids', async () => {
    const id = await addAcmeCustom();
    const models = await listAiProviderModels(id);

    expect(models.map((model) => model.id)).toEqual([
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4.1',
      'gpt-4.1-mini',
    ]);
    expect(models.every((model) => model.provider === 'custom:acme')).toBe(true);
    expect(models.filter((model) => model.defaultForProvider)).toHaveLength(1);
    expect(await listAiProviderModels('custom:ghost')).toEqual([]);
  });

  it('serves live ollama models for ollama-protocol customs', async () => {
    const { id } = await store.upsertCustomProvider({
      displayName: 'Local LM',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:9',
    });
    setProviderFetchForTests((async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as ProviderFetch);

    const models = await listAiProviderModels(id);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'llama3.1',
      provider: id,
      local: true,
      dynamic: true,
    });
  });

  it('estimates custom-provider costs from the protocol default with known pricing only', async () => {
    const id = await addAcmeCustom();

    const defaulted = await estimateAiCostForRequest({ provider: id, inputChars: 4_000 });
    expect(defaulted.model).toBe('gpt-4o-mini');
    expect(defaulted.pricingKnown).toBe(true);
    expect(defaulted.estimatedCostUsd).toBeGreaterThan(0);

    const unknown = await estimateAiCostForRequest({
      provider: id,
      model: 'acme-private-model',
      inputChars: 4_000,
    });
    expect(unknown.pricingKnown).toBe(false);
    expect(unknown.estimatedCostUsd).toBe(0);
  });
});
