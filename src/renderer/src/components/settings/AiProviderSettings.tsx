/**
 * AI provider configuration (handoff from the AI-platform agent).
 *
 * Lists every provider from `window.api.ai.providers()` (kind cli|http). HTTP
 * providers get an API key entry (written via `window.api.ai.credentials.save`
 * — keys land in safeStorage and are never rendered back; set/unset comes from
 * `credentials.summary`), a validated base URL for openai-compatible/azure, a
 * model picker from `listModels` with refresh, and a cost-estimate preview via
 * `estimateCost` for a sample 10k-char diff. When secure storage is
 * unavailable the summary's `storageUnavailableReason` is shown verbatim and
 * key saving is disabled. CLI providers only report their availability.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

import type {
  AiCommitProvider,
  AiCommitProviderStatus,
  AiCostEstimate,
  AiCredentialsSummary,
  AiModelInfo,
} from '@shared/types';

import { SettingsGroup } from './SettingsGroup';

const SAMPLE_DIFF_CHARS = 10_000;
const HTTP_PROVIDERS_WITH_BASE_URL: ReadonlySet<AiCommitProvider> = new Set([
  'openai-compatible',
  'azure-openai',
  'ollama',
]);

function providerLabel(provider: AiCommitProvider): string {
  switch (provider) {
    case 'azure-openai':
      return 'Azure OpenAI';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

function isValidBaseUrl(value: string): boolean {
  if (!value.trim()) return true; // empty clears the override — always allowed
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function statusLine(status: AiCommitProviderStatus | undefined): string {
  if (!status) return 'Status unknown.';
  if (status.available) {
    return status.version ? `Available (${status.version})` : 'Available';
  }
  if (status.cliLoggedIn) return 'Signed in — API auth required.';
  if (status.reason) return status.reason;
  if (status.kind === 'cli') return 'Not installed or not authenticated.';
  return 'Not configured.';
}

interface ProviderDraft {
  apiKey: string;
  baseUrl: string;
  modelOverride: string;
}

function emptyDraft(): ProviderDraft {
  return { apiKey: '', baseUrl: '', modelOverride: '' };
}

export function AiProviderSettings() {
  const [statuses, setStatuses] = useState<AiCommitProviderStatus[]>([]);
  const [summary, setSummary] = useState<AiCredentialsSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [models, setModels] = useState<Record<string, AiModelInfo[]>>({});
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({});
  const [estimates, setEstimates] = useState<Record<string, AiCostEstimate | undefined>>({});
  const [estimateLoading, setEstimateLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const [providerStatuses, credentialsSummary] = await Promise.all([
        window.api.ai.providers(),
        window.api.ai.credentials.summary(),
      ]);
      setStatuses(providerStatuses);
      setSummary(credentialsSummary);
      setDrafts((current) => {
        const next: Record<string, ProviderDraft> = {};
        for (const status of providerStatuses) {
          const existing = credentialsSummary.providers.find(
            (candidate) => candidate.provider === status.provider
          );
          next[status.provider] = {
            ...(current[status.provider] ?? emptyDraft()),
            baseUrl: existing?.baseUrl ?? '',
            modelOverride: existing?.modelOverride ?? '',
          };
        }
        return next;
      });
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const storageUnavailable = summary?.storageUnavailableReason;

  const credentialFor = (provider: AiCommitProvider) =>
    summary?.providers.find((candidate) => candidate.provider === provider);

  const loadModels = useCallback(async (provider: AiCommitProvider) => {
    setModelsLoading((current) => ({ ...current, [provider]: true }));
    try {
      const list = await window.api.ai.listModels(provider);
      setModels((current) => ({ ...current, [provider]: list }));
    } catch {
      setModels((current) => ({ ...current, [provider]: [] }));
    } finally {
      setModelsLoading((current) => ({ ...current, [provider]: false }));
    }
  }, []);

  const loadEstimate = useCallback(async (provider: AiCommitProvider, model?: string) => {
    setEstimateLoading((current) => ({ ...current, [provider]: true }));
    try {
      const estimate = await window.api.ai.estimateCost({
        provider,
        ...(model ? { model } : {}),
        inputChars: SAMPLE_DIFF_CHARS,
      });
      setEstimates((current) => ({ ...current, [provider]: estimate }));
    } catch {
      setEstimates((current) => ({ ...current, [provider]: undefined }));
    } finally {
      setEstimateLoading((current) => ({ ...current, [provider]: false }));
    }
  }, []);

  const saveProvider = async (provider: AiCommitProvider) => {
    const draft = drafts[provider] ?? emptyDraft();
    if (draft.apiKey && storageUnavailable) return;
    if (!isValidBaseUrl(draft.baseUrl)) return;
    setMessage(null);
    try {
      // apiKey is sent only when typed: an empty string would clear the stored
      // key main-side. baseUrl / modelOverride always mirror the visible UI
      // state ('' clears, per the credentials store semantics).
      const result = await window.api.ai.credentials.save({
        provider,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(HTTP_PROVIDERS_WITH_BASE_URL.has(provider) ? { baseUrl: draft.baseUrl } : {}),
        modelOverride: draft.modelOverride,
      });
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error || 'Saving the provider configuration failed.' });
        return;
      }
      setDrafts((current) => ({ ...current, [provider]: { ...draft, apiKey: '' } }));
      setMessage({ tone: 'ok', text: `${providerLabel(provider)} configuration saved.` });
      await refreshAll();
    } catch {
      setMessage({ tone: 'error', text: 'Saving the provider configuration failed.' });
    }
  };

  const removeProvider = async (provider: AiCommitProvider) => {
    setMessage(null);
    try {
      await window.api.ai.credentials.remove(provider);
      setDrafts((current) => ({ ...current, [provider]: emptyDraft() }));
      setMessage({ tone: 'ok', text: `${providerLabel(provider)} configuration removed.` });
      await refreshAll();
    } catch {
      setMessage({ tone: 'error', text: 'Removing the provider configuration failed.' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading AI providers…
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-error" role="alert">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        AI provider status could not be loaded.
      </div>
    );
  }

  const httpProviders = statuses.filter((status) => status.kind === 'http');
  const cliProviders = statuses.filter((status) => status.kind !== 'http');

  return (
    <div className="space-y-6">
      {storageUnavailable && (
        <div
          className="rounded-lg border border-warning/30 bg-warning/10 p-3"
          role="alert"
          data-testid="ai-storage-unavailable"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Secure credential storage is unavailable
          </p>
          <p className="mt-1 text-xs text-warning">{storageUnavailable}</p>
          <p className="mt-1 text-xs text-text-secondary">
            API keys cannot be saved until the OS credential store is available. Base URLs and model
            overrides can still be configured.
          </p>
        </div>
      )}

      {message && (
        <p
          className={`text-xs ${message.tone === 'ok' ? 'text-success' : 'text-error'}`}
          role="status"
          data-testid="ai-provider-message"
        >
          {message.text}
        </p>
      )}

      <SettingsGroup
        title="HTTP Providers"
        description="Call a provider endpoint directly; keys are stored encrypted and never shown back"
      >
        <div className="space-y-3">
          {httpProviders.length === 0 && (
            <p className="text-sm text-text-muted">No HTTP providers are registered.</p>
          )}
          {httpProviders.map((status) => {
            const credential = credentialFor(status.provider);
            const draft = drafts[status.provider] ?? emptyDraft();
            const providerModels = models[status.provider];
            const currentModel = draft.modelOverride || credential?.modelOverride || '';
            const estimate = estimates[status.provider];
            const baseUrlInvalid =
              HTTP_PROVIDERS_WITH_BASE_URL.has(status.provider) && !isValidBaseUrl(draft.baseUrl);
            const keySaveBlocked = Boolean(draft.apiKey) && Boolean(storageUnavailable);
            return (
              <div
                key={status.provider}
                className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-3"
                data-testid={`ai-provider-${status.provider}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">{providerLabel(status.provider)}</p>
                  <span className="flex items-center gap-1.5 text-10.5 text-text-muted">
                    {status.available ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                    ) : (
                      <CircleSlash className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
                    )}
                    {statusLine(status)}
                  </span>
                </div>

                {status.provider !== 'ollama' ? (
                  <div>
                    <span className="text-xs text-text-muted">API key</span>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="password"
                        value={draft.apiKey}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [status.provider]: { ...draft, apiKey: event.target.value },
                          }))
                        }
                        placeholder={
                          credential?.hasApiKey ? 'Key saved — enter a new key to replace' : 'Enter API key'
                        }
                        className="input flex-1 font-mono text-xs"
                        aria-label={`API key for ${providerLabel(status.provider)}`}
                        data-testid={`ai-api-key-${status.provider}`}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void saveProvider(status.provider)}
                        disabled={keySaveBlocked || baseUrlInvalid}
                        title={
                          keySaveBlocked
                            ? 'Secure storage is unavailable — the key cannot be saved.'
                            : undefined
                        }
                        data-testid={`ai-save-${status.provider}`}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </button>
                      {credential?.hasApiKey && (
                        <button
                          type="button"
                          className="btn-icon-sm text-error hover:bg-error/10"
                          onClick={() => void removeProvider(status.provider)}
                          aria-label={`Remove saved configuration for ${providerLabel(status.provider)}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-10.5 text-text-muted" data-testid={`ai-key-status-${status.provider}`}>
                      {credential?.hasApiKey
                        ? `Key set${credential.updatedAt ? ` (updated ${new Date(credential.updatedAt).toLocaleString()})` : ''}.`
                        : 'No key saved.'}
                    </p>
                  </div>
                ) : (
                  <p className="text-10.5 text-text-muted">
                    Ollama runs locally — no API key needed, only a base URL and model.
                  </p>
                )}

                {HTTP_PROVIDERS_WITH_BASE_URL.has(status.provider) && (
                  <div>
                    <span className="text-xs text-text-muted">Base URL</span>
                    <input
                      type="text"
                      value={draft.baseUrl}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [status.provider]: { ...draft, baseUrl: event.target.value },
                        }))
                      }
                      placeholder={
                        status.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'
                      }
                      className="input mt-1 w-full font-mono text-xs"
                      aria-label={`Base URL for ${providerLabel(status.provider)}`}
                      data-testid={`ai-base-url-${status.provider}`}
                    />
                    {baseUrlInvalid && (
                      <p className="mt-1 text-10.5 text-error" role="alert">
                        Base URL must be a valid http(s) URL.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Model</span>
                    <button
                      type="button"
                      className="btn-icon-sm"
                      onClick={() => void loadModels(status.provider)}
                      disabled={modelsLoading[status.provider]}
                      aria-label={`Refresh model list for ${providerLabel(status.provider)}`}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${modelsLoading[status.provider] ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <select
                    value={currentModel}
                    onChange={(event) => {
                      const modelOverride = event.target.value;
                      setDrafts((current) => ({
                        ...current,
                        [status.provider]: { ...draft, modelOverride },
                      }));
                      void loadEstimate(status.provider, modelOverride || undefined);
                    }}
                    onFocus={() => {
                      if (!providerModels) void loadModels(status.provider);
                    }}
                    className="input mt-1 w-full"
                    aria-label={`Model for ${providerLabel(status.provider)}`}
                    data-testid={`ai-model-${status.provider}`}
                  >
                    <option value="">(provider default)</option>
                    {(providerModels ?? []).map((model) => (
                      <option key={`${model.provider}:${model.id}`} value={model.id}>
                        {model.label}
                        {model.local ? ' (local)' : ''}
                      </option>
                    ))}
                  </select>
                  {currentModel && (
                    <p className="mt-1 text-10.5 text-text-muted">
                      Override: <span className="font-mono">{currentModel}</span>
                    </p>
                  )}
                </div>

                <div className="rounded-7 border border-border-muted bg-bg-sunk/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-10 font-semibold uppercase tracking-caps text-text-muted">
                      Cost estimate
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm text-10.5"
                      onClick={() => void loadEstimate(status.provider, currentModel || undefined)}
                      disabled={estimateLoading[status.provider]}
                      data-testid={`ai-estimate-button-${status.provider}`}
                    >
                      {estimateLoading[status.provider] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Preview cost'
                      )}
                    </button>
                  </div>
                  {estimate ? (
                    <p className="mt-1.5 text-10.5 text-text-secondary" data-testid={`ai-estimate-${status.provider}`}>
                      {SAMPLE_DIFF_CHARS.toLocaleString()}-char diff ≈{' '}
                      {estimate.estimatedInputTokens.toLocaleString()} input +{' '}
                      {estimate.estimatedOutputTokens.toLocaleString()} output tokens ≈{' '}
                      {estimate.pricingKnown
                        ? `$${estimate.estimatedCostUsd.toFixed(4)} per message`
                        : 'pricing unknown for this model'}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-10.5 text-text-faint">
                      Sample: a {SAMPLE_DIFF_CHARS.toLocaleString()}-character diff.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="CLI Providers"
        description="Local CLIs authenticate through their own login — status only"
      >
        <div className="space-y-2">
          {cliProviders.length === 0 && (
            <p className="text-sm text-text-muted">No CLI providers are registered.</p>
          )}
          {cliProviders.map((status) => (
            <div
              key={status.provider}
              className="flex items-center justify-between gap-2 rounded-7 border border-border-muted bg-bg-secondary/60 px-3 py-2"
              data-testid={`ai-provider-${status.provider}`}
            >
              <span className="text-12 font-medium capitalize text-text">
                {providerLabel(status.provider)}
              </span>
              <span className="text-10.5 text-text-muted">{statusLine(status)}</span>
            </div>
          ))}
          <p className="text-10.5 text-text-faint">
            Provider budgets, privacy gating, and usage history live in the SVN tab under AI Commit
            Messages.
          </p>
        </div>
      </SettingsGroup>
    </div>
  );
}
