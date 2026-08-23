import { describe, expect, it } from 'vitest';
import {
  catalogModelsForProvider,
  defaultModelForProtocol,
  defaultModelForProvider,
  estimateAiCost,
  estimateTokensFromChars,
  getModelPricing,
} from '../ai-providers/model-catalog';
import { getHttpProviderAdapter, httpProviderConfigError, httpProviderModel, resolveAdapter } from '../ai-providers';
import type { HttpProviderRuntimeConfig } from '../ai-providers/types';
import { isCustomProviderId, isHttpProviderId } from '../ai-providers/types';
import {
  buildAnthropicRequest,
  resolveAnthropicUrl,
} from '../ai-providers/anthropic';
import {
  resolveAzureUrl,
  resolveOllamaChatUrl,
  resolveOpenAiCompatibleUrl,
  buildOpenAiCompatibleChatRequest,
  buildAzureChatRequest,
  buildOllamaChatRequest,
} from '../ai-providers/openai-chat';
import { buildOllamaTagsRequest, parseOllamaTags, resolveOllamaTagsUrl } from '../ai-providers/ollama';

describe('model catalog and pricing (#109)', () => {
  it('returns generous zeros for unknown models and real pricing for known ones', () => {
    expect(getModelPricing('totally-unknown-model')).toEqual({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });
    expect(getModelPricing('claude-sonnet-4-5')).toEqual({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 });
    expect(getModelPricing('gpt-4o-mini')).toEqual({ inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 });
  });

  it('estimates tokens with the chars/4 heuristic and computes cost', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(4_000)).toBe(1_000);
    const estimate = estimateAiCost('anthropic', 'claude-sonnet-4-5', 4_000);
    expect(estimate.estimatedInputTokens).toBe(1_000);
    expect(estimate.pricingKnown).toBe(true);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    const unknown = estimateAiCost('openai-compatible', 'custom-local-model', 4_000);
    expect(unknown.pricingKnown).toBe(false);
    expect(unknown.estimatedCostUsd).toBe(0);
    const local = estimateAiCost('ollama', 'llama3.1', 100_000);
    expect(local.estimatedCostUsd).toBe(0);
  });

  it('defaults and catalogs every HTTP provider', () => {
    expect(defaultModelForProvider('anthropic')).toBe('claude-sonnet-4-5');
    expect(defaultModelForProvider('azure-openai')).toBe('gpt-4o');
    expect(defaultModelForProvider('openai-compatible')).toBe('gpt-4o-mini');
    expect(defaultModelForProvider('ollama')).toBe('llama3.1');
    for (const provider of ['anthropic', 'azure-openai', 'openai-compatible', 'ollama'] as const) {
      const models = catalogModelsForProvider(provider);
      expect(models.length).toBeGreaterThan(0);
      expect(models.filter((model) => model.defaultForProvider)).toHaveLength(1);
    }
  });

  it('resolves defaults, catalogs, and adapters by wire protocol for custom providers', () => {
    expect(defaultModelForProtocol('anthropic')).toBe(defaultModelForProvider('anthropic'));
    expect(defaultModelForProtocol('azure-openai')).toBe(defaultModelForProvider('azure-openai'));
    expect(defaultModelForProtocol('openai-compatible')).toBe(defaultModelForProvider('openai-compatible'));
    expect(defaultModelForProtocol('ollama')).toBe(defaultModelForProvider('ollama'));

    // A custom provider gets the protocol catalog re-tagged with its own id.
    const custom = catalogModelsForProvider('custom:acme', 'anthropic');
    const builtIn = catalogModelsForProvider('anthropic');
    expect(custom.map((model) => model.id)).toEqual(builtIn.map((model) => model.id));
    expect(custom.every((model) => model.provider === 'custom:acme')).toBe(true);
    expect(custom.filter((model) => model.defaultForProvider)).toHaveLength(1);
    // Without a protocol the custom id alone cannot resolve a catalog.
    expect(catalogModelsForProvider('custom:acme')).toEqual([]);

    const adapterConfig: HttpProviderRuntimeConfig = {
      provider: 'custom:acme',
      protocol: 'openai-compatible',
    };
    expect(resolveAdapter(adapterConfig)).toBe(getHttpProviderAdapter('openai-compatible'));
    expect(httpProviderModel(adapterConfig)).toBe('gpt-4o-mini');
    expect(
      httpProviderModel({ ...adapterConfig, modelOverride: 'acme-model' })
    ).toBe('acme-model');
  });

  it('classifies ids and validates custom provider configs per protocol', () => {
    expect(isCustomProviderId('custom:acme')).toBe(true);
    expect(isCustomProviderId('anthropic')).toBe(false);
    expect(isHttpProviderId('custom:acme')).toBe(true);
    expect(isHttpProviderId('anthropic')).toBe(true);
    expect(isHttpProviderId('codex')).toBe(false);

    const anthropicCustom: HttpProviderRuntimeConfig = {
      provider: 'custom:acme',
      protocol: 'anthropic',
      baseUrl: 'https://proxy.internal',
    };
    expect(httpProviderConfigError('custom:acme', anthropicCustom)).toMatch(
      /^\[authentication_required\]/
    );
    const azureCustom: HttpProviderRuntimeConfig = {
      provider: 'custom:acme-azure',
      protocol: 'azure-openai',
      apiKey: 'key-1',
    };
    expect(httpProviderConfigError('custom:acme-azure', azureCustom)).toMatch(
      /^\[provider_unavailable\]/
    );
    // Ollama needs neither key nor URL; a missing model is NOT a config error
    // (model defaulting happens at request time).
    const ollamaCustom: HttpProviderRuntimeConfig = { provider: 'custom:acme-local', protocol: 'ollama' };
    expect(httpProviderConfigError('custom:acme-local', ollamaCustom)).toBeUndefined();
  });

  it('knows pricing for custom providers only when the model id matches', () => {
    const known = estimateAiCost('custom:acme', 'claude-sonnet-4-5', 4_000);
    expect(known.pricingKnown).toBe(true);
    expect(known.provider).toBe('custom:acme');
    const unknown = estimateAiCost('custom:acme', 'acme-private-model', 4_000);
    expect(unknown.pricingKnown).toBe(false);
    expect(unknown.estimatedCostUsd).toBe(0);
  });
});

describe('provider URL and request building (#108)', () => {
  it('targets the Anthropic messages endpoint with the version header', () => {
    expect(resolveAnthropicUrl()).toBe('https://api.anthropic.com/v1/messages');
    expect(resolveAnthropicUrl('https://proxy.internal/')).toBe('https://proxy.internal/v1/messages');
    const request = buildAnthropicRequest(
      { provider: 'anthropic', protocol: 'anthropic', apiKey: 'key-1' },
      { prompt: 'p', outputSchema: {}, timeoutMs: 1_000, signal: new AbortController().signal, onDelta: () => undefined }
    );
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers['x-api-key']).toBe('key-1');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(request.body ?? '{}').stream).toBe(true);
  });

  it('normalizes OpenAI-compatible and Ollama base URLs to chat completions', () => {
    expect(resolveOpenAiCompatibleUrl()).toBe('https://api.openai.com/v1/chat/completions');
    expect(resolveOpenAiCompatibleUrl('https://llama.local/v1')).toBe('https://llama.local/v1/chat/completions');
    expect(resolveOpenAiCompatibleUrl('https://llama.local')).toBe('https://llama.local/v1/chat/completions');
    expect(resolveOllamaChatUrl()).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(resolveOllamaChatUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('appends the api-version query to Azure deployment URLs', () => {
    expect(resolveAzureUrl('https://res.openai.azure.com/openai/deployments/gpt-4o')).toBe(
      'https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21'
    );
    expect(
      resolveAzureUrl('https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01')
    ).toBe('https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01');
  });

  it('authenticates each provider shape differently and honors model overrides', () => {
    const task = { prompt: 'p', outputSchema: { type: 'object' }, timeoutMs: 1_000, signal: new AbortController().signal, onDelta: () => undefined };
    expect(buildOpenAiCompatibleChatRequest({ provider: 'openai-compatible', protocol: 'openai-compatible', apiKey: 'k', baseUrl: 'https://api.vendor.io/v1' }, task).headers.authorization).toBe('Bearer k');
    expect(buildAzureChatRequest({ provider: 'azure-openai', protocol: 'azure-openai', apiKey: 'az' , baseUrl: 'https://res.openai.azure.com/openai/deployments/gpt-4o' }, task).headers['api-key']).toBe('az');
    const ollama = buildOllamaChatRequest({ provider: 'ollama', protocol: 'ollama', modelOverride: 'qwen2.5-coder' }, task);
    expect(ollama.headers.authorization).toBeUndefined();
    expect(JSON.parse(ollama.body ?? '{}').model).toBe('qwen2.5-coder');
  });

  it('lists Ollama models from /api/tags with deduplication and size labels', () => {
    expect(resolveOllamaTagsUrl()).toBe('http://127.0.0.1:11434/api/tags');
    expect(resolveOllamaTagsUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/api/tags');
    expect(buildOllamaTagsRequest().method).toBe('GET');
    const models = parseOllamaTags(
      JSON.stringify({
        models: [
          { name: 'llama3.1', details: { parameter_size: '8B' } },
          { name: 'llama3.1' },
          { name: 'qwen2.5-coder' },
          null,
        ],
      })
    );
    expect(models.map((model) => model.id)).toEqual(['llama3.1', 'qwen2.5-coder']);
    expect(models[0].label).toBe('llama3.1 · 8B');
    expect(models[0]).toMatchObject({ provider: 'ollama', local: true, dynamic: true });
    expect(parseOllamaTags('not json')).toEqual([]);
  });
});
