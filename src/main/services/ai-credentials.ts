import type { SafeStorage } from 'electron';
import { app, safeStorage } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AiCommitProvider,
  AiCredentialsSummary,
  AiCustomProviderProtocol,
  AiCustomProviderUpsertInput,
  AiHttpProvider,
  AiProviderCredentialInput,
  AiProviderCredentialStatus,
  AiProviderId,
} from '@shared/types';
import { writeSecureJson } from '../utils/secure-json';
import { decryptSecret, encryptSecret, isSecureStorageAvailable } from '../utils/secure-storage';
import { isHttpAiProvider } from './ai-providers/types';
import { redactDiagnosticsText } from './ai-providers/redact';

/**
 * AI provider credential store (#20).
 *
 * API keys live ONLY as safeStorage-encrypted blobs in
 * `<userData>/ai-provider-credentials.json` (0600, atomic writes). The file has
 * two sections: `providers` for the built-in HTTP providers and
 * `customProviders` for user-defined providers (ids of the form
 * `custom:<slug>`), whose definition — display name plus wire protocol — is
 * stored alongside its credentials. Base URLs and model overrides are
 * configuration, not secrets, and are stored in the same file. Unrecognized
 * top-level sections are preserved verbatim so a load/persist round-trip never
 * deletes data a newer file format wrote. When safeStorage is unavailable
 * (typically Linux without a keyring) the store refuses to persist key
 * material instead of writing plaintext. Stored keys never appear in logs,
 * errors, or diagnostics: use `redactWithStoredSecrets` on any text produced
 * near this store.
 */

const FILE_NAME = 'ai-provider-credentials.json';
const MAX_BASE_URL_LENGTH = 2_000;
const MAX_MODEL_OVERRIDE_LENGTH = 200;
const CUSTOM_ID_PREFIX = 'custom:';
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 64;
/** Custom slugs start alphanumeric and contain only lowercase alphanumerics and dashes. */
const CUSTOM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type SafeStorageBackend = SafeStorage;

interface StoredProviderEntry {
  apiKeyEnc?: string;
  baseUrl?: string;
  modelOverride?: string;
  updatedAt: string;
}

/** A user-defined provider: its definition plus (optionally) its credentials. */
interface CustomProviderRecord {
  displayName: string;
  protocol: AiCustomProviderProtocol;
  apiKeyEnc?: string;
  baseUrl?: string;
  modelOverride?: string;
  createdAt: string;
  updatedAt: string;
}

interface CredentialsFile {
  version: 1;
  providers: Partial<Record<AiHttpProvider, StoredProviderEntry>>;
  customProviders?: Record<string /*slug*/, CustomProviderRecord>;
}

/**
 * A loaded file plus any unrecognized top-level sections kept verbatim, so a
 * load → persist round-trip preserves data written by a newer file format.
 */
type LoadedCredentialsFile = CredentialsFile & Record<string, unknown>;

export interface DecodedProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
}

/** Non-secret read view of a custom provider definition. */
export interface AiCustomProviderInfo {
  /** Full id, e.g. 'custom:openrouter'. */
  id: string;
  slug: string;
  displayName: string;
  protocol: AiCustomProviderProtocol;
  baseUrl?: string;
  modelOverride?: string;
  hasApiKey: boolean;
  updatedAt: string;
}

const CUSTOM_PROTOCOLS: ReadonlySet<string> = new Set([
  'anthropic',
  'azure-openai',
  'openai-compatible',
  'ollama',
]);

const PROTOCOL_LABELS: Record<AiCustomProviderProtocol, string> = {
  anthropic: 'Anthropic',
  'azure-openai': 'Azure OpenAI',
  'openai-compatible': 'OpenAI-compatible',
  ollama: 'Ollama',
};

function isCustomProtocol(value: unknown): value is AiCustomProviderProtocol {
  return typeof value === 'string' && CUSTOM_PROTOCOLS.has(value);
}

/** Slug of a `custom:<slug>` id; undefined for every other provider id. */
function customSlugFromId(provider: AiProviderId): string | undefined {
  if (typeof provider !== 'string' || !provider.startsWith(CUSTOM_ID_PREFIX)) return undefined;
  return provider.slice(CUSTOM_ID_PREFIX.length) || undefined;
}

function toCustomProviderInfo(slug: string, record: CustomProviderRecord): AiCustomProviderInfo {
  return {
    id: `${CUSTOM_ID_PREFIX}${slug}`,
    slug,
    displayName: record.displayName,
    protocol: record.protocol,
    baseUrl: record.baseUrl,
    modelOverride: record.modelOverride,
    hasApiKey: Boolean(record.apiKeyEnc),
    updatedAt: record.updatedAt,
  };
}

function emptyFile(): LoadedCredentialsFile {
  return { version: 1, providers: {} };
}

function isSafeProviderKey(value: unknown): value is AiHttpProvider {
  return typeof value === 'string' && isHttpAiProvider(value as AiCommitProvider);
}

/** Kebab-case a display name into a slug: [a-z0-9]+ runs joined by dashes. */
function slugifyDisplayName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'provider';
}

/** Deduplicate `base` against `taken` by appending -2, -3, … within the slug cap. */
function uniqueCustomSlug(base: string, taken: ReadonlySet<string>): string {
  const candidate = base.slice(0, MAX_SLUG_LENGTH);
  if (!taken.has(candidate)) return candidate;
  for (let counter = 2; ; counter += 1) {
    const suffix = `-${counter}`;
    const next = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(next)) return next;
  }
}

function sanitizeCustomProviderRecord(slug: string, entry: unknown): CustomProviderRecord | undefined {
  if (!CUSTOM_SLUG_PATTERN.test(slug) || !entry || typeof entry !== 'object') return undefined;
  const record = entry as Partial<CustomProviderRecord>;
  if (!isCustomProtocol(record.protocol)) return undefined;
  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
  if (!displayName) return undefined;
  return {
    // Too-long names are truncated rather than dropping the whole provider.
    displayName: displayName.slice(0, MAX_DISPLAY_NAME_LENGTH),
    protocol: record.protocol,
    apiKeyEnc: typeof record.apiKeyEnc === 'string' ? record.apiKeyEnc : undefined,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl.slice(0, MAX_BASE_URL_LENGTH) : undefined,
    modelOverride:
      typeof record.modelOverride === 'string'
        ? record.modelOverride.slice(0, MAX_MODEL_OVERRIDE_LENGTH)
        : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  };
}

function sanitizeFile(value: unknown): LoadedCredentialsFile {
  const file = emptyFile();
  if (!value || typeof value !== 'object') return file;
  const source = value as Record<string, unknown>;
  // Preserve unrecognized top-level sections verbatim so this version never
  // deletes data a newer file format wrote ('__proto__' is skipped: assigning
  // it would retarget the object prototype instead of creating a property).
  for (const [key, section] of Object.entries(source)) {
    if (key !== 'version' && key !== 'providers' && key !== 'customProviders' && key !== '__proto__') {
      file[key] = section;
    }
  }
  const providers = source.providers;
  if (providers && typeof providers === 'object') {
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
  }
  const customProviders = source.customProviders;
  if (customProviders && typeof customProviders === 'object') {
    const sanitized: Record<string, CustomProviderRecord> = {};
    for (const [slug, entry] of Object.entries(customProviders as Record<string, unknown>)) {
      const record = sanitizeCustomProviderRecord(slug, entry);
      if (record) sanitized[slug] = record;
    }
    if (Object.keys(sanitized).length > 0) file.customProviders = sanitized;
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

  private async load(): Promise<LoadedCredentialsFile> {
    try {
      return sanitizeFile(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return emptyFile();
    }
  }

  private async persist(file: LoadedCredentialsFile): Promise<void> {
    await writeSecureJson(this.filePath, file);
  }

  /**
   * Save credentials for a built-in HTTP provider or a custom provider. Custom
   * ids (`custom:<slug>`) update only the credential fields of an existing
   * definition; custom providers are created via `upsertCustomProvider`.
   */
  async saveProviderCredential(input: AiProviderCredentialInput): Promise<void> {
    if (!input || typeof input !== 'object') throw new Error('A provider credential input is required.');
    const provider = input.provider;
    const customSlug = customSlugFromId(provider);
    if (customSlug) {
      await this.saveCustomProviderCredential(customSlug, input);
      return;
    }
    if (!isSafeProviderKey(provider)) {
      throw new Error('API keys can only be stored for HTTP AI providers (Anthropic, Azure OpenAI, OpenAI-compatible, Ollama) or custom providers.');
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

  private async saveCustomProviderCredential(
    slug: string,
    input: AiProviderCredentialInput
  ): Promise<void> {
    const apiKey = input.apiKey?.trim() || '';
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const modelOverride = normalizeModelOverride(input.modelOverride);
    const file = await this.load();
    const existing = file.customProviders?.[slug];
    if (!existing) {
      throw new Error(`Custom provider "${CUSTOM_ID_PREFIX}${slug}" does not exist; create it before saving credentials.`);
    }
    if (apiKey && existing.protocol === 'ollama') {
      throw new Error('Ollama runs locally and does not use an API key.');
    }
    let apiKeyEnc: string | undefined;
    if (apiKey) {
      if (!this.encryptionAvailable) {
        throw new Error(`[storage_unavailable] ${this.encryptionUnavailableReason()}`);
      }
      const encrypted = encryptSecret(this.backend, apiKey);
      if (!encrypted) {
        throw new Error('[storage_unavailable] The OS credential store refused the API key; nothing was written.');
      }
      apiKeyEnc = encrypted;
    }
    const next: CustomProviderRecord = {
      ...existing,
      apiKeyEnc: apiKey ? apiKeyEnc : input.apiKey === '' ? undefined : existing.apiKeyEnc,
      baseUrl: baseUrl ?? (input.baseUrl === '' ? undefined : existing.baseUrl),
      modelOverride: modelOverride ?? (input.modelOverride === '' ? undefined : existing.modelOverride),
      updatedAt: new Date().toISOString(),
    };
    file.customProviders = { ...file.customProviders, [slug]: next };
    await this.persist(file);
  }

  /**
   * Create (no `id`) or edit/rename (`id`) a user-defined custom provider.
   * Credentials ride along so the Add Provider dialog is a single atomic
   * write. The slug and id are fixed at creation; editing only changes the
   * display name and the credential fields present in the input.
   */
  async upsertCustomProvider(input: AiCustomProviderUpsertInput): Promise<{ id: string }> {
    if (!input || typeof input !== 'object') throw new Error('A custom provider definition is required.');
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new Error('Custom provider names must be 1 to 80 characters.');
    }
    if (!isCustomProtocol(input.protocol)) {
      throw new Error('Custom provider protocol must be Anthropic, Azure OpenAI, OpenAI-compatible, or Ollama.');
    }
    const protocol = input.protocol;
    const apiKey = input.apiKey?.trim() || '';
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const modelOverride = normalizeModelOverride(input.modelOverride);
    if (apiKey && protocol === 'ollama') {
      throw new Error('Ollama runs locally and does not use an API key.');
    }
    if (apiKey && !this.encryptionAvailable) {
      throw new Error(`[storage_unavailable] ${this.encryptionUnavailableReason()}`);
    }
    const file = await this.load();
    const customProviders = file.customProviders ?? {};
    const label = PROTOCOL_LABELS[protocol];
    let slug: string;
    let existing: CustomProviderRecord | undefined;
    if (input.id !== undefined) {
      if (typeof input.id !== 'string' || !input.id.startsWith(CUSTOM_ID_PREFIX)) {
        throw new Error('Custom provider ids must use the "custom:" prefix.');
      }
      slug = input.id.slice(CUSTOM_ID_PREFIX.length);
      existing = customProviders[slug];
      if (!existing) {
        throw new Error(`Custom provider "${input.id}" does not exist.`);
      }
      if (protocol !== existing.protocol) {
        throw new Error('The protocol of a custom provider cannot change after it was created.');
      }
    } else {
      // Creation validates the per-protocol requirements: there is no catalog
      // default model for a custom endpoint, so one must be named explicitly.
      if (protocol !== 'ollama' && !apiKey) {
        throw new Error(`Custom ${label} providers require an API key.`);
      }
      if ((protocol === 'azure-openai' || protocol === 'openai-compatible') && !baseUrl) {
        throw new Error(`Custom ${label} providers require a base URL.`);
      }
      if (protocol !== 'ollama' && !modelOverride) {
        throw new Error('Custom providers require a model override; there is no default model for a custom endpoint.');
      }
      slug = uniqueCustomSlug(slugifyDisplayName(displayName), new Set(Object.keys(customProviders)));
    }
    let apiKeyEnc: string | undefined;
    if (apiKey) {
      const encrypted = encryptSecret(this.backend, apiKey);
      if (!encrypted) {
        throw new Error('[storage_unavailable] The OS credential store refused the API key; nothing was written.');
      }
      apiKeyEnc = encrypted;
    }
    const now = new Date().toISOString();
    // A custom record survives with zero credentials: the definition itself is
    // the provider, so the built-in "everything empty deletes the entry" rule
    // does not apply here.
    const record: CustomProviderRecord = existing
      ? {
          ...existing,
          displayName,
          apiKeyEnc: apiKey ? apiKeyEnc : input.apiKey === '' ? undefined : existing.apiKeyEnc,
          baseUrl: baseUrl ?? (input.baseUrl === '' ? undefined : existing.baseUrl),
          modelOverride: modelOverride ?? (input.modelOverride === '' ? undefined : existing.modelOverride),
          updatedAt: now,
        }
      : {
          displayName,
          protocol,
          apiKeyEnc,
          baseUrl,
          modelOverride,
          createdAt: now,
          updatedAt: now,
        };
    file.customProviders = { ...customProviders, [slug]: record };
    await this.persist(file);
    return { id: `${CUSTOM_ID_PREFIX}${slug}` };
  }

  async removeProviderCredential(provider: AiProviderId): Promise<void> {
    const customSlug = customSlugFromId(provider);
    const file = await this.load();
    if (customSlug) {
      if (file.customProviders?.[customSlug]) {
        delete file.customProviders[customSlug];
        await this.persist(file);
      }
      return;
    }
    if (!isSafeProviderKey(provider)) return;
    if (file.providers[provider]) {
      delete file.providers[provider];
      await this.persist(file);
    }
  }

  /** Decrypted in-memory view; never persisted and never logged. */
  async getProviderCredential(provider: AiProviderId): Promise<DecodedProviderCredential> {
    const file = await this.load();
    const customSlug = customSlugFromId(provider);
    if (customSlug) {
      const record = file.customProviders?.[customSlug];
      if (!record) return {};
      return {
        apiKey: this.decodeApiKey(record.apiKeyEnc),
        baseUrl: record.baseUrl,
        modelOverride: record.modelOverride,
      };
    }
    if (!isSafeProviderKey(provider)) return {};
    const entry = file.providers[provider];
    if (!entry) return {};
    return {
      apiKey: this.decodeApiKey(entry.apiKeyEnc),
      baseUrl: entry.baseUrl,
      modelOverride: entry.modelOverride,
    };
  }

  private decodeApiKey(apiKeyEnc: string | undefined): string | undefined {
    if (!apiKeyEnc) return undefined;
    // Decrypt failures (rotated keychain) drop the key instead of failing callers.
    return decryptSecret(this.backend, apiKeyEnc) ?? undefined;
  }

  /**
   * Single-load snapshot for status paths that need every provider at once:
   * one file read decrypts all built-in credentials and lists the custom
   * definitions (plus their decrypted keys, keyed by full `custom:<slug>` id)
   * so callers avoid one `getProviderCredential` read per provider. The result
   * is a decrypted in-memory view only: never persisted and never logged.
   */
  async getDecodedSnapshot(): Promise<{
    builtIns: Partial<Record<AiHttpProvider, DecodedProviderCredential>>;
    customProviders: AiCustomProviderInfo[];
    customCredentials: Record<string, DecodedProviderCredential>;
  }> {
    const file = await this.load();
    const builtIns: Partial<Record<AiHttpProvider, DecodedProviderCredential>> = {};
    for (const provider of Object.keys(file.providers) as AiHttpProvider[]) {
      const entry = file.providers[provider];
      if (!entry) continue;
      builtIns[provider] = {
        apiKey: this.decodeApiKey(entry.apiKeyEnc),
        baseUrl: entry.baseUrl,
        modelOverride: entry.modelOverride,
      };
    }
    const entries = Object.entries(file.customProviders ?? {});
    entries.sort(([slugA, a], [slugB, b]) => {
      const timeA = Date.parse(a.createdAt) || 0;
      const timeB = Date.parse(b.createdAt) || 0;
      if (timeA !== timeB) return timeA - timeB;
      return slugA.localeCompare(slugB);
    });
    const customCredentials: Record<string, DecodedProviderCredential> = {};
    const customProviders = entries.map(([slug, record]) => {
      customCredentials[`${CUSTOM_ID_PREFIX}${slug}`] = {
        apiKey: this.decodeApiKey(record.apiKeyEnc),
        baseUrl: record.baseUrl,
        modelOverride: record.modelOverride,
      };
      return toCustomProviderInfo(slug, record);
    });
    return { builtIns, customProviders, customCredentials };
  }

  /** Custom provider definitions, ordered by createdAt then slug for stability. */
  async listCustomProviders(): Promise<AiCustomProviderInfo[]> {
    const file = await this.load();
    const entries = Object.entries(file.customProviders ?? {});
    entries.sort(([slugA, a], [slugB, b]) => {
      const timeA = Date.parse(a.createdAt) || 0;
      const timeB = Date.parse(b.createdAt) || 0;
      if (timeA !== timeB) return timeA - timeB;
      return slugA.localeCompare(slugB);
    });
    return entries.map(([slug, record]) => toCustomProviderInfo(slug, record));
  }

  async getCustomProviderInfo(provider: AiProviderId): Promise<AiCustomProviderInfo | undefined> {
    const slug = customSlugFromId(provider);
    if (!slug) return undefined;
    const record = (await this.load()).customProviders?.[slug];
    return record ? toCustomProviderInfo(slug, record) : undefined;
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
    for (const [slug, record] of Object.entries(file.customProviders ?? {})) {
      providers.push({
        provider: `${CUSTOM_ID_PREFIX}${slug}`,
        hasApiKey: Boolean(record.apiKeyEnc),
        hasBaseUrl: Boolean(record.baseUrl),
        baseUrl: record.baseUrl,
        modelOverride: record.modelOverride,
        updatedAt: record.updatedAt,
        displayName: record.displayName,
        protocol: record.protocol,
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
    for (const record of Object.values(file.customProviders ?? {})) {
      if (record?.apiKeyEnc) {
        const decrypted = decryptSecret(this.backend, record.apiKeyEnc);
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
