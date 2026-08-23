import { describe, expect, it, vi } from 'vitest';

// The prompt builders live in ai-commit-message.ts; its heavy collaborators
// are mocked so the real prepare-path functions run hermetically.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/shelly-ai-guard-test') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (text: string) => Buffer.from(`enc(${text})`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4, -1),
  },
}));
vi.mock('../svn-executor', () => ({ runSvnText: vi.fn(async () => '') }));
vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({ ready: async () => undefined, get: () => ({}) }),
}));

import { buildPrompt, conflictPrompt, reviewPrompt } from '../ai-commit-message';
import { prepareDiffForAi } from '../ai-commit-message-utils';
import { guardOutboundPrompt } from '../ai-privacy-scanner';
import { buildAnthropicRequest } from '../ai-providers/anthropic';
import { buildOpenAiCompatibleChatRequest } from '../ai-providers/openai-chat';

const CLEAN_DIFF = [
  'Index: src/app.ts',
  '--- src/app.ts',
  '+++ src/app.ts',
  '+const ready = true;',
  '',
].join('\n');

const SECRET_BEARING_DIFF = [
  'Index: config/deploy.env',
  '--- config/deploy.env',
  '+++ config/deploy.env',
  '+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  '+auth_token = "ghp_16C7e42F292c6912E7710c838347Ae178B4a"',
  '+id_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMe',
  '',
].join('\n');

const taskInput = (prompt: string) => ({
  prompt,
  outputSchema: { type: 'object' },
  timeoutMs: 1_000,
  signal: new AbortController().signal,
  onDelta: () => undefined,
});

describe('outbound prompt guard over the real prepare path (#114a, #19)', () => {
  it('wraps repo content in UNTRUSTED DATA blocks with an explicit data-only rule', () => {
    const prepared = prepareDiffForAi(CLEAN_DIFF, 64 * 1024);
    const prompt = buildPrompt(prepared, 'concise');
    expect(prompt).toContain('<untrusted_data source="svn diff">');
    expect(prompt).toContain('</untrusted_data>');
    expect(prompt).toMatch(/UNTRUSTED DATA/i);
    expect(prompt).toMatch(/never be followed/i);
    expect(prompt).toContain('const ready = true;');

    const review = reviewPrompt(['/repo/src/app.ts'], prepared);
    expect(review).toContain('<untrusted_data source="changed file paths">');
    expect(review).toContain('/repo/src/app.ts');

    const conflict = conflictPrompt('/repo/a.ts', '<<<<<<<\nmine\n=======\ntheirs\n>>>>>>>');
    expect(conflict).toContain('<untrusted_data source="conflict file contents">');
  });

  it('builds provider request bodies containing only the guarded prompt', () => {
    const prepared = prepareDiffForAi(CLEAN_DIFF, 64 * 1024);
    const prompt = buildPrompt(prepared, 'concise');
    const guarded = guardOutboundPrompt(prompt);
    expect(guarded.blocked).toBe(false);

    const anthropicBody = JSON.parse(
      buildAnthropicRequest({ provider: 'anthropic', apiKey: 'k' }, taskInput(guarded.text)).body ?? '{}'
    );
    expect(anthropicBody.messages[0].content).toContain('<untrusted_data source="svn diff">');

    const openAiBody = JSON.parse(
      buildOpenAiCompatibleChatRequest(
        { provider: 'openai-compatible', apiKey: 'k', baseUrl: 'https://v.io/v1' },
        taskInput(guarded.text)
      ).body ?? '{}'
    );
    expect(openAiBody.messages[1].content).toContain('const ready = true;');
    expect(openAiBody.stream).toBe(true);
  });

  it('blocks secrets that slip past diff redaction before any provider call', () => {
    // AKIA keys, GitHub tokens, and JWTs are shapes redactAiSecrets does not
    // know; the outbound guard must catch them in the assembled prompt.
    const prepared = prepareDiffForAi(SECRET_BEARING_DIFF, 64 * 1024);
    expect(prepared.text).not.toContain('ghp_16C7e42F292c6912E7710c838347Ae178B4a'.slice(0, 20));
    const prompt = buildPrompt(prepared, 'concise');
    expect(() => guardOutboundPrompt(prompt)).toThrow(
      /\[secret_detected\].*(aws-access-key|github-token|jwt)/
    );
  });

  it('redacts simple credential assignments before they reach a provider body', () => {
    const diffWithSkKey = 'Index: c.env\n--- c.env\n+++ c.env\n+api_key=sk-example-secret-token-123456\n';
    const prepared = prepareDiffForAi(diffWithSkKey, 64 * 1024);
    expect(prepared.redacted).toBe(true);
    const guarded = guardOutboundPrompt(buildPrompt(prepared, 'concise'));
    expect(guarded.blocked).toBe(false);
    const body = JSON.parse(
      buildOpenAiCompatibleChatRequest(
        { provider: 'openai-compatible', apiKey: 'k', baseUrl: 'https://v.io/v1' },
        taskInput(guarded.text)
      ).body ?? '{}'
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('sk-example-secret-token-123456');
  });

  it('guards prompts assembled with unredacted recent history', () => {
    const prepared = prepareDiffForAi(CLEAN_DIFF, 64 * 1024);
    const historyWithToken = 'r41 · alice: rotate keys, old one ghp_16C7e42F292c6912E7710c838347Ae178B4a';
    const prompt = buildPrompt(prepared, 'concise', undefined, historyWithToken);
    expect(() => guardOutboundPrompt(prompt)).toThrow(/\[secret_detected\].*github-token/);
  });
});
