import type {
  AiCustomProviderProtocol,
  AiHttpProvider,
  AiModelInfo,
  AiProviderId,
} from '@shared/types';
import { anthropicSseSemantics, buildAnthropicRequest } from './anthropic';
import {
  buildAzureChatRequest,
  buildOllamaChatRequest,
  buildOpenAiCompatibleChatRequest,
  openAiChatSseSemantics,
  OLLAMA_DEFAULT_BASE_URL,
} from './openai-chat';
import { buildOllamaTagsRequest, parseOllamaTags } from './ollama';
import { callHttpProvider, HttpProviderError, streamHttpProvider, type SseEventSemantics } from './http-client';
import { catalogModelsForProvider, defaultModelForProtocol } from './model-catalog';
import type { HttpProviderRuntimeConfig, ProviderHttpRequest, ProviderTaskInput } from './types';

export interface HttpProviderAdapter {
  buildRequest(config: HttpProviderRuntimeConfig, task: ProviderTaskInput): ProviderHttpRequest;
  sse: SseEventSemantics;
  /** Whether the provider needs an API key from the credential store. */
  needsApiKey: boolean;
  /** Whether the provider needs an explicit base URL. */
  needsBaseUrl: boolean;
}

const ADAPTERS: Record<AiCustomProviderProtocol, HttpProviderAdapter> = {
  anthropic: { buildRequest: buildAnthropicRequest, sse: anthropicSseSemantics, needsApiKey: true, needsBaseUrl: false },
  'azure-openai': { buildRequest: buildAzureChatRequest, sse: openAiChatSseSemantics, needsApiKey: true, needsBaseUrl: true },
  'openai-compatible': {
    buildRequest: buildOpenAiCompatibleChatRequest,
    sse: openAiChatSseSemantics,
    needsApiKey: true,
    needsBaseUrl: true,
  },
  ollama: { buildRequest: buildOllamaChatRequest, sse: openAiChatSseSemantics, needsApiKey: false, needsBaseUrl: false },
};

/** Adapter lookup keys off the wire protocol; `config.provider` is only an id. */
export function resolveAdapter(config: HttpProviderRuntimeConfig): HttpProviderAdapter {
  return ADAPTERS[config.protocol];
}

export function getHttpProviderAdapter(provider: AiHttpProvider): HttpProviderAdapter {
  return ADAPTERS[provider];
}

export function httpProviderModel(config: HttpProviderRuntimeConfig): string {
  return config.modelOverride?.trim() || defaultModelForProtocol(config.protocol);
}

/** Static credential requirements a provider must satisfy before a call. */
export function httpProviderConfigError(
  _provider: AiProviderId,
  config: HttpProviderRuntimeConfig
): string | undefined {
  // The provider id is kept for a stable call signature; validation keys off
  // the wire protocol so built-ins and custom providers share one code path.
  const adapter = resolveAdapter(config);
  if (adapter.needsApiKey && !config.apiKey?.trim()) {
    return `[authentication_required] Save an API key for this provider in ShellySVN AI provider settings.`;
  }
  if (adapter.needsBaseUrl && !config.baseUrl?.trim()) {
    return `[provider_unavailable] Configure the provider base URL in ShellySVN AI provider settings.`;
  }
  return undefined;
}

export interface HttpProviderTaskResult {
  text: string;
  model: string;
}

/**
 * Run one structured-output task against an HTTP provider, streaming deltas
 * through `task.onDelta` as they arrive.
 */
export async function executeHttpProviderTask(
  config: HttpProviderRuntimeConfig,
  task: ProviderTaskInput
): Promise<HttpProviderTaskResult> {
  const adapter = resolveAdapter(config);
  const model = httpProviderModel(config);
  const request = adapter.buildRequest(config, task);
  const text = await streamHttpProvider({
    request,
    timeoutMs: task.timeoutMs,
    signal: task.signal,
    sse: adapter.sse,
    onDelta: task.onDelta,
    secrets: config.apiKey ? [config.apiKey] : [],
  });
  return { text, model };
}

/**
 * List selectable models for a provider (live /api/tags for any
 * ollama-protocol provider — built-in or custom — catalog otherwise).
 * Returned entries always carry the ACTUAL provider id so the renderer can
 * key them.
 */
export async function listHttpProviderModels(
  provider: AiProviderId,
  config: HttpProviderRuntimeConfig
): Promise<AiModelInfo[]> {
  if (config.protocol === 'ollama') {
    try {
      const { status, body } = await callHttpProvider({
        request: buildOllamaTagsRequest(config.baseUrl),
        timeoutMs: 3_000,
        retries: 0,
      });
      if (status >= 200 && status < 300) {
        const live = parseOllamaTags(body);
        if (live.length > 0) {
          return live.map((model) => ({ ...model, provider }));
        }
      }
    } catch {
      // Fall back to the static catalog when no local server answers.
    }
  }
  return catalogModelsForProvider(provider, config.protocol);
}

/** Cheap reachability probe used for provider status and auto selection. */
export async function isOllamaReachable(baseUrl?: string): Promise<boolean> {
  try {
    const { status } = await callHttpProvider({
      request: buildOllamaTagsRequest(baseUrl ?? OLLAMA_DEFAULT_BASE_URL),
      timeoutMs: 1_500,
      retries: 0,
    });
    return status >= 200 && status < 500;
  } catch (error) {
    // Any completed HTTP response (even 4xx) proves a server is listening.
    if (error instanceof HttpProviderError && error.status !== undefined && error.status < 500) {
      return true;
    }
    return false;
  }
}
