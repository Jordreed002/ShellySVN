// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types';
import type { SafeStorage } from 'electron';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  parseCodexAuthIdentity,
  parseAiCommitMessageOutput,
  parseAiStructuredOutput,
  prepareDiffForAi,
} from '../ai-commit-message-utils';
import {
  candidateNames,
  estimateAiCostForRequest,
  generateAiCommitMessage,
  getAiCommitProviders,
  invalidateAiProviderStatusCache,
  invalidateProviderExecutableCacheForTests,
  setAiProviderStatusRefreshMsForTests,
  listAiProviderModels,
} from '../ai-commit-message';
import { AiCredentialsStore, setAiCredentialsStoreForTests } from '../ai-credentials';
import { setProviderFetchForTests } from '../ai-providers/http-client';
import type { ProviderFetch } from '../ai-providers/types';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';
import { runSvnText } from '../svn-executor';

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
// Probes run through the async `spawn` path, so the fake emits stdout plus a
// failing 'close' (status 1) on a microtask — exactly how a real child that
// exits non-zero behaves, without touching the real event loop.
const cliProbeState = vi.hoisted(() => ({ spawnCalls: 0, claudeLoggedIn: false }));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');
  type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: () => void };
    kill: () => void;
  };
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 1 })),
    spawn: vi.fn(((command: unknown, args?: readonly string[]) => {
      cliProbeState.spawnCalls += 1;
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: () => undefined };
      child.kill = () => undefined;
      const argv = args ?? [];
      const claudeAuthProbe =
        cliProbeState.claudeLoggedIn && argv.includes('auth') && argv.includes('--json');
      queueMicrotask(() => {
        if (claudeAuthProbe) {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                loggedIn: true,
                authMethod: 'claude.ai',
                email: 'dev@example.com',
                subscriptionType: 'team',
              })
            )
          );
          child.emit('close', 0, null);
          return;
        }
        child.stdout.emit('data', Buffer.from('probe-exit-1\n'));
        child.emit('close', 1, null);
      });
      return child;
    }) as unknown as typeof actual.spawn),
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

/** Encodes one base64url JWT segment for hand-built Codex id tokens. */
const encodeJwtSegment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

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
    ).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      accountEmail: 'private@example.com',
      planLabel: undefined,
    });
    expect(parseClaudeAuthStatus('not json')).toEqual({ loggedIn: false });
  });

  it('labels known Claude subscription tiers and drops malformed emails', () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({ loggedIn: true, subscriptionType: 'team', email: 'jordan@line.dev' })
      )
    ).toMatchObject({ planLabel: 'Claude Team Subscription', accountEmail: 'jordan@line.dev' });
    expect(
      parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, subscriptionType: 'enterprise' }))
    ).toMatchObject({ planLabel: 'Claude Enterprise Subscription' });
    expect(
      parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, email: 'not an email' }))
    ).toMatchObject({ accountEmail: undefined, planLabel: undefined });
  });

  it('decodes Codex identity from the auth file without exposing tokens', () => {
    const idToken = [
      encodeJwtSegment({ alg: 'RS256' }),
      encodeJwtSegment({
        email: 'dev@example.com',
        'https://api.openai.com/auth': { chatgpt_plan_type: 'prolite' },
      }),
      'signature',
    ].join('.');
    expect(
      parseCodexAuthIdentity(JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken } }))
    ).toEqual({
      authMethod: 'ChatGPT',
      accountEmail: 'dev@example.com',
      planLabel: 'ChatGPT Pro Lite Subscription',
    });
    expect(parseCodexAuthIdentity(JSON.stringify({ auth_mode: 'apikey' }))).toEqual({
      authMethod: 'API key',
    });
    expect(parseCodexAuthIdentity('not json')).toEqual({ authMethod: undefined });
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

  it('forwards the chosen model to the Claude CLI and omits it when unset', () => {
    const withModel = buildAiProviderArguments(
      'claude',
      '/isolated',
      '/schema.json',
      '/output.json',
      'opus'
    );
    expect(withModel.slice(withModel.indexOf('--model'), withModel.indexOf('--model') + 2)).toEqual(
      ['--model', 'opus']
    );

    const withoutModel = buildAiProviderArguments(
      'claude',
      '/isolated',
      '/schema.json',
      '/output.json'
    );
    expect(withoutModel).not.toContain('--model');
    // The model flag must not displace the isolated-invocation contract.
    expect(withoutModel).toContain('--strict-mcp-config');
    expect(withoutModel[withoutModel.indexOf('--json-schema') + 1]).toContain('subject');
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

// Windows-only: the extensionless candidate is excluded there because it is a
// POSIX shell script that CreateProcess cannot spawn.
describe.skipIf(process.platform !== 'win32')('Windows CLI executable candidates', () => {
  it('prefers PATHEXT-suffixed launchers over the extensionless shim', () => {
    const previousPathExt = process.env.PATHEXT;
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    try {
      const names = candidateNames('codex');
      expect(names).toContain('codex.cmd');
      // A spawned-but-unrunnable shell script must never win resolution.
      expect(names).not.toContain('codex');
    } finally {
      if (previousPathExt === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = previousPathExt;
    }
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
    // The status cache is module state: every test starts with a clean probe.
    invalidateAiProviderStatusCache();
    cliProbeState.spawnCalls = 0;
    cliProbeState.claudeLoggedIn = false;
    customState.userData = directory;
    customState.aiSettings = { ...baseSettings, provider: 'auto' };
    for (const key of CLAUDE_AUTH_ENV_KEYS) vi.stubEnv(key, '');
    clearApprovedPathsForTests();
    approvePathForIpc(directory);
    store = new AiCredentialsStore(directory, fakeStorage as unknown as SafeStorage);
    setAiCredentialsStoreForTests(store);
  });

  afterEach(async () => {
    vi.mocked(runSvnText).mockImplementation(async () => DIFF);
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

  it('generates when the selected folder is unversioned', async () => {
    customState.aiSettings.provider = await addAcmeCustom();
    setProviderFetchForTests(sseFetch(openAiSse('{"subject":"Add social icons","body":""}')));
    const unversioned = join(directory, 'assets', 'icons', 'social');
    await mkdir(unversioned, { recursive: true });
    vi.mocked(runSvnText).mockRejectedValue(
      new Error(`svn: E155010: The node '${unversioned}' was not found.`)
    );
    vi.mocked(runSvnText).mockClear();

    const result = await generateAiCommitMessage({
      operationId: 'custom-unversioned-folder-1',
      workingCopyPath: directory,
      paths: [unversioned],
    });

    expect(result.message).toBe('Add social icons');
    expect(runSvnText).toHaveBeenCalledTimes(2);
  });

  it('omits a stale missing target while retaining selected file diffs', async () => {
    customState.aiSettings.provider = await addAcmeCustom();
    setProviderFetchForTests(sseFetch(openAiSse('{"subject":"Update theme assets","body":""}')));
    const changedFile = join(directory, 'assets', 'theme.css');
    const missingPath = join(directory, 'assets', 'icons', 'social');
    await mkdir(join(directory, 'assets'), { recursive: true });
    vi.mocked(runSvnText).mockImplementation(async (args) => {
      if (args.some((argument) => argument === missingPath)) {
        throw new Error(`svn: E155010: The node '${missingPath}' was not found.`);
      }
      return DIFF;
    });
    vi.mocked(runSvnText).mockClear();

    const result = await generateAiCommitMessage({
      operationId: 'custom-stale-missing-target-1',
      workingCopyPath: directory,
      paths: [changedFile, missingPath],
    });

    expect(result.message).toBe('Update theme assets');
    expect(
      vi.mocked(runSvnText).mock.calls.filter(([args]) => args.includes('diff'))
    ).toHaveLength(3);
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

  it('serves concurrent status calls from one in-flight probe and caches within the TTL', async () => {
    const [, second] = await Promise.all([getAiCommitProviders(), getAiCommitProviders()]);
    const probes = cliProbeState.spawnCalls;
    expect(second.length).toBeGreaterThan(0);
    expect(probes).toBeGreaterThan(0);
    // Same-Flight sharing: two simultaneous calls must not double the probes.
    expect(cliProbeState.spawnCalls).toBe(probes);
    await getAiCommitProviders();
    // Cached within the TTL: no further spawns.
    expect(cliProbeState.spawnCalls).toBe(probes);
  });

  it('serves stale statuses instantly and refreshes in the background', async () => {
    // Fail the ollama reachability fetch fast so it can't gate the probe.
    setProviderFetchForTests((async () => {
      throw new TypeError('connection refused');
    }) as unknown as ProviderFetch);
    setAiProviderStatusRefreshMsForTests(0);
    try {
      const first = await getAiCommitProviders();
      const probes = cliProbeState.spawnCalls;
      expect(probes).toBeGreaterThan(0);
      // Let Date.now() advance past the (zeroed) refresh threshold.
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Stale-while-revalidate: the caller gets the cached value immediately…
      const stale = await getAiCommitProviders();
      expect(stale).toBe(first);
      // …while a background re-probe runs on the real event loop.
      await vi.waitFor(() => expect(cliProbeState.spawnCalls).toBeGreaterThan(probes), {
        timeout: 3_000,
      });
    } finally {
      setAiProviderStatusRefreshMsForTests(60_000);
    }
  });

  it('forces a re-probe when the status cache is invalidated', async () => {
    await getAiCommitProviders();
    const probes = cliProbeState.spawnCalls;
    expect(probes).toBeGreaterThan(0);
    invalidateAiProviderStatusCache();
    await getAiCommitProviders();
    expect(cliProbeState.spawnCalls).toBeGreaterThan(probes);
  });

  it('reports a subscription Claude login as authenticated with account details', async () => {
    // Hermetic executable resolution: fake CLIs on a temp PATH so the test
    // passes on machines with neither CLI installed.
    const binDir = await mkdtemp(join(tmpdir(), 'shelly-cli-bin-'));
    const { writeFile, chmod } = await import('node:fs/promises');
    for (const name of ['codex', 'claude']) {
      const stub = join(binDir, name);
      await writeFile(stub, '');
      await writeFile(`${stub}.exe`, '');
      if (process.platform !== 'win32') await chmod(stub, 0o755);
    }
    const previousPath = process.env.PATH;
    process.env.PATH = binDir;
    invalidateProviderExecutableCacheForTests();
    invalidateAiProviderStatusCache();
    cliProbeState.claudeLoggedIn = true;
    try {
      const statuses = await getAiCommitProviders();
      const claude = statuses.find((status) => status.provider === 'claude');
      expect(claude).toMatchObject({
        kind: 'cli',
        available: true,
        authenticated: true,
        cliLoggedIn: true,
        authMethod: 'claude.ai',
        accountEmail: 'dev@example.com',
        planLabel: 'Claude Team Subscription',
      });
      expect(claude?.reason).toBeUndefined();
    } finally {
      cliProbeState.claudeLoggedIn = false;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      invalidateProviderExecutableCacheForTests();
      invalidateAiProviderStatusCache();
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it('refuses a CLI provider that is disabled in settings', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'shelly-cli-bin-'));
    const { writeFile, chmod } = await import('node:fs/promises');
    for (const name of ['codex', 'claude']) {
      const stub = join(binDir, name);
      await writeFile(stub, '');
      await writeFile(`${stub}.exe`, '');
      if (process.platform !== 'win32') await chmod(stub, 0o755);
    }
    const previousPath = process.env.PATH;
    process.env.PATH = binDir;
    const previousSettings = customState.aiSettings;
    customState.aiSettings = { ...previousSettings, provider: 'claude', disabledCliProviders: ['claude'] };
    invalidateProviderExecutableCacheForTests();
    invalidateAiProviderStatusCache();
    cliProbeState.claudeLoggedIn = true;
    try {
      await expect(
        generateAiCommitMessage({
          operationId: 'cli-disabled-1',
          workingCopyPath: directory,
          paths: [join(directory, 'src/app.ts')],
        })
      ).rejects.toThrow(/\[provider_unavailable\] This CLI provider is disabled/);
    } finally {
      cliProbeState.claudeLoggedIn = false;
      customState.aiSettings = previousSettings;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      invalidateProviderExecutableCacheForTests();
      invalidateAiProviderStatusCache();
      await rm(binDir, { recursive: true, force: true });
    }
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
