/**
 * AI provider settings section — state machine with a mocked window.api.ai.
 *
 * The page renders only configured providers as cards (built-ins with a
 * credentials-summary entry plus every custom provider) and moves all setup
 * into the Add Provider dialog. The things worth defending: the
 * storage-unavailable state surfaces the main process reason verbatim and
 * disables key saving; API keys are write-only (never rendered back —
 * set/unset comes from the summary); custom cards rename via
 * `customProviders.upsert` and delete via `credentials.remove(customId)`; and
 * the model + cost preview call the documented IPC shapes.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiCommitProviderStatus,
  AiCostEstimate,
  AiCredentialsSummary,
  AiProviderCredentialStatus,
} from '@shared/types';

import { AiProviderSettings } from '../AiProviderSettings';

const providers = vi.fn();
const summary = vi.fn();
const save = vi.fn();
const remove = vi.fn();
const upsert = vi.fn();
const listModels = vi.fn();
const estimateCost = vi.fn();

const httpStatus = (provider: string, overrides: Partial<AiCommitProviderStatus> = {}): AiCommitProviderStatus => ({
  provider: provider as AiCommitProviderStatus['provider'],
  available: false,
  kind: 'http',
  ...overrides,
});

function credential(
  provider: string,
  overrides: Partial<AiProviderCredentialStatus> = {}
): AiProviderCredentialStatus {
  return { provider: provider as AiProviderCredentialStatus['provider'], hasApiKey: false, hasBaseUrl: false, ...overrides };
}

/** Every built-in HTTP provider configured — closest to the pre-dialog page. */
function allBuiltInsSummary(overrides: Partial<AiCredentialsSummary> = {}): AiCredentialsSummary {
  return {
    encryptionAvailable: true,
    providers: ['anthropic', 'azure-openai', 'openai-compatible', 'ollama'].map((id) => credential(id)),
    ...overrides,
  };
}

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
        customProviders: { upsert },
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
  summary.mockResolvedValue(allBuiltInsSummary());
  save.mockResolvedValue({ success: true });
  remove.mockResolvedValue({ success: true });
  upsert.mockResolvedValue({ success: true, id: 'custom:new' });
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
  render(<AiProviderSettings />);
  await waitFor(() => expect(screen.getByTestId('ai-add-provider-open')).toBeInTheDocument());
}

describe('AiProviderSettings configured-card model', () => {
  it('shows the empty state and Add button when nothing is configured; CLI rows still render', async () => {
    summary.mockResolvedValue(defaultSummary());
    await rendered();
    expect(screen.getByTestId('ai-providers-empty')).toBeInTheDocument();
    expect(screen.getByTestId('ai-add-provider-open')).toBeInTheDocument();
    // Unconfigured built-ins no longer render cards.
    expect(screen.queryByTestId('ai-provider-anthropic')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-azure-openai')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-openai-compatible')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-ollama')).not.toBeInTheDocument();
    // CLI providers are read-only — no key entry.
    expect(screen.getByTestId('ai-provider-codex')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-claude')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-api-key-codex')).not.toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
  });

  it('renders a card only for a configured built-in', async () => {
    summary.mockResolvedValue(defaultSummary({ providers: [credential('anthropic')] }));
    await rendered();
    expect(screen.getByTestId('ai-provider-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('ai-api-key-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('ai-model-anthropic')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-azure-openai')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-openai-compatible')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-provider-ollama')).not.toBeInTheDocument();
  });

  it('shows key set/unset from the credentials summary, never the key itself', async () => {
    summary.mockResolvedValue(
      allBuiltInsSummary({
        providers: [
          credential('anthropic', { hasApiKey: true, updatedAt: '2026-08-01T10:00:00.000Z' }),
          credential('azure-openai'),
          credential('openai-compatible'),
          credential('ollama'),
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

  it('paints from the summary while the status probe is pending, then fills statuses in', async () => {
    let resolveProviders!: (value: AiCommitProviderStatus[]) => void;
    providers.mockReturnValue(
      new Promise<AiCommitProviderStatus[]>((resolve) => {
        resolveProviders = resolve;
      })
    );
    summary.mockResolvedValue(defaultSummary({ providers: [credential('anthropic')] }));
    render(<AiProviderSettings />);
    // The card paints from the summary alone; the status line and CLI group
    // show pending placeholders.
    expect(await screen.findByTestId('ai-provider-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('ai-add-provider-open')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-providers-empty')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('ai-status-pending')).toHaveLength(1);
    expect(screen.getByTestId('ai-cli-pending')).toBeInTheDocument();
    // Resolving the probe swaps placeholders for real statuses.
    resolveProviders([
      httpStatus('anthropic', { available: true, version: 'cli-2.0' }),
      { provider: 'codex', available: true, kind: 'cli', version: '0.9.1' },
    ]);
    expect(await screen.findByText('Available (cli-2.0)')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-status-pending')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-codex')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-cli-pending')).not.toBeInTheDocument();
  });

  it('keeps cards functional when the status probe rejects', async () => {
    providers.mockRejectedValue(new Error('ipc down'));
    summary.mockResolvedValue(defaultSummary({ providers: [credential('anthropic')] }));
    render(<AiProviderSettings />);
    expect(await screen.findByTestId('ai-provider-anthropic')).toBeInTheDocument();
    // statusLine(undefined) semantics per card, plus a muted note — the page
    // itself does not error out.
    expect(screen.getByTestId('ai-provider-anthropic').textContent).toContain('Status unknown.');
    expect(await screen.findByText('Provider status could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/AI provider status could not be loaded/i)).not.toBeInTheDocument();
  });

  it('shows the load error only when the credentials summary itself fails', async () => {
    summary.mockRejectedValue(new Error('ipc down'));
    render(<AiProviderSettings />);
    expect(await screen.findByText('AI provider status could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-add-provider-open')).not.toBeInTheDocument();
  });
});

describe('custom provider cards', () => {
  const CUSTOM_ID = 'custom:openrouter';

  beforeEach(() => {
    providers.mockResolvedValue([
      httpStatus('anthropic', { available: true }),
      httpStatus('azure-openai'),
      httpStatus('openai-compatible'),
      httpStatus('ollama'),
      httpStatus(CUSTOM_ID, {
        available: true,
        displayName: 'OpenRouter',
        protocol: 'openai-compatible',
      }),
      { provider: 'codex', available: true, kind: 'cli', version: '0.9.1' },
      { provider: 'claude', available: false, kind: 'cli', reason: 'Not installed' },
    ]);
    summary.mockResolvedValue(
      allBuiltInsSummary({
        providers: [
          credential('anthropic'),
          credential('azure-openai'),
          credential('openai-compatible'),
          credential('ollama'),
          credential(CUSTOM_ID, {
            hasApiKey: true,
            hasBaseUrl: true,
            baseUrl: 'https://openrouter.ai/api/v1',
            displayName: 'OpenRouter',
            protocol: 'openai-compatible',
          }),
        ],
      })
    );
  });

  it('renders the display name, protocol badge, and protocol-shaped fields', async () => {
    await rendered();
    const card = screen.getByTestId(`ai-provider-${CUSTOM_ID}`);
    expect(card.textContent).toContain('OPENAI-COMPATIBLE');
    // openai-compatible protocol → key + required base URL.
    expect(screen.getByTestId(`ai-api-key-${CUSTOM_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`ai-base-url-${CUSTOM_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`ai-key-status-${CUSTOM_ID}`).textContent).toContain('Key set');
    // Rename is an inline text input seeded with the display name.
    expect((screen.getByTestId(`ai-rename-${CUSTOM_ID}`) as HTMLInputElement).value).toBe('OpenRouter');
  });

  it('commits an inline rename through customProviders.upsert on blur', async () => {
    await rendered();
    const input = screen.getByTestId(`ai-rename-${CUSTOM_ID}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'OpenRouter 2' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        id: CUSTOM_ID,
        displayName: 'OpenRouter 2',
        protocol: 'openai-compatible',
      })
    );
  });

  it('deletes the custom definition via credentials.remove(customId)', async () => {
    await rendered();
    fireEvent.click(screen.getByTestId(`ai-delete-${CUSTOM_ID}`));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(CUSTOM_ID));
  });

  it('loads the model list for the custom id', async () => {
    listModels.mockResolvedValue([
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: CUSTOM_ID, local: false },
    ]);
    await rendered();
    fireEvent.focus(screen.getByTestId(`ai-model-${CUSTOM_ID}`));
    await waitFor(() => expect(listModels).toHaveBeenCalledWith(CUSTOM_ID));
    const options = (screen.getByTestId(`ai-model-${CUSTOM_ID}`) as HTMLSelectElement).options;
    await waitFor(() => expect(options.length).toBe(2));
    expect(options[1].value).toBe('gpt-4o-mini');
  });
});

describe('Add provider dialog (through the page)', () => {
  it('adds a built-in: azure requires key + base URL before submit, then saves and closes', async () => {
    summary.mockResolvedValue(defaultSummary());
    await rendered();
    fireEvent.click(screen.getByTestId('ai-add-provider-open'));
    expect(screen.getByTestId('ai-add-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-add-option-azure-openai'));
    const submit = screen.getByTestId('ai-add-submit') as HTMLButtonElement;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('ai-add-api-key'), { target: { value: 'k' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('ai-add-base-url'), {
      target: { value: 'https://example.openai.azure.com' },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'azure-openai',
          apiKey: 'k',
          baseUrl: 'https://example.openai.azure.com',
          modelOverride: '',
        })
      )
    );
    await waitFor(() => expect(screen.queryByTestId('ai-add-dialog')).not.toBeInTheDocument());
    expect(await screen.findByTestId('ai-provider-message')).toHaveTextContent(
      'Azure OpenAI configuration saved.'
    );
  });

  it('adds a custom provider: name + protocol + key + base URL + model are required', async () => {
    summary.mockResolvedValue(defaultSummary());
    await rendered();
    fireEvent.click(screen.getByTestId('ai-add-provider-open'));
    fireEvent.click(screen.getByTestId('ai-add-option-custom'));
    const submit = screen.getByTestId('ai-add-submit') as HTMLButtonElement;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('ai-add-name'), { target: { value: 'OpenRouter' } });
    expect((screen.getByTestId('ai-add-protocol') as HTMLSelectElement).value).toBe('openai-compatible');
    expect(screen.queryByTestId('ai-add-api-key')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('ai-add-api-key'), { target: { value: 'sk-or' } });
    fireEvent.change(screen.getByTestId('ai-add-base-url'), {
      target: { value: 'https://openrouter.ai/api/v1' },
    });
    // Model is required for non-ollama custom protocols.
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        displayName: 'OpenRouter',
        protocol: 'openai-compatible',
        apiKey: 'sk-or',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelOverride: 'gpt-4o-mini',
      })
    );
    await waitFor(() => expect(screen.queryByTestId('ai-add-dialog')).not.toBeInTheDocument());
    expect(await screen.findByTestId('ai-provider-message')).toHaveTextContent('added');
  });

  it('shows the upsert error inline and keeps the dialog open on failure', async () => {
    upsert.mockResolvedValue({ success: false, error: 'duplicate name' });
    summary.mockResolvedValue(defaultSummary());
    await rendered();
    fireEvent.click(screen.getByTestId('ai-add-provider-open'));
    fireEvent.click(screen.getByTestId('ai-add-option-custom'));
    fireEvent.change(screen.getByTestId('ai-add-name'), { target: { value: 'OpenRouter' } });
    fireEvent.change(screen.getByTestId('ai-add-api-key'), { target: { value: 'sk-or' } });
    fireEvent.change(screen.getByTestId('ai-add-base-url'), {
      target: { value: 'https://openrouter.ai/api/v1' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByTestId('ai-add-submit'));
    const error = await screen.findByTestId('ai-add-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error.textContent).toContain('duplicate name');
    expect(screen.getByTestId('ai-add-dialog')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('disables already-configured built-ins in the dialog with a Configured badge', async () => {
    summary.mockResolvedValue(defaultSummary({ providers: [credential('anthropic')] }));
    await rendered();
    fireEvent.click(screen.getByTestId('ai-add-provider-open'));
    const anthropic = screen.getByTestId('ai-add-option-anthropic') as HTMLButtonElement;
    expect(anthropic).toBeDisabled();
    expect(anthropic.textContent).toContain('Configured');
    // Default selection skips the configured row.
    expect(screen.getByTestId('ai-add-option-azure-openai')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('ai-add-option-anthropic')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('storage-unavailable state', () => {
  const reason =
    'OS-protected credential storage (safeStorage) is unavailable on this system, so API keys cannot be stored securely.';

  it('displays the storageUnavailableReason verbatim and disables key saving', async () => {
    summary.mockResolvedValue(
      allBuiltInsSummary({ encryptionAvailable: false, storageUnavailableReason: reason })
    );
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
    summary.mockResolvedValue(
      allBuiltInsSummary({ encryptionAvailable: false, storageUnavailableReason: reason })
    );
    await rendered();
    // No typed key → the save button stays enabled (base URL / model config only).
    expect(screen.getByTestId('ai-save-openai-compatible')).not.toBeDisabled();
  });

  it('disables the API key input inside the Add provider dialog', async () => {
    summary.mockResolvedValue(
      defaultSummary({ encryptionAvailable: false, storageUnavailableReason: reason })
    );
    await rendered();
    fireEvent.click(screen.getByTestId('ai-add-provider-open'));
    const keyInput = screen.getByTestId('ai-add-api-key') as HTMLInputElement;
    expect(keyInput).toBeDisabled();
    expect(screen.getByTestId('ai-add-dialog').textContent).toContain(reason);
  });
});
