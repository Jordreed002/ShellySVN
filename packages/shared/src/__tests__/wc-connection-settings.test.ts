/**
 * Tests for the shared per-working-copy connection settings (#90/#91).
 *
 * This module is the single source of truth used by BOTH the renderer's
 * settings UI and the main-process SVN executor — these tests pin the
 * parsing hardening and the override → linked profile → URL-matched profile
 * → global precedence both sides rely on.
 */
import { describe, expect, it } from 'vitest';

import type { ConnectionProfile, ProxySettings, WorkingCopyOverride } from '../types';
import {
  findSuggestedProfile,
  normalizeWcPathKey,
  parseConnectionProfiles,
  parseWorkingCopyOverrides,
  resolveWcOperationContext,
  type WorkingCopyOverrideMap,
} from '../wc-connection-settings';

const PROXY_A: ProxySettings = {
  enabled: true,
  host: 'override-proxy.example.com',
  port: 3128,
  username: '',
  password: '',
  bypassForLocal: true,
};

const PROXY_B: ProxySettings = {
  enabled: true,
  host: 'profile-proxy.example.com',
  port: 8888,
  username: 'p',
  password: 'q',
  bypassForLocal: false,
};

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return { id: 'profile-1', name: 'Work', createdAt: 1, updatedAt: 1, ...overrides };
}

function override(overrides: Partial<WorkingCopyOverride> = {}): WorkingCopyOverride {
  return {
    version: 1,
    workingCopyPath: 'C:\\wc',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseWorkingCopyOverrides (shared home)', () => {
  it('reads the versioned envelope and drops hostile entries', () => {
    const map = parseWorkingCopyOverrides({
      version: 1,
      overrides: {
        'C:\\wc': { ...override(), profileId: ' profile-1 ' },
        '': override(),
        constructor: override(),
        notAnObject: 42,
      },
    });
    expect(Object.keys(map)).toEqual(['C:\\wc']);
    expect(map['C:\\wc'].profileId).toBe('profile-1');
  });

  it('sanitizes proxy port and clamps lengths', () => {
    const map = parseWorkingCopyOverrides({
      overrides: {
        '/wc': {
          ...override(),
          proxy: { enabled: true, host: 'h'.repeat(600), port: 99999, username: '', password: '', bypassForLocal: undefined },
        },
      },
    });
    expect(map['/wc'].proxy).toMatchObject({ host: 'h'.repeat(500), port: 65535, bypassForLocal: true });
  });
});

describe('parseConnectionProfiles (shared home)', () => {
  it('keeps only well-formed, non-secret entries', () => {
    const profiles = parseConnectionProfiles({
      version: 1,
      profiles: [
        profile({ proxy: PROXY_B, credentialsProfileId: 'realm-1' }),
        { id: '', name: 'no id' },
        'garbage',
      ],
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: 'profile-1', credentialsProfileId: 'realm-1' });
  });
});

describe('normalizeWcPathKey', () => {
  it('unifies separators, trailing slashes, and case', () => {
    expect(normalizeWcPathKey('C:\\WC\\')).toBe(normalizeWcPathKey('c:/wc'));
    expect(normalizeWcPathKey('/home/user/wc/')).toBe('/home/user/wc');
  });
});

describe('resolveWcOperationContext precedence', () => {
  const profiles: ConnectionProfile[] = [
    profile({ id: 'linked', name: 'Linked', proxy: PROXY_B, credentialsProfileId: 'profile-realm' }),
    profile({
      id: 'url',
      name: 'URL Match',
      repoUrlPattern: 'https://svn.acme.com/*',
      proxy: PROXY_B,
      credentialsProfileId: 'url-realm',
    }),
  ];

  function overridesFor(entry?: WorkingCopyOverride): WorkingCopyOverrideMap {
    return entry ? { [entry.workingCopyPath]: entry } : {};
  }

  it('returns none with no matching data', () => {
    const resolved = resolveWcOperationContext({
      overrides: {},
      profiles: [],
      workingCopyPath: 'C:\\wc',
      repoUrl: 'https://svn.acme.com/trunk',
    });
    expect(resolved.source).toBe('none');
    expect(resolved.context).toEqual({});
  });

  it('a direct proxy override wins over the linked profile', () => {
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ proxy: PROXY_A, profileId: 'linked' })),
      profiles,
      workingCopyPath: 'C:\\wc',
    });
    expect(resolved.source).toBe('override');
    expect(resolved.context.proxySettings).toBe(PROXY_A);
    // Unpinned fields still fall through to the linked profile.
    expect(resolved.credentialsProfileId).toBe('profile-realm');
  });

  it('an override without its own proxy inherits the linked profile', () => {
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ profileId: 'linked' })),
      profiles,
      workingCopyPath: 'C:\\wc',
    });
    expect(resolved.source).toBe('profile');
    expect(resolved.context.proxySettings).toBe(PROXY_B);
    expect(resolved.credentialsProfileId).toBe('profile-realm');
    expect(resolved.profileName).toBe('Linked');
  });

  it('a disabled override proxy still wins over an enabled profile proxy', () => {
    const disabled = { ...PROXY_A, enabled: false };
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ proxy: disabled, profileId: 'linked' })),
      profiles,
      workingCopyPath: 'C:\\wc',
    });
    expect(resolved.context.proxySettings).toBe(disabled);
  });

  it('per-field precedence: override credential realm over the profile realm, profile proxy when override has none', () => {
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ profileId: 'linked', credentialsProfileId: 'wc-realm' })),
      profiles,
      workingCopyPath: 'C:\\wc',
    });
    expect(resolved.source).toBe('override');
    expect(resolved.context.proxySettings).toBe(PROXY_B);
    expect(resolved.credentialsProfileId).toBe('wc-realm');
  });

  it('an override linking an unknown profile id yields none (foreign data)', () => {
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ profileId: 'missing' })),
      profiles,
      workingCopyPath: 'C:\\wc',
    });
    expect(resolved.source).toBe('none');
  });

  it('path lookup is separator/case-insensitive (Windows keys)', () => {
    const resolved = resolveWcOperationContext({
      overrides: overridesFor(override({ proxy: PROXY_A })),
      profiles: [],
      workingCopyPath: 'c:/WC/sub/dir/is/not/checked/here',
    });
    // The caller passes the WC ROOT; a non-root path must NOT match.
    expect(resolved.source).toBe('none');
    const rootResolved = resolveWcOperationContext({
      overrides: overridesFor(override({ proxy: PROXY_A })),
      profiles: [],
      workingCopyPath: 'c:/wc',
    });
    expect(rootResolved.context.proxySettings).toBe(PROXY_A);
  });

  it('repository-URL operations fall back to the URL-pattern-matched profile', () => {
    const resolved = resolveWcOperationContext({
      overrides: {},
      profiles,
      repoUrl: 'https://svn.acme.com/trunk',
    });
    expect(resolved.source).toBe('url-profile');
    expect(resolved.context.proxySettings).toBe(PROXY_B);
    expect(resolved.credentialsProfileId).toBe('url-realm');
  });

  it('URL-matched profiles never apply when the URL does not match', () => {
    const resolved = resolveWcOperationContext({
      overrides: {},
      profiles,
      repoUrl: 'https://svn.example.com/trunk',
    });
    expect(resolved.source).toBe('none');
  });

  it('profiles without patterns or without advised fields never match', () => {
    expect(findSuggestedProfile([profile()], 'https://svn.acme.com/x')).toBeUndefined();
    expect(findSuggestedProfile([profile({ repoUrlPattern: '   ' })], 'https://svn.acme.com/x')).toBeUndefined();
    const noValues = resolveWcOperationContext({
      overrides: {},
      profiles: [profile({ repoUrlPattern: '*' })],
      repoUrl: 'https://svn.acme.com/trunk',
    });
    expect(noValues.source).toBe('none');
  });
});
