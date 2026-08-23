import type { AiHttpProvider, AiModelInfo } from '@shared/types';
import { OLLAMA_DEFAULT_BASE_URL } from './openai-chat';
import type { ProviderHttpRequest } from './types';

/** Ollama model listing via the native `/api/tags` endpoint. */

function normalizeBase(baseUrl?: string): string {
  return baseUrl?.trim().replace(/\/+$/, '') || OLLAMA_DEFAULT_BASE_URL;
}

/** `/api/tags` lives at the server root even when chat uses the `/v1` prefix. */
export function resolveOllamaTagsUrl(baseUrl?: string): string {
  const base = normalizeBase(baseUrl).replace(/\/v1$/, '');
  return `${base}/api/tags`;
}

export function buildOllamaTagsRequest(baseUrl?: string): ProviderHttpRequest {
  return {
    url: resolveOllamaTagsUrl(baseUrl),
    method: 'GET',
    headers: { accept: 'application/json' },
  };
}

export function parseOllamaTags(body: string, limit = 100): AiModelInfo[] {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return [];
  }
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const result: AiModelInfo[] = [];
  for (const entry of models.slice(0, limit)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string' || !name.trim() || seen.has(name)) continue;
    seen.add(name);
    const details = (entry as { details?: { parameter_size?: unknown } }).details;
    const parameterSize =
      typeof details?.parameter_size === 'string' ? ` · ${details.parameter_size}` : '';
    result.push({
      id: name,
      label: `${name}${parameterSize}`,
      provider: 'ollama' satisfies AiHttpProvider,
      local: true,
      dynamic: true,
    });
  }
  return result;
}
