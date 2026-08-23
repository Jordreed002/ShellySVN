import type {
  AiCustomProviderProtocol,
  AiHttpProvider,
  AiProviderId,
} from '@shared/types';

/** Runtime configuration resolved from the encrypted credential store. */
export interface HttpProviderRuntimeConfig {
  provider: AiProviderId;
  /**
   * Wire protocol the provider speaks; selects the adapter and drives config
   * validation and model defaults. Equals the built-in id for built-ins and
   * the user-chosen protocol for `custom:*` providers.
   */
  protocol: AiCustomProviderProtocol;
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
}

/** A fully built HTTP request, ready for the shared client. */
export interface ProviderHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface ProviderTaskInput {
  prompt: string;
  /** JSON schema the provider is asked to satisfy (embedded in the instruction). */
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  /** Operation abort signal (cancellation); honored mid-stream. */
  signal: AbortSignal;
  /** Invoked for every streamed assistant delta. */
  onDelta: (delta: string) => void;
}

/** Fetch implementation seam so tests can serve canned SSE responses. */
export type ProviderFetch = typeof globalThis.fetch;

/** True for user-defined provider ids (`custom:<slug>`). */
export function isCustomProviderId(id: string): id is `custom:${string}` {
  return id.startsWith('custom:');
}

export function isHttpAiProvider(provider: AiProviderId): provider is AiHttpProvider {
  return (
    provider === 'anthropic' ||
    provider === 'azure-openai' ||
    provider === 'openai-compatible' ||
    provider === 'ollama'
  );
}

/** True for every provider served by the HTTP adapter registry (built-in or custom). */
export function isHttpProviderId(id: AiProviderId): boolean {
  return isCustomProviderId(id) || isHttpAiProvider(id);
}

/** Built-in HTTP providers, in auto-selection order. */
export const HTTP_PROVIDER_ORDER: readonly AiHttpProvider[] = [
  'anthropic',
  'azure-openai',
  'openai-compatible',
  'ollama',
] as const;
