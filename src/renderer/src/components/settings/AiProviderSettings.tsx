/**
 * AI provider configuration (handoff from the AI-platform agent).
 *
 * Only configured providers render as editable cards: built-ins that have an
 * entry in `credentials.summary` plus every user-defined custom provider
 * (`custom:<slug>`, created through the Add Provider dialog — see
 * AddProviderDialog.tsx, which also owns the shared protocol metadata). Each
 * card gets an API key entry (written via `window.api.ai.credentials.save` —
 * keys land in safeStorage and are never rendered back; set/unset comes from
 * `credentials.summary`), a validated base URL where the protocol needs one,
 * a model picker from `listModels` with refresh, and a cost-estimate preview
 * via `estimateCost` for a sample 10k-char diff. Custom cards additionally
 * support inline rename (`customProviders.upsert`) and deletion
 * (`credentials.remove` on the custom id deletes the definition). When secure
 * storage is unavailable the summary's `storageUnavailableReason` is shown
 * verbatim and key saving is disabled. CLI providers only report their
 * availability. The page paints from the fast `credentials.summary` read;
 * provider statuses (slow CLI probes) fill in progressively, and a failed
 * status probe degrades to "Status unknown." lines instead of failing the page.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  Plus,
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
  AiProviderId,
} from '@shared/types';

import { SettingsGroup } from './SettingsGroup';
import {
  AddProviderDialog,
  AI_PROTOCOL_META,
  HTTP_PROVIDER_ORDER,
  isValidBaseUrl,
  providerLabel,
} from './AddProviderDialog';

const SAMPLE_DIFF_CHARS = 10_000;
const HTTP_PROVIDERS_WITH_BASE_URL: ReadonlySet<AiCommitProvider> = new Set([
  'openai-compatible',
  'azure-openai',
  'ollama',
]);

function isCustomProvider(provider: AiProviderId): boolean {
  return provider.startsWith('custom:');
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
  // null = the providers() probe hasn't answered yet (progressive status fill).
  const [statuses, setStatuses] = useState<AiCommitProviderStatus[] | null>(null);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);
  const [summary, setSummary] = useState<AiCredentialsSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, AiModelInfo[]>>({});
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({});
  const [estimates, setEstimates] = useState<Record<string, AiCostEstimate | undefined>>({});
  const [estimateLoading, setEstimateLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    setStatuses(null);
    setStatusLoadFailed(false);
    // The summary is a fast local read and gates the render; provider
    // statuses spawn CLI probes main-side and fill in progressively. A
    // rejected status probe must not fail the page.
    const providerStatusesPromise = window.api.ai.providers().catch(() => null);
    try {
      const credentialsSummary = await window.api.ai.credentials.summary();
      setSummary(credentialsSummary);
      setDrafts((current) => {
        // Seed drafts for every card that can render: summary entries cover
        // configured built-ins and all customs (customs live in the summary).
        const next: Record<string, ProviderDraft> = {};
        for (const entry of credentialsSummary.providers) {
          next[entry.provider] = {
            ...(current[entry.provider] ?? emptyDraft()),
            baseUrl: entry.baseUrl ?? '',
            modelOverride: entry.modelOverride ?? '',
          };
        }
        return next;
      });
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
    const providerStatuses = await providerStatusesPromise;
    if (providerStatuses === null) {
      setStatuses([]);
      setStatusLoadFailed(true);
    } else {
      setStatuses(providerStatuses);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const storageUnavailable = summary?.storageUnavailableReason;

  const credentialFor = (provider: AiProviderId) =>
    summary?.providers.find((candidate) => candidate.provider === provider);

  const statusFor = (provider: AiProviderId) =>
    (statuses ?? []).find((candidate) => candidate.provider === provider);

  const loadModels = useCallback(async (provider: AiProviderId) => {
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

  const loadEstimate = useCallback(async (provider: AiProviderId, model?: string) => {
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

  // baseUrl rides along for every provider whose card shows the field
  // (built-ins per HTTP_PROVIDERS_WITH_BASE_URL; customs always).
  const sendsBaseUrl = (provider: AiProviderId): boolean =>
    isCustomProvider(provider) || HTTP_PROVIDERS_WITH_BASE_URL.has(provider as AiCommitProvider);

  const saveProvider = async (provider: AiProviderId) => {
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
        ...(sendsBaseUrl(provider) ? { baseUrl: draft.baseUrl } : {}),
        modelOverride: draft.modelOverride,
      });
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error || 'Saving the provider configuration failed.' });
        return;
      }
      setDrafts((current) => ({ ...current, [provider]: { ...draft, apiKey: '' } }));
      const label = providerLabel(provider, credentialFor(provider)?.displayName);
      setMessage({ tone: 'ok', text: `${label} configuration saved.` });
      await refreshAll();
    } catch {
      setMessage({ tone: 'error', text: 'Saving the provider configuration failed.' });
    }
  };

  const removeProvider = async (provider: AiProviderId) => {
    setMessage(null);
    try {
      await window.api.ai.credentials.remove(provider);
      setDrafts((current) => ({ ...current, [provider]: emptyDraft() }));
      setRenames((current) => {
        const { [provider]: _removed, ...rest } = current;
        return rest;
      });
      const label = providerLabel(provider, credentialFor(provider)?.displayName);
      setMessage({ tone: 'ok', text: `${label} configuration removed.` });
      await refreshAll();
    } catch {
      setMessage({ tone: 'error', text: 'Removing the provider configuration failed.' });
    }
  };

  // Inline rename for custom providers: commit on blur (ConnectionProfiles
  // pattern). The protocol must ride along and match the stored definition.
  const commitRename = async (provider: AiProviderId) => {
    const credential = credentialFor(provider);
    const protocol = credential?.protocol ?? statusFor(provider)?.protocol;
    const currentName = credential?.displayName ?? statusFor(provider)?.displayName ?? '';
    const nextName = (renames[provider] ?? '').trim();
    if (!protocol || !nextName || nextName === currentName) return;
    setMessage(null);
    try {
      const result = await window.api.ai.customProviders.upsert({
        id: provider,
        displayName: nextName,
        protocol,
      });
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error || 'Renaming the provider failed.' });
        return;
      }
      setMessage({ tone: 'ok', text: `Provider renamed to "${nextName}".` });
      await refreshAll();
    } catch {
      setMessage({ tone: 'error', text: 'Renaming the provider failed.' });
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

  const statusesLoaded = statuses !== null;
  const cliProviders = (statuses ?? []).filter((status) => status.kind !== 'http');

  // Stable card order: configured built-ins first (canonical order), then
  // customs alphabetically by display name.
  const displayNameOf = (provider: AiProviderId): string =>
    credentialFor(provider)?.displayName ?? statusFor(provider)?.displayName ?? '';
  const configuredBuiltIns = HTTP_PROVIDER_ORDER.filter((provider) =>
    summary.providers.some((entry) => entry.provider === provider)
  );
  const customIds = [
    ...new Set(
      [...(statuses ?? []).map((status) => status.provider), ...summary.providers.map((entry) => entry.provider)]
        .filter((provider) => isCustomProvider(provider))
    ),
  ].toSorted((a, b) =>
    (displayNameOf(a) || a).localeCompare(displayNameOf(b) || b)
  );
  const configuredCards: AiProviderId[] = [...configuredBuiltIns, ...customIds];

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
        description="Providers you've added; keys are stored encrypted and never shown back"
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            {configuredCards.length === 0 ? (
              <div>
                <p className="text-sm text-text-muted" data-testid="ai-providers-empty">
                  No AI providers configured yet.
                </p>
                <p className="mt-0.5 text-xs text-text-faint">
                  Add Anthropic, Azure OpenAI, an OpenAI-compatible endpoint, Ollama, or a named
                  custom provider.
                </p>
              </div>
            ) : (
              <span className="text-xs text-text-faint">
                {configuredCards.length} provider{configuredCards.length !== 1 ? 's' : ''} configured
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm shrink-0"
              onClick={() => setIsAddOpen(true)}
              data-testid="ai-add-provider-open"
            >
              <Plus className="h-3.5 w-3.5" />
              Add provider
            </button>
          </div>

          {configuredCards.map((provider) => {
            const credential = credentialFor(provider);
            const status = statusFor(provider);
            const custom = isCustomProvider(provider);
            const protocol = custom ? (credential?.protocol ?? status?.protocol) : undefined;
            const label = providerLabel(provider, credential?.displayName ?? status?.displayName);
            const draft = drafts[provider] ?? emptyDraft();
            const providerModels = models[provider];
            const currentModel = draft.modelOverride || credential?.modelOverride || '';
            const estimate = estimates[provider];
            // Customs show the key field per their protocol; built-ins per id.
            const showApiKey = custom ? protocol !== 'ollama' : provider !== 'ollama';
            // Customs show the base URL for every protocol (required for
            // azure / openai-compatible protocols); built-ins keep the
            // historical field set.
            const showBaseUrl = custom || HTTP_PROVIDERS_WITH_BASE_URL.has(provider as AiCommitProvider);
            const baseUrlRequired = custom && (protocol === 'azure-openai' || protocol === 'openai-compatible');
            const baseUrlInvalid = showBaseUrl && !isValidBaseUrl(draft.baseUrl);
            const baseUrlMissing = baseUrlRequired && !draft.baseUrl.trim();
            const keySaveBlocked = Boolean(draft.apiKey) && Boolean(storageUnavailable);
            const baseUrlPlaceholder = custom && protocol
              ? AI_PROTOCOL_META[protocol].baseUrlPlaceholder
              : provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1';
            return (
              <div
                key={provider}
                className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-3"
                data-testid={`ai-provider-${provider}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {custom ? (
                      <>
                        <input
                          type="text"
                          value={renames[provider] ?? credential?.displayName ?? status?.displayName ?? ''}
                          onChange={(event) =>
                            setRenames((current) => ({ ...current, [provider]: event.target.value }))
                          }
                          onBlur={() => void commitRename(provider)}
                          maxLength={80}
                          className="input h-7 max-w-56 text-sm"
                          aria-label={`Display name for custom provider ${provider}`}
                          data-testid={`ai-rename-${provider}`}
                        />
                        {protocol && (
                          <span className="shrink-0 rounded border border-border bg-bg-sunk px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide text-text-muted">
                            {protocol.toUpperCase()}
                          </span>
                        )}
                      </>
                    ) : (
                      <p className="text-sm font-medium text-text">{label}</p>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-10.5 text-text-muted">
                    {!statusesLoaded ? (
                      <span
                        className="flex items-center gap-1.5"
                        aria-label={`Checking status for ${label}`}
                        data-testid="ai-status-pending"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" aria-hidden="true" />
                        Checking…
                      </span>
                    ) : (
                      <>
                        {status?.available ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                        ) : (
                          <CircleSlash className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
                        )}
                        {statusLine(status)}
                      </>
                    )}
                  </span>
                </div>

                {showApiKey ? (
                  <div>
                    <span className="text-xs text-text-muted">API key</span>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="password"
                        value={draft.apiKey}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [provider]: { ...draft, apiKey: event.target.value },
                          }))
                        }
                        placeholder={
                          credential?.hasApiKey ? 'Key saved — enter a new key to replace' : 'Enter API key'
                        }
                        className="input flex-1 font-mono text-xs"
                        aria-label={`API key for ${label}`}
                        data-testid={`ai-api-key-${provider}`}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void saveProvider(provider)}
                        disabled={keySaveBlocked || baseUrlInvalid || baseUrlMissing}
                        title={
                          keySaveBlocked
                            ? 'Secure storage is unavailable — the key cannot be saved.'
                            : undefined
                        }
                        data-testid={`ai-save-${provider}`}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </button>
                      {custom ? (
                        <button
                          type="button"
                          className="btn-icon-sm text-error hover:bg-error/10"
                          onClick={() => void removeProvider(provider)}
                          aria-label={`Delete custom provider ${label}`}
                          data-testid={`ai-delete-${provider}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : (
                        credential?.hasApiKey && (
                          <button
                            type="button"
                            className="btn-icon-sm text-error hover:bg-error/10"
                            onClick={() => void removeProvider(provider)}
                            aria-label={`Remove saved configuration for ${label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )
                      )}
                    </div>
                    <p className="mt-1 text-10.5 text-text-muted" data-testid={`ai-key-status-${provider}`}>
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

                {showBaseUrl && (
                  <div>
                    <span className="text-xs text-text-muted">
                      Base URL{baseUrlRequired ? '' : ' (optional)'}
                    </span>
                    <input
                      type="text"
                      value={draft.baseUrl}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [provider]: { ...draft, baseUrl: event.target.value },
                        }))
                      }
                      placeholder={baseUrlPlaceholder}
                      className="input mt-1 w-full font-mono text-xs"
                      aria-label={`Base URL for ${label}`}
                      data-testid={`ai-base-url-${provider}`}
                    />
                    {baseUrlInvalid && (
                      <p className="mt-1 text-10.5 text-error" role="alert">
                        Base URL must be a valid http(s) URL.
                      </p>
                    )}
                    {baseUrlMissing && (
                      <p className="mt-1 text-10.5 text-error" role="alert">
                        Base URL is required for this provider.
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
                      onClick={() => void loadModels(provider)}
                      disabled={modelsLoading[provider]}
                      aria-label={`Refresh model list for ${label}`}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${modelsLoading[provider] ? 'animate-spin' : ''}`}
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
                        [provider]: { ...draft, modelOverride },
                      }));
                      void loadEstimate(provider, modelOverride || undefined);
                    }}
                    onFocus={() => {
                      if (!providerModels) void loadModels(provider);
                    }}
                    className="input mt-1 w-full"
                    aria-label={`Model for ${label}`}
                    data-testid={`ai-model-${provider}`}
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
                      onClick={() => void loadEstimate(provider, currentModel || undefined)}
                      disabled={estimateLoading[provider]}
                      data-testid={`ai-estimate-button-${provider}`}
                    >
                      {estimateLoading[provider] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Preview cost'
                      )}
                    </button>
                  </div>
                  {estimate ? (
                    <p className="mt-1.5 text-10.5 text-text-secondary" data-testid={`ai-estimate-${provider}`}>
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
          {!statusesLoaded && (
            <div
              className="flex items-center gap-2 rounded-7 border border-border-muted bg-bg-secondary/60 px-3 py-2 text-sm text-text-muted"
              aria-label="Checking CLI providers"
              data-testid="ai-cli-pending"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" aria-hidden="true" />
              Checking CLI providers…
            </div>
          )}
          {statusesLoaded && statusLoadFailed && (
            <p className="text-xs text-text-faint">Provider status could not be loaded.</p>
          )}
          {statusesLoaded && !statusLoadFailed && cliProviders.length === 0 && (
            <p className="text-sm text-text-muted">No CLI providers are registered.</p>
          )}
          {cliProviders.map((status) => (
            <div
              key={status.provider}
              className="flex items-center justify-between gap-2 rounded-7 border border-border-muted bg-bg-secondary/60 px-3 py-2"
              data-testid={`ai-provider-${status.provider}`}
            >
              <span className="text-12 font-medium capitalize text-text">
                {providerLabel(status.provider, status.displayName)}
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

      <AddProviderDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        configuredProviders={summary.providers}
        storageUnavailableReason={storageUnavailable}
        onAdded={(text) => {
          setMessage({ tone: 'ok', text });
          void refreshAll();
        }}
      />
    </div>
  );
}
