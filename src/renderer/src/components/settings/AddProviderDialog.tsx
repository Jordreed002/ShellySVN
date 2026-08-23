/**
 * Add Provider dialog (AI Providers tab rework).
 *
 * Provider setup behind one dialog instead of four always-visible config
 * cards: pick a built-in (Anthropic, Azure OpenAI, OpenAI-compatible, Ollama)
 * or "Custom…" — a user-named endpoint speaking one of the four wire protocols
 * (e.g. two OpenAI-compatible providers "OpenRouter" and "Groq"), created via
 * `window.api.ai.customProviders.upsert`. Field visibility/requirement is
 * driven by the AI_PROTOCOL_META table below; this module also owns the small
 * provider metadata helpers (`providerLabel`, `isValidBaseUrl`,
 * `HTTP_PROVIDER_ORDER`) shared with AiProviderSettings.tsx and
 * SettingsPanels.tsx — they live here (a leaf module) so no import cycle is
 * created. Keys are write-only: a saved key is never rendered back.
 */

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import type {
  AiCustomProviderProtocol,
  AiHttpProvider,
  AiModelInfo,
  AiProviderCredentialStatus,
  AiProviderId,
} from '@shared/types';

import { DialogBase } from '../ui/DialogBase';
import { AutoCompleteTextInput } from '../ui/AutoCompleteInput';

/** Canonical card/option order for the four built-in HTTP providers. */
export const HTTP_PROVIDER_ORDER: readonly AiHttpProvider[] = [
  'anthropic',
  'azure-openai',
  'openai-compatible',
  'ollama',
];

/** Field rules per wire protocol; also the Add-dialog picker copy source. */
export interface AiProtocolMeta {
  label: string;
  description: string;
  /** 'none' hides the API key field entirely (Ollama runs keyless). */
  apiKey: 'required' | 'none';
  baseUrl: 'required' | 'optional' | 'hidden';
  baseUrlPlaceholder: string;
}

export const AI_PROTOCOL_META: Record<AiCustomProviderProtocol, AiProtocolMeta> = {
  anthropic: {
    label: 'Anthropic',
    description: 'Claude models via the Anthropic API',
    apiKey: 'required',
    // Customs may point the Anthropic protocol at a proxy; the built-in never
    // shows the field (handled in the dialog's built-in rules below).
    baseUrl: 'optional',
    baseUrlPlaceholder: 'https://proxy.example.com',
  },
  'azure-openai': {
    label: 'Azure OpenAI',
    description: 'Your Azure OpenAI deployment',
    apiKey: 'required',
    baseUrl: 'required',
    baseUrlPlaceholder: 'https://<resource>.openai.azure.com',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    description: 'Any OpenAI-style /v1/chat/completions endpoint',
    apiKey: 'required',
    baseUrl: 'required',
    baseUrlPlaceholder: 'https://openrouter.ai/api/v1',
  },
  ollama: {
    label: 'Ollama',
    description: 'Local Ollama or LM Studio server',
    apiKey: 'none',
    baseUrl: 'optional',
    baseUrlPlaceholder: 'http://localhost:11434',
  },
};

/** Friendly name for any provider id; customs prefer their display name. */
export function providerLabel(provider: AiProviderId, displayName?: string): string {
  if (provider.startsWith('custom:')) {
    const name = displayName?.trim();
    return name ? name : provider.slice('custom:'.length);
  }
  switch (provider) {
    case 'azure-openai':
      return 'Azure OpenAI';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

/** Empty clears the override (allowed); otherwise a valid http(s) URL. */
export function isValidBaseUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Selection values of the provider picker: a built-in id or the custom row. */
type AddSelection = AiHttpProvider | 'custom';

interface FieldRules {
  showApiKey: boolean;
  baseUrl: 'required' | 'optional' | 'hidden';
  baseUrlPlaceholder?: string;
  /** Customs of non-Ollama protocols must name their model up front. */
  modelRequired: boolean;
}

function fieldRules(selection: AddSelection, protocol: AiCustomProviderProtocol): FieldRules {
  if (selection === 'custom') {
    const meta = AI_PROTOCOL_META[protocol];
    return {
      showApiKey: meta.apiKey === 'required',
      baseUrl: meta.baseUrl,
      baseUrlPlaceholder: meta.baseUrlPlaceholder,
      modelRequired: protocol !== 'ollama',
    };
  }
  const meta = AI_PROTOCOL_META[selection];
  return {
    showApiKey: meta.apiKey === 'required',
    // The built-in Anthropic provider talks to api.anthropic.com directly —
    // only a custom Anthropic-protocol provider can point at a proxy.
    baseUrl: selection === 'anthropic' ? 'hidden' : meta.baseUrl,
    baseUrlPlaceholder: meta.baseUrlPlaceholder,
    modelRequired: false,
  };
}

/** First addable option when the dialog opens: already-configured built-ins are skipped. */
function defaultSelection(configured: readonly AiProviderCredentialStatus[]): AddSelection {
  for (const id of HTTP_PROVIDER_ORDER) {
    if (!configured.some((entry) => entry.provider === id)) return id;
  }
  return 'custom';
}

export interface AddProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** `credentials.summary().providers` — drives the "Configured" badges. */
  configuredProviders: AiProviderCredentialStatus[];
  /** Mirrors the page banner: when set the API key input is disabled. */
  storageUnavailableReason?: string;
  /** Success callback (page shows the message and refreshes); dialog then closes. */
  onAdded: (message: string) => void;
}

const CUSTOM_NAME_MAX_LENGTH = 80;

export function AddProviderDialog({
  isOpen,
  onClose,
  configuredProviders,
  storageUnavailableReason,
  onAdded,
}: AddProviderDialogProps) {
  const [selection, setSelection] = useState<AddSelection>('anthropic');
  const [displayName, setDisplayName] = useState('');
  const [protocol, setProtocol] = useState<AiCustomProviderProtocol>('openai-compatible');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [modelSuggestions, setModelSuggestions] = useState<AiModelInfo[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form on every open; the default row skips already-configured built-ins.
  useEffect(() => {
    if (!isOpen) return;
    setSelection(defaultSelection(configuredProviders));
    setDisplayName('');
    setProtocol('openai-compatible');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setModelSuggestions([]);
    setError(null);
    setIsSaving(false);
  }, [isOpen, configuredProviders]);

  const rules = fieldRules(selection, protocol);

  // Model suggestions: the protocol catalog for customs, the provider catalog
  // for built-ins (Ollama-protocol customs reuse the Ollama catalog).
  const modelSource: AiProviderId = selection === 'custom' ? protocol : selection;
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    window.api.ai
      .listModels(modelSource)
      .then((list) => {
        if (active) setModelSuggestions(list);
      })
      .catch(() => {
        if (active) setModelSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [isOpen, modelSource]);

  const trimmedName = displayName.trim();
  const nameValid = selection !== 'custom' || (trimmedName.length > 0 && trimmedName.length <= CUSTOM_NAME_MAX_LENGTH);
  const apiKeyValid = !rules.showApiKey || apiKey.trim().length > 0;
  const baseUrlTrimmed = baseUrl.trim();
  const baseUrlValid =
    rules.baseUrl === 'hidden' ||
    (rules.baseUrl === 'optional' ? isValidBaseUrl(baseUrlTrimmed) : Boolean(baseUrlTrimmed) && isValidBaseUrl(baseUrlTrimmed));
  const modelValid = !rules.modelRequired || model.trim().length > 0;
  const canSubmit = !isSaving && nameValid && apiKeyValid && baseUrlValid && modelValid;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    try {
      if (selection === 'custom') {
        const result = await window.api.ai.customProviders.upsert({
          displayName: trimmedName,
          protocol,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(rules.baseUrl !== 'hidden' ? { baseUrl: baseUrlTrimmed } : {}),
          modelOverride: model.trim(),
        });
        if (result.success === false) {
          setError(result.error || 'Adding the provider failed.');
          return;
        }
        onAdded(`Provider "${trimmedName}" added.`);
      } else {
        // Same empty-string semantics as the page: apiKey only when typed
        // (empty would clear the stored key), baseUrl/modelOverride mirror
        // the visible form fields.
        const result = await window.api.ai.credentials.save({
          provider: selection,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(rules.baseUrl !== 'hidden' ? { baseUrl: baseUrlTrimmed } : {}),
          modelOverride: model.trim(),
        });
        if (result.success === false) {
          setError(result.error || 'Adding the provider failed.');
          return;
        }
        onAdded(`${providerLabel(selection)} configuration saved.`);
      }
      onClose();
    } catch {
      setError('Adding the provider failed.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Add AI provider"
      dialogId="ai-add-provider"
      className="w-[560px] max-h-[85vh] flex flex-col"
      initialFocus="first-control"
    >
      <div className="modal-body space-y-4 overflow-auto" data-testid="ai-add-dialog">
        {error && (
          <p className="text-sm text-error" role="alert" data-testid="ai-add-error">
            {error}
          </p>
        )}

        <div role="radiogroup" aria-label="Provider type" className="space-y-1.5">
          {HTTP_PROVIDER_ORDER.map((id) => {
            const meta = AI_PROTOCOL_META[id];
            const isConfigured = configuredProviders.some((entry) => entry.provider === id);
            const isSelected = selection === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={isConfigured}
                onClick={() => setSelection(id)}
                data-testid={`ai-add-option-${id}`}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-bg-tertiary hover:border-border-focus'
                } ${isConfigured ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span>
                  <span className="block text-sm font-medium text-text">{meta.label}</span>
                  <span className="block text-xs text-text-muted">{meta.description}</span>
                </span>
                {isConfigured && (
                  <span className="shrink-0 rounded border border-border bg-bg-sunk px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide text-text-muted">
                    Configured
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={selection === 'custom'}
            onClick={() => setSelection('custom')}
            data-testid="ai-add-option-custom"
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
              selection === 'custom'
                ? 'border-accent bg-accent/10'
                : 'border-border bg-bg-tertiary hover:border-border-focus'
            }`}
          >
            <span>
              <span className="block text-sm font-medium text-text">Custom…</span>
              <span className="block text-xs text-text-muted">
                Name your own endpoint; pick its protocol
              </span>
            </span>
          </button>
        </div>

        {selection === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-text-muted">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={CUSTOM_NAME_MAX_LENGTH}
                placeholder="e.g. OpenRouter"
                className="input mt-1 w-full text-sm"
                aria-label="Custom provider display name"
                data-testid="ai-add-name"
              />
            </label>
            <label className="block">
              <span className="text-xs text-text-muted">Protocol</span>
              <select
                value={protocol}
                onChange={(event) => setProtocol(event.target.value as AiCustomProviderProtocol)}
                className="input mt-1 w-full"
                aria-label="Custom provider protocol"
                data-testid="ai-add-protocol"
              >
                {HTTP_PROVIDER_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {AI_PROTOCOL_META[id].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {rules.showApiKey && (
          <div>
            <span className="text-xs text-text-muted">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Enter API key"
              disabled={Boolean(storageUnavailableReason)}
              className="input mt-1 w-full font-mono text-xs"
              aria-label="API key"
              data-testid="ai-add-api-key"
              autoComplete="off"
            />
            {storageUnavailableReason && (
              <p className="mt-1 text-10.5 text-warning" role="alert">
                {storageUnavailableReason}
              </p>
            )}
          </div>
        )}

        {rules.baseUrl !== 'hidden' && (
          <div>
            <span className="text-xs text-text-muted">
              Base URL{rules.baseUrl === 'optional' ? ' (optional)' : ''}
            </span>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={rules.baseUrlPlaceholder}
              className="input mt-1 w-full font-mono text-xs"
              aria-label="Base URL"
              data-testid="ai-add-base-url"
            />
            {!isValidBaseUrl(baseUrl) && baseUrl.trim() && (
              <p className="mt-1 text-10.5 text-error" role="alert">
                Base URL must be a valid http(s) URL.
              </p>
            )}
          </div>
        )}

        <div data-testid="ai-add-model">
          <span className="text-xs text-text-muted">
            Model{rules.modelRequired ? '' : ' (provider default when empty)'}
          </span>
          <AutoCompleteTextInput
            value={model}
            onChange={setModel}
            suggestions={modelSuggestions.map((entry) => ({ value: entry.id, label: entry.label }))}
            placeholder={rules.modelRequired ? 'Required — e.g. gpt-4o-mini' : '(provider default)'}
            className="mt-1"
            inputClassName="w-full font-mono text-xs"
            aria-label="Model"
          />
        </div>
      </div>

      <div className="modal-footer">
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="btn btn-primary"
            data-testid="ai-add-submit"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add provider
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
