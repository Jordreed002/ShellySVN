/**
 * AI provider settings section — state machine with a mocked window.api.ai.
 *
 * The things worth defending: the storage-unavailable state surfaces the main
 * process reason verbatim and disables key saving; API keys are write-only
 * (never rendered back — set/unset comes from the summary); and the model +
 * cost preview call the documented IPC shapes.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiCommitProviderStatus,
  AiCostEstimate,
  AiCredentialsSummary,
} from '@shared/types';

import { AiProviderSettings } from '../AiProviderSettings';

const providers = vi.fn();
const summary = vi.fn();
const save = vi.fn();
const remove = vi.fn();
const listModels = vi.fn();
const estimateCost = vi.fn();

const httpStatus = (provider: string, overrides: Partial<AiCommitProviderStatus> = {}): AiCommitProviderStatus => ({
  provider: provider as AiCommitProviderStatus['provider'],
  available: false,
  kind: 'http',
  ...overrides,
});

function defaultSummary(overrides: Partial<AiCredentialsSummary> = {}): AiCredentialsSummary {
  return { encryptionAvailable: true, providers: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ai: {
        providers,
        credentials: { summary, save, remove },
        listModels,
        estimateCost,
      },
    },
  });
  providers.mockResolvedValue([
    httpStatus('anthropic', { available: true, version: 'cli-2.0' }),
    httpStatus('azure-openai'),
    httpStatus('openai-compatible'),
    httpStatus('ollama', { available: true }),
    { provider: 'codex', available: true, kind: 'cli', version: '0.9.1' },
    { provider: 'claude', available: false, kind: 'cli', reason: 'Not installed' },
  ]);
  summary.mockResolvedValue(defaultSummary());
  save.mockResolvedValue({ success: true });
  remove.mockResolvedValue({ success: true });
  listModels.mockResolvedValue([]);
  estimateCost.mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    inputChars: 10_000,
    estimatedInputTokens: 2_500,
    estimatedOutputTokens: 512,
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    estimatedCostUsd: 0.0152,
    pricingKnown: true,
  } satisfies AiCostEstimate);
});

afterEach(cleanup);

async function rendered() {
  const utils = render(<AiProviderSettings />);
  await waitFor(() => expect(screen.getByTestId('ai-provider-anthropic')).toBeInTheDocument());
  return utils;
}

describe('AiProviderSettings state machine', () => {
  it('renders every provider, split into HTTP and CLI groups', async () => {
    await rendered();
    expect(screen.getByTestId('ai-provider-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-azure-openai')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-openai-compatible')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-ollama')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-codex')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-claude')).toBeInTheDocument();
    // CLI providers are read-only — no key entry.
    expect(screen.queryByTestId('ai-api-key-codex')).not.toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
  });

  it('shows key set/unset from the credentials summary, never the key itself', async () => {
    summary.mockResolvedValue(
      defaultSummary({
        providers: [
          {
            provider: 'anthropic',
            hasApiKey: true,
            hasBaseUrl: false,
            updatedAt: '2026-08-01T10:00:00.000Z',
          },
        ],
      })
    );
    await rendered();
    expect(screen.getByTestId('ai-key-status-anthropic').textContent).toContain('Key set');
    expect(screen.getByTestId('ai-key-status-azure-openai').textContent).toContain('No key saved');
    const input = screen.getByTestId('ai-api-key-anthropic') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    expect(screen.queryByText(/sk-secret/i)).not.toBeInTheDocument();
  });

  it('saves a typed API key and clears the field afterwards', async () => {
    await rendered();
    const input = screen.getByTestId('ai-api-key-anthropic') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-secret' } });
    fireEvent.click(screen.getByTestId('ai-save-anthropic'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', apiKey: 'sk-secret' })
      )
    );
    // The refreshed card is a fresh node (the list re-mounts after reload) —
    // the key field must come back empty, never echoing the saved key.
    const refreshed = await screen.findByTestId('ai-api-key-anthropic');
    await waitFor(() => expect((refreshed as HTMLInputElement).value).toBe(''));
    expect(screen.getByTestId('ai-provider-message').textContent).toContain('saved');
  });

  it('surfaces a failed save as an error message', async () => {
    save.mockResolvedValue({ success: false, error: 'nope' });
    await rendered();
    fireEvent.change(screen.getByTestId('ai-api-key-anthropic'), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ai-save-anthropic'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-message').textContent).toContain('nope')
    );
  });

  it('shows base URL fields only for openai-compatible, azure, and ollama', async () => {
    await rendered();
    expect(screen.getByTestId('ai-base-url-openai-compatible')).toBeInTheDocument();
    expect(screen.getByTestId('ai-base-url-azure-openai')).toBeInTheDocument();
    expect(screen.getByTestId('ai-base-url-ollama')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-base-url-anthropic')).not.toBeInTheDocument();
  });

  it('rejects an invalid base URL client-side', async () => {
    await rendered();
    const input = screen.getByTestId('ai-base-url-openai-compatible');
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    expect(await screen.findByText(/must be a valid http\(s\) URL/i)).toBeInTheDocument();
    expect(screen.getByTestId('ai-save-openai-compatible')).toBeDisabled();
  });

  it('loads models on focus and lists them in the picker', async () => {
    listModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (default)', provider: 'anthropic', local: false, defaultForProvider: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', local: false },
    ]);
    await rendered();
    fireEvent.focus(screen.getByTestId('ai-model-anthropic'));
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('anthropic'));
    const options = (screen.getByTestId('ai-model-anthropic') as HTMLSelectElement).options;
    await waitFor(() => expect(options.length).toBe(3));
    expect(options[0].value).toBe('');
    expect(options[1].value).toBe('claude-sonnet-4-5');
  });

  it('previews the cost estimate for a sample 10k-char diff', async () => {
    await rendered();
    fireEvent.click(screen.getByTestId('ai-estimate-button-anthropic'));
    await waitFor(() => expect(estimateCost).toHaveBeenCalledWith({ provider: 'anthropic', inputChars: 10_000 }));
    const text = await waitFor(() => screen.getByTestId('ai-estimate-anthropic'));
    expect(text.textContent).toContain('10,000');
    expect(text.textContent).toContain('2,500');
    expect(text.textContent).toContain('$0.0152');
  });

  it('says pricing is unknown when the estimate has no pricing entry', async () => {
    estimateCost.mockResolvedValue({
      provider: 'ollama',
      model: 'llama3.1',
      inputChars: 10_000,
      estimatedInputTokens: 2_500,
      estimatedOutputTokens: 512,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      estimatedCostUsd: 0,
      pricingKnown: false,
    });
    await rendered();
    fireEvent.click(screen.getByTestId('ai-estimate-button-ollama'));
    const text = await waitFor(() => screen.getByTestId('ai-estimate-ollama'));
    expect(text.textContent).toContain('pricing unknown');
  });

  it('reports load failures without crashing', async () => {
    providers.mockRejectedValue(new Error('ipc down'));
    render(<AiProviderSettings />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});

describe('storage-unavailable state', () => {
  const reason =
    'OS-protected credential storage (safeStorage) is unavailable on this system, so API keys cannot be stored securely.';

  it('displays the storageUnavailableReason verbatim and disables key saving', async () => {
    summary.mockResolvedValue(defaultSummary({ encryptionAvailable: false, storageUnavailableReason: reason }));
    await rendered();
    const banner = screen.getByTestId('ai-storage-unavailable');
    expect(banner.textContent).toContain(reason);
    const input = screen.getByTestId('ai-api-key-anthropic') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-new' } });
    const saveButton = screen.getByTestId('ai-save-anthropic') as HTMLButtonElement;
    expect(saveButton).toBeDisabled();
    expect(saveButton.title).toContain('Secure storage is unavailable');
  });

  it('still allows saving when no key material is involved', async () => {
    summary.mockResolvedValue(defaultSummary({ encryptionAvailable: false, storageUnavailableReason: reason }));
    await rendered();
    // No typed key → the save button stays enabled (base URL / model config only).
    expect(screen.getByTestId('ai-save-openai-compatible')).not.toBeDisabled();
  });
});
