/**
 * Connection profiles CRUD (#91).
 *
 * A named bundle of repository URL pattern, proxy settings, and a reference to
 * a saved credential realm. Changes persist immediately through the versioned
 * `window.api.store` key (like credentials in the Authentication tab — they do
 * not ride the dialog's Save/Cancel). Profiles never hold secrets: the
 * credential link is a realm string resolved by the existing auth system.
 */

import { useEffect, useState } from 'react';
import { Copy, Globe, Key, Loader2, Pencil, Plus, Shield, Trash2 } from 'lucide-react';

import type { AuthListEntry, ConnectionProfile, ProxySettings } from '@shared/types';

import {
  createProfile,
  duplicateProfile,
  loadConnectionProfiles,
  mutateConnectionProfiles,
  removeProfile,
  renameProfile,
  upsertProfile,
} from '../../lib/connectionProfiles';
import { SettingsGroup } from './SettingsGroup';

function defaultProxy(): ProxySettings {
  return { enabled: false, host: '', port: 8080, username: '', password: '', bypassForLocal: true };
}

function describeProxy(proxy: ProxySettings | undefined): string {
  if (!proxy?.enabled) return 'No proxy';
  const auth = proxy.username ? ' (authenticated)' : '';
  const bypass = proxy.bypassForLocal ? ', bypassing local' : '';
  return `proxy ${proxy.host || '?'}:${proxy.port}${auth}${bypass}`;
}

export function ConnectionProfilesSettings() {
  const [profiles, setProfiles] = useState<ConnectionProfile[] | null>(null);
  const [realms, setRealms] = useState<AuthListEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadConnectionProfiles().then((list) => {
      if (active) setProfiles(list);
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

  const mutate = async (
    mutator: (current: ConnectionProfile[]) => ConnectionProfile[],
    nextEditingId?: string | null
  ) => {
    setError(null);
    try {
      const next = await mutateConnectionProfiles(mutator);
      setProfiles(next);
      setEditingId(nextEditingId ?? null);
    } catch {
      setError('The profile could not be saved.');
    }
  };

  const startRename = (profile: ConnectionProfile) => {
    setEditingId(profile.id);
    setRenameValue(profile.name);
  };

  const commitRename = (profileId: string) => {
    void mutate((current) => renameProfile(current, profileId, renameValue), null);
  };

  const updateProfile = (profileId: string, patch: Partial<ConnectionProfile>) => {
    setProfiles((current) =>
      current
        ? current.map((candidate) =>
            candidate.id === profileId ? { ...candidate, ...patch, updatedAt: Date.now() } : candidate
          )
        : current
    );
  };

  const commitProfile = async (profile: ConnectionProfile) => {
    await mutate((current) => upsertProfile(current, profile), null);
  };

  const toggleProxy = (profile: ConnectionProfile, enabled: boolean) => {
    const proxy = profile.proxy ?? defaultProxy();
    updateProfile(profile.id, { proxy: { ...proxy, enabled } });
  };

  const updateProxyField = (
    profile: ConnectionProfile,
    field: keyof ProxySettings,
    value: ProxySettings[keyof ProxySettings]
  ) => {
    const proxy = profile.proxy ?? defaultProxy();
    updateProfile(profile.id, { proxy: { ...proxy, [field]: value } });
  };

  return (
    <SettingsGroup
      title="Connection Profiles"
      description="Reusable repo URL pattern, proxy, and credential bundles — saved immediately"
    >
      <div className="space-y-3">
        {error && (
          <p className="text-xs text-error" role="alert">
            {error}
          </p>
        )}

        {profiles === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading profiles…
          </div>
        ) : (
          <>
            {profiles.length === 0 && (
              <p className="text-sm text-text-muted">
                No profiles yet. Working copies can link to a profile to inherit its proxy and
                credential settings.
              </p>
            )}

            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-3"
                data-testid={`profile-${profile.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  {editingId === profile.id ? (
                    <span className="flex flex-1 items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        className="input flex-1 text-sm"
                        aria-label={`Rename profile ${profile.name}`}
                        data-testid={`profile-rename-${profile.id}`}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => commitRename(profile.id)}
                        disabled={!renameValue.trim()}
                      >
                        Rename
                      </button>
                    </span>
                  ) : (
                    <p className="text-sm font-medium text-text">{profile.name}</p>
                  )}
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                      onClick={() => startRename(profile)}
                      aria-label={`Rename profile ${profile.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                      onClick={() => void mutate((current) => duplicateProfile(current, profile.id))}
                      aria-label={`Duplicate profile ${profile.name}`}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-sm text-error hover:bg-error/10"
                      onClick={() => void mutate((current) => removeProfile(current, profile.id))}
                      aria-label={`Delete profile ${profile.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>

                <label className="block">
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Globe className="h-3 w-3" aria-hidden="true" />
                    Repository URL pattern (optional, `*` wildcard)
                  </span>
                  <input
                    type="text"
                    value={profile.repoUrlPattern ?? ''}
                    onChange={(event) => updateProfile(profile.id, { repoUrlPattern: event.target.value })}
                    onBlur={() => void commitProfile(profile)}
                    placeholder="https://svn.example.com/*"
                    className="input mt-1 w-full font-mono text-xs"
                    aria-label={`Repository URL pattern for ${profile.name}`}
                  />
                </label>

                <div className="rounded-7 border border-border-muted bg-bg-sunk/60 p-2.5">
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={profile.proxy?.enabled ?? false}
                      onChange={(event) => toggleProxy(profile, event.target.checked)}
                      className="checkbox"
                    />
                    Proxy for this profile
                  </label>
                  {profile.proxy?.enabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                      <input
                        type="text"
                        value={profile.proxy.host}
                        onChange={(event) => updateProxyField(profile, 'host', event.target.value)}
                        onBlur={() => void commitProfile(profile)}
                        placeholder="proxy.example.com"
                        className="input text-xs"
                        aria-label={`Proxy host for ${profile.name}`}
                      />
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={profile.proxy.port}
                        onChange={(event) =>
                          updateProxyField(profile, 'port', Number(event.target.value) || 8080)
                        }
                        onBlur={() => void commitProfile(profile)}
                        className="input text-xs"
                        aria-label={`Proxy port for ${profile.name}`}
                      />
                      <input
                        type="text"
                        value={profile.proxy.username}
                        onChange={(event) => updateProxyField(profile, 'username', event.target.value)}
                        onBlur={() => void commitProfile(profile)}
                        placeholder="Username (optional)"
                        className="input text-xs"
                        aria-label={`Proxy username for ${profile.name}`}
                      />
                      <input
                        type="password"
                        value={profile.proxy.password}
                        onChange={(event) => updateProxyField(profile, 'password', event.target.value)}
                        onBlur={() => void commitProfile(profile)}
                        placeholder="Password (optional)"
                        className="input text-xs"
                        aria-label={`Proxy password for ${profile.name}`}
                      />
                    </div>
                  )}
                </div>

                <label className="block">
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Key className="h-3 w-3" aria-hidden="true" />
                    Credential realm (reference — secrets stay in the credential store)
                  </span>
                  <select
                    value={profile.credentialsProfileId ?? ''}
                    onChange={(event) =>
                      void commitProfile({
                        ...profile,
                        credentialsProfileId: event.target.value || undefined,
                      })
                    }
                    className="input mt-1 w-full text-xs"
                    aria-label={`Credential realm for ${profile.name}`}
                  >
                    <option value="">(repository default)</option>
                    {realms.map((realm) => (
                      <option key={realm.realm} value={realm.realm}>
                        {realm.username} — {realm.realm}
                      </option>
                    ))}
                  </select>
                </label>

                <p className="flex items-center gap-1.5 text-10 text-text-faint">
                  <Shield className="h-3 w-3" aria-hidden="true" />
                  {describeProxy(profile.proxy)}
                  {profile.credentialsProfileId
                    ? ` · credential ${profile.credentialsProfileId}`
                    : ' · repository default credentials'}
                </p>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void mutate((current) => [...current, createProfile('New profile')])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Profile
            </button>
          </>
        )}
      </div>
    </SettingsGroup>
  );
}
