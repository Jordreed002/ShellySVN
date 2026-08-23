import type { SafeStorage } from 'electron';
import { app, safeStorage } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AiCommitProvider,
  AiCredentialsSummary,
  AiHttpProvider,
  AiProviderCredentialInput,
  AiProviderCredentialStatus,
} from '@shared/types';
import { writeSecureJson } from '../utils/secure-json';
import { decryptSecret, encryptSecret, isSecureStorageAvailable } from '../utils/secure-storage';
import { isHttpAiProvider } from './ai-providers/types';
import { redactDiagnosticsText } from './ai-providers/redact';

/**
 * AI provider credential store (#20).
 *
 * API keys live ONLY as safeStorage-encrypted blobs in
 * `<userData>/ai-provider-credentials.json` (0600, atomic writes). Base URLs
 * and model overrides are configuration, not secrets, and are stored in the
 * same file. When safeStorage is unavailable (typically Linux without a
 * keyring) the store refuses to persist key material instead of writing
 * plaintext. Stored keys never appear in logs, errors, or diagnostics: use
 * `redactWithStoredSecrets` on any text produced near this store.
 */

const FILE_NAME = 'ai-provider-credentials.json';
const MAX_BASE_URL_LENGTH = 2_000;
const MAX_MODEL_OVERRIDE_LENGTH = 200;

type SafeStorageBackend = SafeStorage;

interface StoredProviderEntry {
  apiKeyEnc?: string;
  baseUrl?: string;
  modelOverride?: string;
  updatedAt: string;
}

interface CredentialsFile {
  version: 1;
  providers: Partial<Record<AiHttpProvider, StoredProviderEntry>>;
}

export interface DecodedProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
}

function emptyFile(): CredentialsFile {
  return { version: 1, providers: {} };
}

function isSafeProviderKey(value: unknown): value is AiHttpProvider {
  return typeof value === 'string' && isHttpAiProvider(value as AiCommitProvider);
}

function sanitizeFile(value: unknown): CredentialsFile {
  const providers = (value as { providers?: unknown })?.providers;
  const file = emptyFile();
  if (!providers || typeof providers !== 'object') return file;
  for (const [key, entry] of Object.entries(providers as Record<string, unknown>)) {
    if (!isSafeProviderKey(key) || !entry || typeof entry !== 'object') continue;
    const record = entry as Partial<StoredProviderEntry>;
    file.providers[key] = {
      apiKeyEnc: typeof record.apiKeyEnc === 'string' ? record.apiKeyEnc : undefined,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl.slice(0, MAX_BASE_URL_LENGTH) : undefined,
      modelOverride:
        typeof record.modelOverride === 'string'
          ? record.modelOverride.slice(0, MAX_MODEL_OVERRIDE_LENGTH)
          : undefined,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    };
  }
  return file;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_BASE_URL_LENGTH) {
    throw new Error('Provider base URL is too long.');
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Provider base URL must use http or https.');
    }
  } catch {
    throw new Error('Provider base URL must be a valid http(s) URL.');
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeModelOverride(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_MODEL_OVERRIDE_LENGTH || /\s/.test(trimmed)) {
    throw new Error('Provider model override must be a single short model identifier.');
  }
  return trimmed;
}

export class AiCredentialsStore {
  private readonly filePath: string;
  private readonly backend: SafeStorageBackend;
  private readonly encryptionAvailable: boolean;

  constructor(directory: string, backend: SafeStorageBackend = safeStorage) {
    this.filePath = join(directory, FILE_NAME);
    this.backend = backend;
    this.encryptionAvailable = isSecureStorageAvailable(this.backend);
  }

  get isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }

  encryptionUnavailableReason(): string | undefined {
    if (this.encryptionAvailable) return undefined;
    return 'OS-protected credential storage (safeStorage) is unavailable on this system, so API keys cannot be stored securely. ShellySVN refuses to save provider keys in plaintext.';
  }

  private async load(): Promise<CredentialsFile> {
    try {
      return sanitizeFile(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return emptyFile();
    }
  }

  private async persist(file: CredentialsFile): Promise<void> {
    await writeSecureJson(this.filePath, file);
  }

  async saveProviderCredential(input: AiProviderCredentialInput): Promise<void> {
    if (!input || typeof input !== 'object') throw new Error('A provider credential input is required.');
    const provider = input.provider;
    if (!isSafeProviderKey(provider)) {
      throw new Error('API keys can only be stored for HTTP AI providers (Anthropic, Azure OpenAI, OpenAI-compatible, Ollama).');
    }
    const apiKey = input.apiKey?.trim() || '';
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const modelOverride = normalizeModelOverride(input.modelOverride);
    if (apiKey && provider === 'ollama') {
      throw new Error('Ollama runs locally and does not use an API key.');
    }
    if (apiKey && !this.encryptionAvailable) {
      throw new Error(
        `[storage_unavailable] ${this.encryptionUnavailableReason()}`
      );
    }
    let apiKeyEnc: string | undefined;
    if (apiKey) {
      const encrypted = encryptSecret(this.backend, apiKey);
      if (!encrypted) {
        throw new Error('[storage_unavailable] The OS credential store refused the API key; nothing was written.');
      }
      apiKeyEnc = encrypted;
    }
    const file = await this.load();
    const existing = file.providers[provider] ?? { updatedAt: new Date(0).toISOString() };
    const next: StoredProviderEntry = {
      apiKeyEnc: apiKey ? apiKeyEnc : input.apiKey === '' ? undefined : existing.apiKeyEnc,
      baseUrl: baseUrl ?? (input.baseUrl === '' ? undefined : existing.baseUrl),
      modelOverride: modelOverride ?? (input.modelOverride === '' ? undefined : existing.modelOverride),
      updatedAt: new Date().toISOString(),
    };
    if (!next.apiKeyEnc && !next.baseUrl && !next.modelOverride) {
      delete file.providers[provider];
    } else {
      file.providers[provider] = next;
    }
    await this.persist(file);
  }

  async removeProviderCredential(provider: AiCommitProvider): Promise<void> {
    if (!isSafeProviderKey(provider)) return;
    const file = await this.load();
    if (file.providers[provider]) {
      delete file.providers[provider];
      await this.persist(file);
    }
  }

  /** Decrypted in-memory view; never persisted and never logged. */
  async getProviderCredential(provider: AiCommitProvider): Promise<DecodedProviderCredential> {
    if (!isSafeProviderKey(provider)) return {};
    const entry = (await this.load()).providers[provider];
    if (!entry) return {};
    let apiKey: string | undefined;
    if (entry.apiKeyEnc) {
      // Decrypt failures (rotated keychain) drop the key instead of failing callers.
      apiKey = decryptSecret(this.backend, entry.apiKeyEnc) ?? undefined;
    }
    return {
      apiKey,
      baseUrl: entry.baseUrl,
      modelOverride: entry.modelOverride,
    };
  }

  /** Non-secret status view for the renderer. */
  async summary(): Promise<AiCredentialsSummary> {
    const file = await this.load();
    const providers: AiProviderCredentialStatus[] = [];
    for (const provider of Object.keys(file.providers) as AiHttpProvider[]) {
      const entry = file.providers[provider];
      if (!entry) continue;
      providers.push({
        provider,
        hasApiKey: Boolean(entry.apiKeyEnc),
        hasBaseUrl: Boolean(entry.baseUrl),
        baseUrl: entry.baseUrl,
        modelOverride: entry.modelOverride,
        updatedAt: entry.updatedAt,
      });
    }
    return {
      encryptionAvailable: this.encryptionAvailable,
      storageUnavailableReason: this.encryptionUnavailableReason(),
      providers,
    };
  }

  /** All stored key material, for redacting diagnostics across providers. */
  async storedSecrets(): Promise<string[]> {
    const file = await this.load();
    const secrets: string[] = [];
    for (const provider of Object.keys(file.providers) as AiHttpProvider[]) {
      const entry = file.providers[provider];
      if (entry?.apiKeyEnc) {
        const decrypted = decryptSecret(this.backend, entry.apiKeyEnc);
        if (decrypted) secrets.push(decrypted);
      }
    }
    return secrets;
  }
}

let singleton: AiCredentialsStore | undefined;

/** Singleton bound to the Electron userData directory. */
export function getAiCredentialsStore(): AiCredentialsStore {
  singleton ??= new AiCredentialsStore(app.getPath('userData'), safeStorage);
  return singleton;
}

let testStore: AiCredentialsStore | undefined;

/** Test seam: substitute (or clear) the store used by the AI services. */
export function setAiCredentialsStoreForTests(store: AiCredentialsStore | undefined): void {
  testStore = store;
}

export function currentAiCredentialsStore(): AiCredentialsStore {
  return testStore ?? getAiCredentialsStore();
}

/** Central redaction helper: strip every stored AI key from diagnostic text. */
export async function redactWithStoredSecrets(text: string): Promise<string> {
  let secrets: string[] = [];
  try {
    secrets = await currentAiCredentialsStore().storedSecrets();
  } catch {
    secrets = [];
  }
  return redactDiagnosticsText(text, secrets);
}
