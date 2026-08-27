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
 * verbatim and key saving is disabled. CLI providers run on the user's own CLI
 * login (whatever method the CLI stores): each row reports version, signed-in
 * account, and plan, and can be toggled out of ShellySVN entirely via
 * `aiCommit.disabledCliProviders`. The AI Commit Messages group also lives
 * here (moved from the SVN tab): provider preference, CLI model choices,
 * privacy/size limits, provider budgets, and usage metadata — all written
 * through `useSettings`. The page paints from the fast `credentials.summary`
 * read; provider statuses (slow CLI probes) fill in progressively, and a
 * failed status probe degrades to "Status unknown." lines instead of failing
 * the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';

import type {
  AiCommitProvider,
  AiCommitProviderStatus,
  AiCostEstimate,
  AiCredentialsSummary,
  AiModelInfo,
  AiProviderId,
  AiUsageEntry,
  AppSettings,
} from '@shared/types';

import { useSettings } from '../../hooks/useSettings';
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

function clampedInteger(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function statusLine(status: AiCommitProviderStatus | undefined): string {
  if (!status) return 'Status unknown.';
  if (status.available) {
    return status.version ? `Available (${status.version})` : 'Available';
  }
  if (status.reason) return status.reason;
  if (status.kind === 'cli') return 'Not installed or not signed in.';
  return 'Not configured.';
}

/** 'codex-cli 0.150.1' → 'v0.150.1'; falls back to the raw probe output. */
function versionChip(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const semver = /\d+\.\d+\.\d+(?:[-+.\w]*)/.exec(version)?.[0];
  return semver ? `v${semver}` : version.slice(0, 40);
}

const CLI_DOCUMENTATION_URLS: Record<string, string> = {
  codex: 'https://developers.openai.com/codex',
  claude: 'https://docs.claude.com/en/docs/claude-code/overview',
};

/** The OpenAI knot, monochrome like the CLI's own branding. */
function CodexMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.877-1.041l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.376-3.454l-.142.08L8.704 5.46a.795.795 0 0 0-.393.68zm1.098-2.366 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

/** Claude's eight-ray spark, drawn so it survives icon-size rendering. */
function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="8" />
        <line x1="12" y1="16" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="8" y2="12" />
        <line x1="16" y1="12" x2="21.5" y2="12" />
        <line x1="5.28" y1="5.28" x2="9.11" y2="9.11" />
        <line x1="14.89" y1="14.89" x2="18.72" y2="18.72" />
        <line x1="5.28" y1="18.72" x2="9.11" y2="14.89" />
        <line x1="14.89" y1="9.11" x2="18.72" y2="5.28" />
      </g>
    </svg>
  );
}

function cliMark(provider: AiProviderId, className: string) {
  if (provider === 'claude') return <ClaudeMark className={className} />;
  if (provider === 'codex') return <CodexMark className={className} />;
  return null;
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
  const [expandedCli, setExpandedCli] = useState<AiProviderId | null>(null);
  const { settings, updateSettings } = useSettings();

  const disabledClis = new Set(settings.aiCommit.disabledCliProviders ?? []);

  const [aiUsage, setAiUsage] = useState<AiUsageEntry[]>([]);

  /** Partial-settings writer for the commit-message controls below. */
  const setAiCommit = (fields: Partial<AppSettings['aiCommit']>) => {
    // The settings hook deep-merges, but its partial type stops at the first
    // interface boundary — send the whole aiCommit object.
    void updateSettings({ aiCommit: { ...settings.aiCommit, ...fields } });
  };

  /** Toggling off removes the CLI from auto selection and explicit use. */
  const toggleCliProvider = (provider: AiCommitProvider, nextEnabled: boolean) => {
    const next = new Set(settings.aiCommit.disabledCliProviders ?? []);
    if (nextEnabled) next.delete(provider);
    else next.add(provider);
    setAiCommit({ disabledCliProviders: [...next] });
  };

  // The merged Provider & model select encodes CLI picks as '<provider>:<model>';
  // plain values are 'auto', built-in HTTP ids, or 'custom:<slug>' ids.
  const providerChoice =
    settings.aiCommit.provider === 'codex'
      ? `codex:${settings.aiCommit.codexModel}`
      : settings.aiCommit.provider === 'claude'
        ? `claude:${settings.aiCommit.claudeModel}`
        : settings.aiCommit.provider;
  const changeProviderChoice = (value: string) => {
    if (value.startsWith('codex:')) {
      setAiCommit({
        provider: 'codex',
        codexModel: value.slice('codex:'.length) as AppSettings['aiCommit']['codexModel'],
      });
    } else if (value.startsWith('claude:')) {
      setAiCommit({
        provider: 'claude',
        claudeModel: value.slice('claude:'.length) as AppSettings['aiCommit']['claudeModel'],
      });
    } else {
      setAiCommit({ provider: value as AppSettings['aiCommit']['provider'] });
    }
  };

  const cliAuthLine = (status: AiCommitProviderStatus): string => {
    if (disabledClis.has(status.provider as AiCommitProvider)) return 'Disabled in ShellySVN.';
    if (status.available) {
      if (status.accountEmail) {
        return status.planLabel
          ? `Authenticated as ${status.accountEmail} · ${status.planLabel}`
          : `Authenticated as ${status.accountEmail}`;
      }
      if (status.authMethod) return `Authenticated via ${status.authMethod}.`;
      return 'Ready.';
    }
    return statusLine(status);
  };

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    setStatuses(null);
    setStatusLoadFailed(false);
    // The summary is a fast local read and gates the render; provider
    // statuses spawn CLI probes main-side and fill in progressively. A
    // rejected status probe must not fail the page.
    const providerStatusesPromise = window.api.ai.providers().catch(() => null);
    // Usage metadata is display-only; a failure just means an empty list.
    window.api.ai
      .usageHistory()
      .then((entries) => setAiUsage(entries))
      .catch(() => setAiUsage([]));
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

  // Provider preference options: configured built-in HTTP providers, then
  // customs alphabetically — mirrors the credentials summary this page loads.
  const aiProviderOptions = useMemo(() => {
    const configured = summary?.providers ?? [];
    const options = HTTP_PROVIDER_ORDER.filter((id) =>
      configured.some((entry) => entry.provider === id)
    ).map((id) => ({ value: id as string, label: providerLabel(id) }));
    const customs = configured
      .filter((entry) => entry.provider.startsWith('custom:'))
      .toSorted((a, b) =>
        (a.displayName ?? a.provider).localeCompare(b.displayName ?? b.provider)
      );
    return [
      ...options,
      ...customs.map((entry) => ({
        value: entry.provider,
        label: providerLabel(entry.provider, entry.displayName),
      })),
    ];
  }, [summary]);
  // A stale preference (e.g. a deleted custom provider) must stay visible —
  // selects always show their current value — so it is appended, disabled.
  const staleProviderId =
    settings.aiCommit.provider === 'auto' ? undefined : settings.aiCommit.provider;
  const staleAiProvider =
    staleProviderId !== undefined &&
    staleProviderId !== 'codex' &&
    staleProviderId !== 'claude' &&
    !aiProviderOptions.some((option) => option.value === staleProviderId);
  // Undefined while the probe is in flight; the model select stays enabled so
  // a slow probe never blocks picking a preference.
  const claudeStatus = statusFor('claude');
  // A probe that has answered 'not signed in' makes the Claude aliases moot.
  const claudeReady = !claudeStatus || claudeStatus.available;

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
        description="ShellySVN invokes your own CLIs and reuses their stored login"
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
          {cliProviders.map((status) => {
            const provider = status.provider as AiCommitProvider;
            const enabled = !disabledClis.has(provider);
            const expanded = expandedCli === status.provider;
            const chip = versionChip(status.version);
            const docUrl = CLI_DOCUMENTATION_URLS[status.provider];
            return (
              <div
                key={status.provider}
                className="rounded-7 border border-border-muted bg-bg-secondary/60 px-3 py-2"
                data-testid={`ai-provider-${status.provider}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="relative shrink-0">
                    {cliMark(status.provider, 'h-5 w-5 text-text')}
                    <span
                      className={`absolute -left-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
                        !enabled
                          ? 'bg-text-faint'
                          : status.available
                            ? 'bg-success'
                            : 'bg-warning'
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="text-12 font-medium capitalize text-text">
                      {providerLabel(status.provider, status.displayName)}
                    </span>
                    {chip && (
                      <span className="truncate font-mono text-9.5 text-text-faint">{chip}</span>
                    )}
                  </span>
                  {docUrl && (
                    <button
                      type="button"
                      className="text-text-faint transition-colors hover:text-text"
                      aria-label={`Open ${status.provider} documentation`}
                      title="Open documentation"
                      onClick={() => void window.api.app.openExternal(docUrl)}
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="text-text-faint transition-colors hover:text-text"
                      aria-label={`Toggle ${status.provider} details`}
                      aria-expanded={expanded}
                      onClick={() => setExpandedCli(expanded ? null : status.provider)}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {provider === 'codex' || provider === 'claude' ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!enabled}
                        aria-label={`${enabled ? 'Disable' : 'Enable'} ${provider} for ShellySVN`}
                        className={`relative h-4 w-7 rounded-full transition-colors ${
                          enabled ? 'bg-accent' : 'bg-border-muted'
                        }`}
                        onClick={() => toggleCliProvider(provider, !enabled)}
                        data-testid={`ai-cli-toggle-${provider}`}
                      >
                        <span
                          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                            enabled ? 'left-3.5' : 'left-0.5'
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </span>
                </div>
                <p className="mt-1 text-10.5 text-text-muted">{cliAuthLine(status)}</p>
                {expanded && (
                  <div className="mt-1.5 space-y-0.5 border-t border-border-muted pt-1.5 text-10 text-text-faint">
                    {status.authMethod && <p>CLI login: {status.authMethod}</p>}
                    {status.planLabel && <p>Plan: {status.planLabel}</p>}
                    {status.version && <p className="font-mono">{status.version}</p>}
                    <p>
                      {enabled
                        ? 'Included in auto selection — the CLI runs with its own stored login.'
                        : 'Excluded from auto selection and explicit use.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-10.5 text-text-faint">
            Statuses refresh automatically; use the toggle to keep a CLI out of ShellySVN entirely.
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="AI Commit Messages"
        description="Draft an editable message from the files selected for commit"
        resetKeys={['aiCommit']}
      >
        <div className="space-y-4">
          <label
            className="flex items-start gap-3 cursor-pointer group"
            aria-label="Enable generated commit-message drafts"
          >
            <input
              type="checkbox"
              checked={settings.aiCommit.enabled}
              onChange={(event) => setAiCommit({ enabled: event.target.checked })}
              className="checkbox mt-0.5"
            />
            <span>
              <span className="flex items-center gap-2 text-sm text-text group-hover:text-accent">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                Enable generated commit-message drafts
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                Only runs when you press Generate. Selected filenames and bounded diff content are
                sent to the configured model provider.
              </span>
            </span>
          </label>

          <label className="block">
            <span className="text-xs text-text-muted">Provider &amp; model</span>
            <select
              value={providerChoice}
              onChange={(event) => changeProviderChoice(event.target.value)}
              disabled={!settings.aiCommit.enabled}
              title={
                claudeReady
                  ? undefined
                  : claudeStatus?.reason ?? 'Claude CLI is not signed in — its models are unavailable.'
              }
              className="input mt-1 w-full disabled:opacity-50"
            >
              <option value="auto">Auto (prefer Codex, then Claude)</option>
              <optgroup label="Codex CLI">
                <option value="codex:gpt-5.6-luna">GPT-5.6 Luna — fastest / lowest cost</option>
                <option value="codex:gpt-5.6-terra">GPT-5.6 Terra — balanced</option>
                <option value="codex:gpt-5.6-sol">GPT-5.6 Sol — highest capability</option>
              </optgroup>
              <optgroup label="Claude CLI">
                <option value="claude:sonnet" disabled={!claudeReady}>
                  Sonnet — balanced (recommended)
                </option>
                <option value="claude:opus" disabled={!claudeReady}>
                  Opus — highest capability
                </option>
                <option value="claude:haiku" disabled={!claudeReady}>
                  Haiku — fastest / lowest cost
                </option>
              </optgroup>
              {aiProviderOptions.length > 0 && (
                <optgroup label="HTTP providers">
                  {aiProviderOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {staleProviderId && staleAiProvider && (
                <option value={staleProviderId} disabled>
                  {providerLabel(staleProviderId)} (no longer configured)
                </option>
              )}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-text-muted">Message style</span>
            <select
              value={settings.aiCommit.style}
              onChange={(event) =>
                setAiCommit({ style: event.target.value as AppSettings['aiCommit']['style'] })
              }
              disabled={!settings.aiCommit.enabled}
              className="input mt-1 w-full disabled:opacity-50"
            >
              <option value="conventional">Conventional commit</option>
              <option value="concise">Concise summary</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-text-muted">Maximum diff sent (KiB)</span>
            <input
              type="number"
              min={32}
              max={512}
              step={32}
              value={Math.round(settings.aiCommit.maxDiffBytes / 1024)}
              onChange={(event) =>
                setAiCommit({
                  maxDiffBytes: clampedInteger(event.target.value, 32, 512, 256) * 1024,
                })
              }
              disabled={!settings.aiCommit.enabled}
              className="input mt-1 w-28 disabled:opacity-50"
            />
          </label>

          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={settings.aiCommit.confirmBeforeSending}
              onChange={(event) => setAiCommit({ confirmBeforeSending: event.target.checked })}
              disabled={!settings.aiCommit.enabled}
              className="checkbox"
            />
            Confirm before sending each selected diff
          </label>

          <div className="rounded-9 border border-border bg-bg-sunk/60 p-3">
            <label className="flex items-start gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={settings.aiCommit.includeRecentHistory}
                onChange={(event) => setAiCommit({ includeRecentHistory: event.target.checked })}
                disabled={!settings.aiCommit.enabled}
                className="checkbox mt-0.5"
              />
              <span>
                Match recent repository message style
                <span className="mt-1 block text-xs text-text-muted">
                  Sends a redacted sample of recent commit messages in addition to the selected
                  diff. This is a separate privacy choice and is disabled by default.
                </span>
              </span>
            </label>
            {settings.aiCommit.includeRecentHistory && (
              <label className="mt-3 block">
                <span className="text-xs text-text-muted">Recent messages sampled</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={settings.aiCommit.historyLimit}
                  onChange={(event) =>
                    setAiCommit({
                      historyLimit: clampedInteger(event.target.value, 1, 25, 10),
                    })
                  }
                  disabled={!settings.aiCommit.enabled}
                  className="input mt-1 w-24 disabled:opacity-50"
                />
              </label>
            )}
          </div>

          <div className="rounded-9 border border-border bg-bg-sunk/60 p-3">
            <div className="mb-3 text-10 font-semibold uppercase tracking-caps text-text-muted">
              Provider budgets
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-text-muted">Timeout (seconds)</span>
                <input
                  type="number"
                  min={15}
                  max={300}
                  step={15}
                  value={Math.round(settings.aiCommit.providerTimeoutMs / 1000)}
                  onChange={(event) =>
                    setAiCommit({
                      providerTimeoutMs: clampedInteger(event.target.value, 15, 300, 60) * 1000,
                    })
                  }
                  disabled={!settings.aiCommit.enabled}
                  className="input mt-1 w-full disabled:opacity-50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-text-muted">Calls per session</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={settings.aiCommit.maxSessionInvocations}
                  onChange={(event) =>
                    setAiCommit({
                      maxSessionInvocations: clampedInteger(event.target.value, 1, 500, 100),
                    })
                  }
                  disabled={!settings.aiCommit.enabled}
                  className="input mt-1 w-full disabled:opacity-50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-text-muted">History retention</span>
                <select
                  value={settings.aiCommit.usageRetentionDays}
                  onChange={(event) =>
                    setAiCommit({ usageRetentionDays: Number(event.target.value) })
                  }
                  disabled={!settings.aiCommit.enabled}
                  className="input mt-1 w-full disabled:opacity-50"
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
            </div>
            <p className="mt-2 text-10.5 text-text-faint">
              Budgets apply before a provider starts. Usage records contain task, provider, timing,
              size, and result only—never paths, prompts, diffs, or generated text.
            </p>
          </div>

          <p className="text-xs text-text-muted">
            ShellySVN runs your separately installed CLIs. Codex executes sandboxed read-only;
            Claude answers a single non-interactive turn. Both use the CLI's own stored login —
            subscription OAuth or API key, whichever you signed in with.
          </p>

          {settings.aiCommit.enabled && aiUsage.length > 0 && (
            <div className="rounded-9 border border-border bg-bg-sunk/60 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-10 font-semibold uppercase tracking-caps text-text-muted">
                  Recent AI activity
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-10.5"
                  onClick={async () => {
                    await window.api.ai.clearUsageHistory();
                    setAiUsage([]);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear metadata
                </button>
              </div>
              <div className="space-y-1.5">
                {aiUsage.slice(0, 8).map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-7 border border-border-muted bg-bg-secondary/60 px-3 py-2 text-10.5"
                  >
                    <span className="truncate text-text-secondary">
                      {entry.task.replaceAll('-', ' ')}
                    </span>
                    <span className="font-mono text-text-faint">
                      {entry.provider}
                      {entry.model ? ` · ${entry.model}` : ''} ·{' '}
                      {(entry.durationMs / 1000).toFixed(1)}s
                    </span>
                    <span
                      className={
                        entry.status === 'success'
                          ? 'text-success'
                          : entry.status === 'cancelled'
                            ? 'text-warning'
                            : 'text-error'
                      }
                    >
                      {entry.status}
                      {entry.errorCode ? ` · ${entry.errorCode.replaceAll('_', ' ')}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
