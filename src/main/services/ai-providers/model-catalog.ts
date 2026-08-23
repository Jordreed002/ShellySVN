import type {
  AiCostEstimate,
  AiCustomProviderProtocol,
  AiHttpProvider,
  AiModelInfo,
  AiProviderId,
} from '@shared/types';
import { isHttpAiProvider } from './types';

/** USD per one million tokens. Unknown models get generous zeros. */
export interface AiModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const MODEL_PRICING: Record<string, AiModelPricing> = {
  // Anthropic
  'claude-opus-4-5': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-opus-4-1': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-sonnet-4-5': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-sonnet-4': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-3-7-sonnet-latest': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-3-5-sonnet-latest': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-haiku-4-5': { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  'claude-3-5-haiku-latest': { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 },
  // OpenAI / Azure OpenAI
  'gpt-4o': { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
  'gpt-4o-mini': { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
  'gpt-4.1': { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  'gpt-4.1-mini': { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
  'gpt-4.1-nano': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  'o3': { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  'o4-mini': { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  // Codex CLI models run through the signed-in CLI; pricing is not published here.
};

const PROTOCOL_DEFAULT_MODEL: Record<AiCustomProviderProtocol, string> = {
  anthropic: 'claude-sonnet-4-5',
  'azure-openai': 'gpt-4o',
  'openai-compatible': 'gpt-4o-mini',
  ollama: 'llama3.1',
};

export interface AiModelCatalogEntry extends AiModelInfo {
  provider: AiHttpProvider;
}

const CATALOG: readonly AiModelCatalogEntry[] = [
  {
    id: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5 (default)',
    provider: 'anthropic',
    local: false,
    contextTokens: 200_000,
    defaultForProvider: true,
  },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'anthropic', local: false, contextTokens: 200_000 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', local: false, contextTokens: 200_000 },
  {
    id: 'claude-3-7-sonnet-latest',
    label: 'Claude 3.7 Sonnet (latest alias)',
    provider: 'anthropic',
    local: false,
    contextTokens: 200_000,
  },
  { id: 'gpt-4o', label: 'GPT-4o (default)', provider: 'azure-openai', local: false, defaultForProvider: true },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'azure-openai', local: false },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'azure-openai', local: false },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'azure-openai', local: false },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini (default)',
    provider: 'openai-compatible',
    local: false,
    defaultForProvider: true,
  },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai-compatible', local: false },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai-compatible', local: false },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'openai-compatible', local: false },
  {
    id: 'llama3.1',
    label: 'Llama 3.1 (default)',
    provider: 'ollama',
    local: true,
    defaultForProvider: true,
  },
  { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', provider: 'ollama', local: true },
  { id: 'mistral', label: 'Mistral', provider: 'ollama', local: true },
  { id: 'phi4', label: 'Phi-4', provider: 'ollama', local: true },
];

export function getModelPricing(model: string | undefined): AiModelPricing {
  if (!model) return { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  return MODEL_PRICING[model] ?? { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
}

/** Default model for a wire protocol (identical for built-in and custom providers). */
export function defaultModelForProtocol(protocol: AiCustomProviderProtocol): string {
  return PROTOCOL_DEFAULT_MODEL[protocol];
}

export function defaultModelForProvider(provider: AiHttpProvider): string {
  return defaultModelForProtocol(provider);
}

/**
 * Catalog suggestions for a provider. Custom providers pass their wire
 * `protocol` and receive that protocol's catalog re-tagged with the custom id,
 * so the renderer can key models by the actual provider.
 */
export function catalogModelsForProvider(
  provider: AiProviderId,
  protocol?: AiCustomProviderProtocol
): AiModelInfo[] {
  // Without an explicit protocol only built-ins can be resolved; the catalog
  // intentionally has no codex/claude entries (CLI models are fixed elsewhere).
  const wireProtocol = protocol ?? (isHttpAiProvider(provider) ? provider : undefined);
  if (!wireProtocol) return [];
  return CATALOG.filter((entry) => entry.provider === wireProtocol).map(
    ({ id, label, local, contextTokens, defaultForProvider }) => ({
      id,
      label,
      provider,
      local,
      contextTokens,
      defaultForProvider,
    })
  );
}

/** ~4 characters per token heuristic used for pre-send estimates. */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function assumedOutputTokens(inputTokens: number): number {
  return Math.min(Math.max(256, Math.floor(inputTokens / 8)), 2048);
}

/**
 * Pre-send cost estimate. Pricing is keyed purely by model id, so a custom
 * provider only reports `pricingKnown` when its model matches a known entry.
 */
export function estimateAiCost(
  provider: AiProviderId,
  model: string,
  inputChars: number,
  outputChars?: number
): AiCostEstimate {
  const safeInputChars = Math.max(0, Math.floor(inputChars));
  const inputTokens = estimateTokensFromChars(safeInputChars);
  const outputTokens =
    outputChars === undefined ? assumedOutputTokens(inputTokens) : estimateTokensFromChars(outputChars);
  const pricing = getModelPricing(model);
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return {
    provider,
    model,
    inputChars: safeInputChars,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    inputUsdPerMillion: pricing.inputUsdPerMillion,
    outputUsdPerMillion: pricing.outputUsdPerMillion,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    pricingKnown: Boolean(MODEL_PRICING[model]),
  };
}
