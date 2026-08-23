import type { AiCommitProvider, AiHttpProvider } from '@shared/types';

/** Runtime configuration resolved from the encrypted credential store. */
export interface HttpProviderRuntimeConfig {
  provider: AiHttpProvider;
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

export function isHttpAiProvider(provider: AiCommitProvider): provider is AiHttpProvider {
  return (
    provider === 'anthropic' ||
    provider === 'azure-openai' ||
    provider === 'openai-compatible' ||
    provider === 'ollama'
  );
}

export const HTTP_PROVIDER_ORDER: readonly AiHttpProvider[] = [
  'anthropic',
  'azure-openai',
  'openai-compatible',
  'ollama',
] as const;
