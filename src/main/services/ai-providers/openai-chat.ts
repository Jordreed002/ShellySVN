import type { HttpProviderRuntimeConfig, ProviderHttpRequest, ProviderTaskInput } from './types';
import { defaultModelForProvider } from './model-catalog';
import type { SseEventSemantics } from './http-client';
import { structuredOutputSystemInstruction } from './anthropic';

/** Azure OpenAI default API version appended to deployment URLs when missing. */
export const AZURE_DEFAULT_API_VERSION = '2024-10-21';

export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

function trimBase(baseUrl: string | undefined, fallback: string): string {
  return baseUrl?.trim().replace(/\/+$/, '') || fallback;
}

function chatCompletionsUrl(base: string): string {
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Normalizes any custom base URL to a chat-completions endpoint. */
export function resolveOpenAiCompatibleUrl(baseUrl?: string): string {
  return chatCompletionsUrl(trimBase(baseUrl, OPENAI_COMPATIBLE_DEFAULT_BASE_URL));
}

/** Accepts `https://<res>.openai.azure.com/openai/deployments/<dep>` (deployment URL form). */
export function resolveAzureUrl(baseUrl?: string): string {
  const base = trimBase(baseUrl, '');
  if (!base) return '';
  let url = base;
  if (!/\/chat\/completions(?:\?|$)/.test(url)) url = `${url}/chat/completions`;
  // Omit `/openai/deployments/...` handling beyond passthrough; api-version is required.
  if (!/[?&]api-version=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + `api-version=${AZURE_DEFAULT_API_VERSION}`;
  }
  return url;
}

/** Ollama/LM Studio: OpenAI-compatible chat endpoint on a local server. */
export function resolveOllamaChatUrl(baseUrl?: string): string {
  return chatCompletionsUrl(trimBase(baseUrl, OLLAMA_DEFAULT_BASE_URL));
}

export function buildOpenAiCompatibleChatRequest(
  config: HttpProviderRuntimeConfig,
  task: ProviderTaskInput
): ProviderHttpRequest {
  const model = config.modelOverride?.trim() || defaultModelForProvider('openai-compatible');
  return {
    url: resolveOpenAiCompatibleUrl(config.baseUrl),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${config.apiKey ?? ''}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: structuredOutputSystemInstruction(task.outputSchema) },
        { role: 'user', content: task.prompt },
      ],
    }),
  };
}

export function buildAzureChatRequest(
  config: HttpProviderRuntimeConfig,
  task: ProviderTaskInput
): ProviderHttpRequest {
  const model = config.modelOverride?.trim() || defaultModelForProvider('azure-openai');
  return {
    url: resolveAzureUrl(config.baseUrl),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'api-key': config.apiKey ?? '',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: structuredOutputSystemInstruction(task.outputSchema) },
        { role: 'user', content: task.prompt },
      ],
    }),
  };
}

export function buildOllamaChatRequest(
  config: HttpProviderRuntimeConfig,
  task: ProviderTaskInput
): ProviderHttpRequest {
  const model = config.modelOverride?.trim() || defaultModelForProvider('ollama');
  return {
    url: resolveOllamaChatUrl(config.baseUrl),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: structuredOutputSystemInstruction(task.outputSchema) },
        { role: 'user', content: task.prompt },
      ],
    }),
  };
}

/** OpenAI chat-completions streaming chunks (choices[0].delta.content). */
export const openAiChatSseSemantics: SseEventSemantics = {
  extractDelta(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const chunk = payload as { choices?: Array<{ delta?: { content?: unknown } }> };
    const content = chunk.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : undefined;
  },
  extractError(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const chunk = payload as { error?: { message?: unknown } };
    if (chunk.error === undefined) return undefined;
    return typeof chunk.error?.message === 'string' ? chunk.error.message : 'Provider stream error.';
  },
};
