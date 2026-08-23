import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeStorage } from 'electron';
import type { AiCustomProviderUpsertInput } from '@shared/types';

// Plaintext keys must never touch disk: fake safeStorage encrypts deterministically.
const fakeBackend = vi.hoisted(() => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (plaintext: string) => Buffer.from(`enc(${plaintext})`, 'utf8'),
  decryptString: (buffer: Buffer) => {
    const text = buffer.toString('utf8');
    if (text.startsWith('enc(') && text.endsWith(')')) return text.slice(4, -1);
    throw new Error('Could not decrypt');
  },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/shelly-ai-credentials-test-unused') },
  safeStorage: fakeBackend,
}));

import {
  AiCredentialsStore,
  redactWithStoredSecrets,
  setAiCredentialsStoreForTests,
} from '../ai-credentials';

const asBackend = fakeBackend as unknown as SafeStorage;
const unavailableBackend = {
  ...fakeBackend,
  isEncryptionAvailable: () => false,
  getSelectedStorageBackend: () => 'basic_text',
} as unknown as SafeStorage;

/** Ciphertext the fake backend produces for `plaintext` (base64 of `enc(...)`). */
const fakeEncrypted = (plaintext: string) =>
  Buffer.from(`enc(${plaintext})`, 'utf8').toString('base64');

describe('AiCredentialsStore (#20)', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shelly-ai-cred-'));
  });

  afterEach(async () => {
    setAiCredentialsStoreForTests(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips an API key without persisting plaintext at rest', async () => {
    const store = new AiCredentialsStore(directory, asBackend);
    await store.saveProviderCredential({
      provider: 'anthropic',
      apiKey: 'sk-ant-very-secret',
      baseUrl: 'https://api.anthropic.com',
      modelOverride: 'claude-haiku-4-5',
    });

    const onDisk = await readFile(join(directory, 'ai-provider-credentials.json'), 'utf8');
    expect(onDisk).not.toContain('sk-ant-very-secret');
    const persisted = JSON.parse(onDisk) as { providers: { anthropic: { apiKeyEnc: string } } };
    // Stored form is safeStorage ciphertext (base64 of enc(...) in this fake).
    expect(persisted.providers.anthropic.apiKeyEnc).not.toContain('sk-ant-very-secret');
    expect(
      Buffer.from(persisted.providers.anthropic.apiKeyEnc, 'base64').toString('utf8')
    ).toContain('enc(');

    const decoded = await store.getProviderCredential('anthropic');
    expect(decoded).toEqual({
      apiKey: 'sk-ant-very-secret',
      baseUrl: 'https://api.anthropic.com',
      modelOverride: 'claude-haiku-4-5',
    });
  });

  it('refuses to persist keys when safeStorage is unavailable instead of writing plaintext', async () => {
    const store = new AiCredentialsStore(directory, unavailableBackend);
    await expect(
      store.saveProviderCredential({ provider: 'anthropic', apiKey: 'plaintext-key' })
    ).rejects.toThrow(/\[storage_unavailable\]/);
    await expect(readFile(join(directory, 'ai-provider-credentials.json'), 'utf8')).rejects.toThrow();
    await expect(store.summary()).resolves.toMatchObject({ encryptionAvailable: false });
  });

  it('still stores non-secret configuration when safeStorage is unavailable', async () => {
    const store = new AiCredentialsStore(directory, unavailableBackend);
    await store.saveProviderCredential({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
    expect(await store.getProviderCredential('ollama')).toEqual({ baseUrl: 'http://127.0.0.1:11434' });
  });

  it('rejects CLI providers, Ollama keys, and malformed URLs', async () => {
    const store = new AiCredentialsStore(directory, asBackend);
    await expect(store.saveProviderCredential({ provider: 'codex', apiKey: 'k' })).rejects.toThrow(
      /HTTP AI providers/
    );
    await expect(
      store.saveProviderCredential({ provider: 'ollama', apiKey: 'k' })
    ).rejects.toThrow(/does not use an API key/);
    await expect(
      store.saveProviderCredential({ provider: 'anthropic', baseUrl: 'ftp://bad' })
    ).rejects.toThrow(/http\(s\)/);
  });

  it('summarizes without exposing key material and removes entries', async () => {
    const store = new AiCredentialsStore(directory, asBackend);
    await store.saveProviderCredential({
      provider: 'openai-compatible',
      apiKey: 'k',
      baseUrl: 'https://v',
    });
    const summary = await store.summary();
    expect(summary.encryptionAvailable).toBe(true);
    expect(summary.providers).toEqual([
      expect.objectContaining({ provider: 'openai-compatible', hasApiKey: true, hasBaseUrl: true }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('enc(');

    await store.removeProviderCredential('openai-compatible');
    expect(await store.getProviderCredential('openai-compatible')).toEqual({});
  });

  it('redacts stored key material from diagnostics text', async () => {
    const store = new AiCredentialsStore(directory, asBackend);
    setAiCredentialsStoreForTests(store);
    await store.saveProviderCredential({ provider: 'anthropic', apiKey: 'diag-secret-key-123456' });
    const redacted = await redactWithStoredSecrets('request failed for key diag-secret-key-123456');
    expect(redacted).not.toContain('diag-secret-key-123456');
    expect(redacted).toContain('[REDACTED]');
  });

  describe('custom providers', () => {
    it('creates a custom provider with an encrypted key, reflected across all read paths', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      const { id } = await store.upsertCustomProvider({
        displayName: 'OpenRouter',
        protocol: 'openai-compatible',
        apiKey: 'ork-very-secret-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelOverride: 'gpt-4o-mini',
      });
      expect(id).toBe('custom:openrouter');

      const onDisk = await readFile(join(directory, 'ai-provider-credentials.json'), 'utf8');
      expect(onDisk).not.toContain('ork-very-secret-key');
      const persisted = JSON.parse(onDisk) as {
        customProviders?: Record<string, { apiKeyEnc?: string }>;
      };
      expect(persisted.customProviders?.openrouter?.apiKeyEnc).toBeDefined();

      expect(await store.listCustomProviders()).toEqual([
        expect.objectContaining({
          id: 'custom:openrouter',
          slug: 'openrouter',
          displayName: 'OpenRouter',
          protocol: 'openai-compatible',
          baseUrl: 'https://openrouter.ai/api/v1',
          modelOverride: 'gpt-4o-mini',
          hasApiKey: true,
        }),
      ]);
      expect(await store.getCustomProviderInfo('custom:openrouter')).toEqual(
        expect.objectContaining({
          id: 'custom:openrouter',
          displayName: 'OpenRouter',
          protocol: 'openai-compatible',
          hasApiKey: true,
        })
      );
      expect(await store.getProviderCredential('custom:openrouter')).toEqual({
        apiKey: 'ork-very-secret-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelOverride: 'gpt-4o-mini',
      });
      expect(await store.summary()).toMatchObject({
        providers: [
          expect.objectContaining({
            provider: 'custom:openrouter',
            displayName: 'OpenRouter',
            protocol: 'openai-compatible',
            hasApiKey: true,
            hasBaseUrl: true,
            baseUrl: 'https://openrouter.ai/api/v1',
            modelOverride: 'gpt-4o-mini',
          }),
        ],
      });
    });

    it('derives unique slugs and keeps ids immutable across renames', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      const first = await store.upsertCustomProvider({
        displayName: 'My Work Endpoint',
        protocol: 'anthropic',
        apiKey: 'k1',
        modelOverride: 'claude-haiku-4-5',
      });
      expect(first.id).toBe('custom:my-work-endpoint');
      const second = await store.upsertCustomProvider({
        displayName: 'My Work Endpoint',
        protocol: 'anthropic',
        apiKey: 'k2',
        modelOverride: 'claude-haiku-4-5',
      });
      expect(second.id).toBe('custom:my-work-endpoint-2');

      // Rename: slug/id stay put, omitted credential fields are kept.
      const renamed = await store.upsertCustomProvider({
        id: 'custom:my-work-endpoint',
        displayName: 'Team Endpoint',
        protocol: 'anthropic',
      });
      expect(renamed.id).toBe('custom:my-work-endpoint');
      expect(await store.getCustomProviderInfo('custom:my-work-endpoint')).toMatchObject({
        displayName: 'Team Endpoint',
        hasApiKey: true,
      });
      expect((await store.listCustomProviders()).map((provider) => provider.id)).toEqual([
        'custom:my-work-endpoint',
        'custom:my-work-endpoint-2',
      ]);

      await expect(
        store.upsertCustomProvider({
          id: 'custom:my-work-endpoint',
          displayName: 'Changed Protocol',
          protocol: 'ollama',
        })
      ).rejects.toThrow(/protocol/i);
      await expect(
        store.upsertCustomProvider({ id: 'custom:ghost', displayName: 'Ghost', protocol: 'anthropic' })
      ).rejects.toThrow(/does not exist/);
      await expect(
        store.upsertCustomProvider({ id: 'anthropic', displayName: 'Built In', protocol: 'anthropic' })
      ).rejects.toThrow(/custom:/);
    });

    it('enforces the per-protocol validation matrix on create', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      const create = (overrides: Partial<AiCustomProviderUpsertInput>) =>
        store.upsertCustomProvider({
          displayName: 'Matrix',
          protocol: 'anthropic',
          apiKey: 'k',
          modelOverride: 'm',
          ...overrides,
        });

      for (const protocol of ['anthropic', 'azure-openai', 'openai-compatible'] as const) {
        await expect(create({ protocol, apiKey: undefined })).rejects.toThrow(/API key/);
      }
      for (const protocol of ['azure-openai', 'openai-compatible'] as const) {
        await expect(create({ protocol, baseUrl: undefined })).rejects.toThrow(/base URL/);
      }
      await expect(create({ modelOverride: undefined })).rejects.toThrow(/model override/);
      await expect(
        create({ protocol: 'ollama', apiKey: 'nope', modelOverride: undefined })
      ).rejects.toThrow(/does not use an API key/);
      await expect(create({ displayName: '   ' })).rejects.toThrow(/1 to 80 characters/);
      await expect(create({ displayName: 'x'.repeat(81) })).rejects.toThrow(/1 to 80 characters/);
      await expect(create({ baseUrl: 'ftp://bad' })).rejects.toThrow(/http\(s\)/);

      // No rejected create may have partially written a provider.
      expect(await store.listCustomProviders()).toEqual([]);
    });

    it('edits credential fields on an existing custom provider', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      await store.upsertCustomProvider({
        displayName: 'Groq',
        protocol: 'openai-compatible',
        apiKey: 'groq-key-1',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOverride: 'llama-4-scout',
      });

      // Rename plus clearing the key with '' (empty clears, like built-ins).
      await store.upsertCustomProvider({
        id: 'custom:groq',
        displayName: 'Groq Fast',
        protocol: 'openai-compatible',
        apiKey: '',
      });
      const afterEdit = await store.getCustomProviderInfo('custom:groq');
      expect(afterEdit?.displayName).toBe('Groq Fast');
      expect(afterEdit?.hasApiKey).toBe(false);
      expect(afterEdit?.baseUrl).toBe('https://api.groq.com/openai/v1');

      // Plain credential saves work on custom ids too.
      await store.saveProviderCredential({ provider: 'custom:groq', apiKey: 'groq-key-2' });
      expect(await store.getProviderCredential('custom:groq')).toEqual({
        apiKey: 'groq-key-2',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOverride: 'llama-4-scout',
      });
      await expect(
        store.saveProviderCredential({ provider: 'custom:unknown', apiKey: 'k' })
      ).rejects.toThrow(/does not exist/);

      // Zero-credential definitions survive: the definition IS the provider.
      await store.upsertCustomProvider({ displayName: 'Bare Ollama', protocol: 'ollama' });
      expect(await store.summary()).toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'custom:groq', hasApiKey: true }),
          expect.objectContaining({
            provider: 'custom:bare-ollama',
            displayName: 'Bare Ollama',
            protocol: 'ollama',
            hasApiKey: false,
            hasBaseUrl: false,
          }),
        ]),
      });
    });

    it('removes a custom provider definition entirely', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      await store.upsertCustomProvider({
        displayName: 'Local LLM',
        protocol: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        modelOverride: 'llama3.2',
      });
      expect(await store.getCustomProviderInfo('custom:local-llm')).toBeDefined();

      await store.removeProviderCredential('custom:local-llm');

      expect(await store.getCustomProviderInfo('custom:local-llm')).toBeUndefined();
      expect(await store.listCustomProviders()).toEqual([]);
      expect((await store.summary()).providers).toEqual([]);
      expect(await store.getProviderCredential('custom:local-llm')).toEqual({});
    });

    it('includes custom provider keys in storedSecrets for redaction', async () => {
      const store = new AiCredentialsStore(directory, asBackend);
      setAiCredentialsStoreForTests(store);
      await store.upsertCustomProvider({
        displayName: 'Secret Custom',
        protocol: 'anthropic',
        apiKey: 'custom-diag-key-678901',
        modelOverride: 'claude-haiku-4-5',
      });
      await expect(store.storedSecrets()).resolves.toContain('custom-diag-key-678901');
      const redacted = await redactWithStoredSecrets('leaked custom-diag-key-678901 in a log');
      expect(redacted).not.toContain('custom-diag-key-678901');
      expect(redacted).toContain('[REDACTED]');
    });

    it('sanitizes custom entries and preserves unknown top-level sections', async () => {
      const raw = {
        version: 1,
        providers: {
          anthropic: { apiKeyEnc: fakeEncrypted('builtin'), updatedAt: '2024-01-01T00:00:00.000Z' },
        },
        customProviders: {
          'keep-me': {
            displayName: 'Kept Provider',
            protocol: 'anthropic',
            apiKeyEnc: fakeEncrypted('kept'),
            modelOverride: 'claude-haiku-4-5',
            createdAt: '2024-02-01T00:00:00.000Z',
            updatedAt: '2024-02-02T00:00:00.000Z',
          },
          'Bad Slug!': { displayName: 'Bad Slug', protocol: 'anthropic' },
          'bad-protocol': { displayName: 'Bad Protocol', protocol: 'carrier-pigeon' },
        },
        futureSection: { nested: { keep: true } },
      };
      await writeFile(join(directory, 'ai-provider-credentials.json'), JSON.stringify(raw), 'utf8');

      const store = new AiCredentialsStore(directory, asBackend);
      expect((await store.listCustomProviders()).map((provider) => provider.slug)).toEqual(['keep-me']);
      expect(await store.getProviderCredential('custom:keep-me')).toEqual({
        apiKey: 'kept',
        modelOverride: 'claude-haiku-4-5',
      });

      // Any write round-trips the sanitized file: unknown sections survive,
      // invalid custom entries stay dropped, and built-ins are untouched.
      await store.saveProviderCredential({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
      const onDisk = JSON.parse(
        await readFile(join(directory, 'ai-provider-credentials.json'), 'utf8')
      ) as Record<string, unknown>;
      expect(onDisk.futureSection).toEqual({ nested: { keep: true } });
      expect(onDisk.customProviders).toEqual({
        'keep-me': expect.objectContaining({ displayName: 'Kept Provider', protocol: 'anthropic' }),
      });
      expect(onDisk.providers).toMatchObject({
        anthropic: { updatedAt: '2024-01-01T00:00:00.000Z' },
        ollama: { baseUrl: 'http://127.0.0.1:11434' },
      });
    });

    it('refuses to create custom providers with keys when safeStorage is unavailable', async () => {
      const store = new AiCredentialsStore(directory, unavailableBackend);
      await expect(
        store.upsertCustomProvider({
          displayName: 'Refused',
          protocol: 'anthropic',
          apiKey: 'plaintext-key',
          modelOverride: 'claude-haiku-4-5',
        })
      ).rejects.toThrow(/\[storage_unavailable\]/);
      await expect(readFile(join(directory, 'ai-provider-credentials.json'), 'utf8')).rejects.toThrow();
    });
  });
});
