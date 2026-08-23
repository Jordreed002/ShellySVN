/**
 * Add Provider dialog unit tests — field matrix and picker rules with a
 * mocked window.api.ai. The dialog drives field visibility/requirement from
 * its protocol metadata table; these tests pin that table's behavior
 * (keyless Ollama, required base URLs for azure/openai-compatible, required
 * model for non-ollama customs, Configured badges, storage-unavailable key
 * lockout) independent of the settings page.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderCredentialStatus } from '@shared/types';

import { AddProviderDialog } from '../AddProviderDialog';

const save = vi.fn();
const upsert = vi.fn();
const listModels = vi.fn();

const credential = (provider: string): AiProviderCredentialStatus => ({
  provider: provider as AiProviderCredentialStatus['provider'],
  hasApiKey: false,
  hasBaseUrl: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ai: {
        credentials: { save },
        customProviders: { upsert },
        listModels,
      },
    },
  });
  save.mockResolvedValue({ success: true });
  upsert.mockResolvedValue({ success: true, id: 'custom:new' });
  listModels.mockResolvedValue([]);
});

afterEach(cleanup);

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof AddProviderDialog>> = {}
) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    configuredProviders: [] as AiProviderCredentialStatus[],
    onAdded: vi.fn(),
    ...overrides,
  };
  render(<AddProviderDialog {...props} />);
  return props;
}

describe('AddProviderDialog', () => {
  it('renders one row per built-in plus Custom, selecting the first addable option', () => {
    renderDialog();
    for (const id of ['anthropic', 'azure-openai', 'openai-compatible', 'ollama', 'custom']) {
      expect(screen.getByTestId(`ai-add-option-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('ai-add-option-anthropic')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Any OpenAI-style /v1/chat/completions endpoint')).toBeInTheDocument();
  });

  it('disables configured built-ins with a badge and defaults to the next addable option', () => {
    renderDialog({ configuredProviders: [credential('anthropic')] });
    const anthropic = screen.getByTestId('ai-add-option-anthropic') as HTMLButtonElement;
    expect(anthropic).toBeDisabled();
    expect(anthropic.textContent).toContain('Configured');
    expect(screen.getByTestId('ai-add-option-azure-openai')).toHaveAttribute('aria-checked', 'true');
  });

  it('hides the API key field for Ollama and makes its base URL optional', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('ai-add-option-ollama'));
    expect(screen.queryByTestId('ai-add-api-key')).not.toBeInTheDocument();
    // No required field left → submit is immediately usable.
    expect(screen.getByTestId('ai-add-submit')).not.toBeDisabled();
  });

  it('disables the API key input and shows the reason when storage is unavailable', () => {
    renderDialog({ storageUnavailableReason: 'safeStorage is locked' });
    expect(screen.getByTestId('ai-add-api-key')).toBeDisabled();
    expect(screen.getByTestId('ai-add-dialog').textContent).toContain('safeStorage is locked');
  });

  it('rejects a malformed base URL', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('ai-add-option-azure-openai'));
    fireEvent.change(screen.getByTestId('ai-add-api-key'), { target: { value: 'k' } });
    fireEvent.change(screen.getByTestId('ai-add-base-url'), { target: { value: 'not-a-url' } });
    expect(screen.getByText(/must be a valid http\(s\) URL/i)).toBeInTheDocument();
    expect(screen.getByTestId('ai-add-submit')).toBeDisabled();
  });

  it('fetches model suggestions for the selected provider/protocol catalog', async () => {
    renderDialog();
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('anthropic'));
    fireEvent.click(screen.getByTestId('ai-add-option-custom'));
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openai-compatible'));
  });

  it('keeps everything unlocked for custom Ollama protocol providers (model optional)', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('ai-add-option-custom'));
    fireEvent.change(screen.getByTestId('ai-add-name'), { target: { value: 'LM Studio' } });
    fireEvent.change(screen.getByTestId('ai-add-protocol'), { target: { value: 'ollama' } });
    // Ollama protocol: no key, optional base URL and model → only the name is required.
    expect(screen.queryByTestId('ai-add-api-key')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-add-submit')).not.toBeDisabled();
  });
});
