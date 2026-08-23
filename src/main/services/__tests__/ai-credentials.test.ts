import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeStorage } from 'electron';

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
});
