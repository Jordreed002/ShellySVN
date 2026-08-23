/**
 * Per-working-copy overrides (#90).
 *
 * Lists known working copies (repository recents + bookmarks, the same source
 * the sidebar derives its roots from) and offers an override editor: proxy
 * override, connection-profile link, credential reference, and a read-only AI
 * opt-in row (the consent toggle keeps its single write path — we only surface
 * its state). Effective values show where each setting comes from
 * (override → linked profile → global), and a profile whose repo URL pattern
 * matches the working copy's URL is offered as a suggested link.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Globe,
  Info,
  Key,
  Sparkles,
  Trash2,
} from 'lucide-react';

import type { AppSettings, AuthListEntry, ConnectionProfile, ProxySettings } from '@shared/types';

import {
  findSuggestedProfile,
  loadConnectionProfiles,
} from '../../lib/connectionProfiles';
import {
  listKnownWorkingCopies,
  loadWorkingCopyOverrides,
  persistOverride,
  persistOverrideRemoval,
  readAiOptInState,
  resolveEffectiveCredential,
  resolveEffectiveProxy,
  type AiOptInState,
  type WorkingCopyOverrideMap,
} from '../../lib/workingCopyOverrides';
import { SettingsGroup } from './SettingsGroup';

function globalProxyFrom(settings: AppSettings): ProxySettings {
  return settings.proxySettings;
}

function leafName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function describeProxy(proxy: ProxySettings): string {
  if (!proxy.enabled) return 'proxy disabled';
  return `proxy ${proxy.host || '?'}:${proxy.port}`;
}

function describeAiState(state: AiOptInState): string {
  if (state === 'enabled') return 'AI enabled for this working copy';
  if (state === 'disabled') return 'AI declined for this working copy';
  return 'AI consent not set';
}

interface RepoUrls {
  [workingCopyPath: string]: string | undefined;
}

export function WorkingCopiesSettings({ settings }: { settings: AppSettings }) {
  // Memoized on the underlying arrays so unrelated settings edits do not
  // retrigger the info/consent loads below.
  const recentRepositories = settings.recentRepositories;
  const bookmarks = settings.bookmarks;
  const knownPaths = useMemo(
    () => listKnownWorkingCopies({ recentRepositories, bookmarks } as AppSettings),
    [recentRepositories, bookmarks]
  );
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [overrides, setOverrides] = useState<WorkingCopyOverrideMap>({});
  const [realms, setRealms] = useState<AuthListEntry[]>([]);
  const [repoUrls, setRepoUrls] = useState<RepoUrls>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiStates, setAiStates] = useState<Record<string, AiOptInState>>({});

  useEffect(() => {
    let active = true;
    void loadConnectionProfiles().then((list) => {
      if (active) setProfiles(list);
    });
    void loadWorkingCopyOverrides().then((map) => {
      if (active) setOverrides(map);
    });
    void window.api.auth
      .list()
      .then((list) => {
        if (active) setRealms(list);
      })
      .catch(() => {
        if (active) setRealms([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Repository URLs (for pattern-based profile suggestions) and the read-only
  // AI consent state per working copy.
  useEffect(() => {
    let active = true;
    for (const path of knownPaths.slice(0, 20)) {
      void window.api.svn
        .info(path)
        .then((info) => {
          if (active && info.url) {
            setRepoUrls((current) => ({ ...current, [path]: info.url }));
          }
        })
        .catch(() => undefined);
      void readAiOptInState(path).then((state) => {
        if (active) setAiStates((current) => ({ ...current, [path]: state }));
      });
    }
    return () => {
      active = false;
    };
  }, [knownPaths]);

  const saveOverride = async (
    workingCopyPath: string,
    patch: Parameters<typeof persistOverride>[1]
  ) => {
    const next = await persistOverride(workingCopyPath, patch);
    setOverrides(next);
  };

  const clearOverride = async (workingCopyPath: string) => {
    const next = await persistOverrideRemoval(workingCopyPath);
    setOverrides(next);
  };

  /** Patch one proxy field on a working copy's override (or the global copy). */
  const saveProxyField = (
    workingCopyPath: string,
    field: keyof ProxySettings,
    value: ProxySettings[keyof ProxySettings]
  ) => {
    const base = overrides[workingCopyPath]?.proxy ?? globalProxyFrom(settings);
    const proxy: ProxySettings = { ...base, [field]: value };
    return saveOverride(workingCopyPath, {
      profileId: overrides[workingCopyPath]?.profileId,
      credentialsProfileId: overrides[workingCopyPath]?.credentialsProfileId,
      proxy,
    });
  };

  return (
    <SettingsGroup
      title="Working Copies"
      description="Per-working-copy overrides for proxy, credentials, and AI — saved immediately"
    >
      <div className="space-y-2">
        {knownPaths.length === 0 && (
          <p className="text-sm text-text-muted">
            No known working copies yet. Open a repository to populate this list.
          </p>
        )}

        {knownPaths.map((path) => {
          const isOpen = expanded === path;
          const override = overrides[path];
          const effectiveProxy = resolveEffectiveProxy(
            globalProxyFrom(settings),
            profiles,
            overrides,
            path
          );
          const effectiveCredential = resolveEffectiveCredential(profiles, overrides, path);
          const repoUrl = repoUrls[path];
          const suggested = repoUrl
            ? findSuggestedProfile(
                profiles,
                repoUrl
              )
            : undefined;
          const showSuggestion =
            suggested && suggested.id !== override?.profileId ? suggested : undefined;
          const proxyFields = override?.proxy ?? { ...globalProxyFrom(settings) };
          return (
            <div
              key={path}
              className="rounded-lg border border-border bg-bg-tertiary"
              data-testid={`wc-override-${path}`}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => setExpanded(isOpen ? null : path)}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                )}
                <FolderTree className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">{leafName(path)}</span>
                  <span className="block truncate text-10.5 text-text-muted" title={path}>
                    {path}
                  </span>
                </span>
                <span className="shrink-0 text-10 text-text-faint">
                  {effectiveProxy.source === 'global'
                    ? 'inherits global'
                    : effectiveProxy.source === 'profile'
                      ? `profile: ${effectiveProxy.profileName}`
                      : 'proxy override'}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-border px-3 py-3">
                  {repoUrl && (
                    <p className="truncate font-mono text-10 text-text-faint" title={repoUrl}>
                      {repoUrl}
                    </p>
                  )}

                  <label className="block">
                    <span className="text-xs text-text-muted">Connection profile</span>
                    <select
                      value={override?.profileId ?? ''}
                      onChange={(event) =>
                        void saveOverride(path, {
                          ...override,
                          proxy: override?.proxy,
                          credentialsProfileId: override?.credentialsProfileId,
                          profileId: event.target.value || undefined,
                        })
                      }
                      className="input mt-1 w-full text-sm"
                      aria-label={`Connection profile for ${leafName(path)}`}
                    >
                      <option value="">(no profile)</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {showSuggestion && (
                    <p
                      className="flex items-center gap-1.5 rounded-7 border border-accent/30 bg-accent/10 px-2 py-1.5 text-10.5 text-accent"
                      data-testid={`wc-suggested-profile-${path}`}
                    >
                      <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        Suggested: <strong>{showSuggestion.name}</strong> matches this repository URL.
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm text-10"
                        onClick={() =>
                          void saveOverride(path, {
                            ...override,
                            proxy: override?.proxy,
                            credentialsProfileId: override?.credentialsProfileId,
                            profileId: showSuggestion.id,
                          })
                        }
                      >
                        Link
                      </button>
                    </p>
                  )}

                  <div className="rounded-7 border border-border-muted bg-bg-sunk/60 p-2.5">
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={override?.proxy?.enabled ?? false}
                        onChange={(event) =>
                          void saveOverride(path, {
                            ...override,
                            profileId: override?.profileId,
                            credentialsProfileId: override?.credentialsProfileId,
                            proxy: {
                              ...proxyFields,
                              enabled: event.target.checked,
                            },
                          })
                        }
                        className="checkbox"
                      />
                      Override proxy for this working copy
                    </label>
                    <p className="mt-1 pl-6 text-10 text-text-muted">
                      Effective: {describeProxy(effectiveProxy.proxy)} —{' '}
                      {effectiveProxy.source === 'override'
                        ? 'this override'
                        : effectiveProxy.source === 'profile'
                          ? `inherited from profile "${effectiveProxy.profileName}"`
                          : 'inherited from global settings'}
                      {effectiveProxy.source !== 'global' && ' (applies to this working copy)'}
                    </p>
                    {override?.proxy?.enabled && (
                      <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                        <input
                          type="text"
                          value={override.proxy.host}
                          onChange={(event) =>
                            void saveProxyField(path, 'host', event.target.value)
                          }
                          placeholder="proxy.example.com"
                          className="input text-xs"
                          aria-label={`Proxy host override for ${leafName(path)}`}
                        />
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={override.proxy.port}
                          onChange={(event) =>
                            void saveProxyField(path, 'port', Number(event.target.value) || 8080)
                          }
                          className="input text-xs"
                          aria-label={`Proxy port override for ${leafName(path)}`}
                        />
                        <input
                          type="text"
                          value={override.proxy.username}
                          onChange={(event) =>
                            void saveProxyField(path, 'username', event.target.value)
                          }
                          placeholder="Username (optional)"
                          className="input text-xs"
                          aria-label={`Proxy username override for ${leafName(path)}`}
                        />
                        <input
                          type="password"
                          value={override.proxy.password}
                          onChange={(event) =>
                            void saveProxyField(path, 'password', event.target.value)
                          }
                          placeholder="Password (optional)"
                          className="input text-xs"
                          aria-label={`Proxy password override for ${leafName(path)}`}
                        />
                      </div>
                    )}
                  </div>

                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      <Key className="h-3 w-3" aria-hidden="true" />
                      Credential realm
                    </span>
                    <select
                      value={override?.credentialsProfileId ?? ''}
                      onChange={(event) =>
                        void saveOverride(path, {
                          ...override,
                          profileId: override?.profileId,
                          proxy: override?.proxy,
                          credentialsProfileId: event.target.value || undefined,
                        })
                      }
                      className="input mt-1 w-full text-sm"
                      aria-label={`Credential realm for ${leafName(path)}`}
                    >
                      <option value="">
                        (repository default
                        {effectiveCredential.source === 'profile'
                          ? ` — inherited from profile "${effectiveCredential.profileName}"`
                          : ''}
                        )
                      </option>
                      {realms.map((realm) => (
                        <option key={realm.realm} value={realm.realm}>
                          {realm.username} — {realm.realm}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-center justify-between gap-2 rounded-7 border border-border-muted bg-bg-sunk/60 px-2.5 py-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-10.5 text-text-secondary">
                      <Sparkles className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                      {describeAiState(aiStates[path] ?? 'unset')} — managed per working copy in the
                      commit dialog and AI review center.
                    </p>
                    <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-9.5 uppercase text-text-faint">
                      read-only
                    </span>
                  </div>

                  {override && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-error hover:bg-error/10"
                        onClick={() => void clearOverride(path)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove overrides
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <p className="flex items-start gap-1.5 text-10 text-text-faint">
          <Globe className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Proxy overrides currently advise the UI and stored working-copy preferences; routing every
          SVN network call through them is main-process work in progress.
        </p>
      </div>
    </SettingsGroup>
  );
}
