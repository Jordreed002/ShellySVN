import { describe, expect, it } from 'vitest';

import { mergeSettings } from '@shared/settings-defaults';
import type { AppSettings, ConnectionProfile, ProxySettings } from '@shared/types';

import {
  listKnownWorkingCopies,
  parseWorkingCopyOverrides,
  removeOverride,
  resolveEffectiveCredential,
  resolveEffectiveProxy,
  suggestedProfileForWorkingCopy,
  upsertOverride,
  WORKING_COPY_OVERRIDES_STORE_KEY,
} from '../workingCopyOverrides';

function proxy(overrides: Partial<ProxySettings> = {}): ProxySettings {
  return { enabled: false, host: '', port: 8080, username: '', password: '', bypassForLocal: true, ...overrides };
}

function profiles(): ConnectionProfile[] {
  return [
    {
      id: 'prof-a',
      name: 'Acme',
      createdAt: 1,
      updatedAt: 1,
      repoUrlPattern: 'https://svn.acme.com/*',
      proxy: proxy({ enabled: true, host: 'acme-proxy', port: 3128 }),
      credentialsProfileId: 'acme-realm',
    },
    { id: 'prof-b', name: 'Bare', createdAt: 1, updatedAt: 1 },
  ];
}

describe('override store parsing', () => {
  it('reads the versioned envelope keyed by working-copy root', () => {
    const map = parseWorkingCopyOverrides({
      version: 1,
      overrides: {
        '/repos/one': { version: 1, workingCopyPath: '/repos/one', updatedAt: '2026-01-01T00:00:00Z', profileId: 'prof-a' },
      },
    });
    expect(map['/repos/one'].profileId).toBe('prof-a');
  });

  it('drops invalid entries and prototype keys without throwing', () => {
    const map = parseWorkingCopyOverrides({
      version: 1,
      overrides: {
        __proto__: { version: 1, workingCopyPath: 'x', updatedAt: 'x' },
        '/bad': 'not an object',
        '/good': { version: 1, workingCopyPath: '/good', updatedAt: '2026-01-01T00:00:00Z', aiOptIn: true },
      },
    });
    expect(Object.keys(map)).toEqual(['/good']);
    expect(map['/good'].aiOptIn).toBe(true);
  });

  it('clamps hostile proxy values inside an override', () => {
    const map = parseWorkingCopyOverrides({
      version: 1,
      overrides: {
        '/w': { version: 1, workingCopyPath: '/w', updatedAt: 'x', proxy: { enabled: 'yes', host: 42, port: 'big' } },
      },
    });
    expect(map['/w'].proxy).toEqual({ enabled: false, host: '', port: 8080, username: '', password: '', bypassForLocal: true });
  });

  it('upserts and removes single entries without touching others', () => {
    let map = upsertOverride({}, '/a', { profileId: 'p' });
    map = upsertOverride(map, '/b', { proxy: proxy({ host: 'h' }) });
    expect(Object.keys(map)).toEqual(['/a', '/b']);
    map = upsertOverride(map, '/a', { credentialsProfileId: 'realm' });
    expect(map['/a'].credentialsProfileId).toBe('realm');
    expect(map['/a'].profileId).toBeUndefined();
    map = removeOverride(map, '/b');
    expect(Object.keys(map)).toEqual(['/a']);
    expect(removeOverride(map, '/missing')).toEqual(map);
  });

  it('uses the documented versioned store key', () => {
    expect(WORKING_COPY_OVERRIDES_STORE_KEY).toBe('shellysvn:wc-overrides:v1');
  });
});

describe('effective-value resolution (override > profile > global)', () => {
  const globalProxy = proxy({ enabled: true, host: 'global-proxy', port: 8888 });

  it('falls back to global settings when nothing is overridden', () => {
    const result = resolveEffectiveProxy(globalProxy, profiles(), {}, '/repos/one');
    expect(result.source).toBe('global');
    expect(result.proxy.host).toBe('global-proxy');
  });

  it('inherits from the linked profile', () => {
    const overrides = parseWorkingCopyOverrides({
      version: 1,
      overrides: { '/repos/one': { version: 1, workingCopyPath: '/repos/one', updatedAt: 'x', profileId: 'prof-a' } },
    });
    const result = resolveEffectiveProxy(globalProxy, profiles(), overrides, '/repos/one');
    expect(result.source).toBe('profile');
    expect(result.profileName).toBe('Acme');
    expect(result.proxy.host).toBe('acme-proxy');
  });

  it('a direct override wins over the linked profile and global', () => {
    const overrides = parseWorkingCopyOverrides({
      version: 1,
      overrides: {
        '/repos/one': {
          version: 1,
          workingCopyPath: '/repos/one',
          updatedAt: 'x',
          profileId: 'prof-a',
          proxy: proxy({ enabled: true, host: 'wc-proxy', port: 1 }),
        },
      },
    });
    const result = resolveEffectiveProxy(globalProxy, profiles(), overrides, '/repos/one');
    expect(result.source).toBe('override');
    expect(result.proxy.host).toBe('wc-proxy');
  });

  it('a profile without a proxy falls back to global', () => {
    const overrides = parseWorkingCopyOverrides({
      version: 1,
      overrides: { '/repos/two': { version: 1, workingCopyPath: '/repos/two', updatedAt: 'x', profileId: 'prof-b' } },
    });
    const result = resolveEffectiveProxy(globalProxy, profiles(), overrides, '/repos/two');
    expect(result.source).toBe('global');
  });

  it('a dangling profile id degrades to global', () => {
    const overrides = parseWorkingCopyOverrides({
      version: 1,
      overrides: { '/w': { version: 1, workingCopyPath: '/w', updatedAt: 'x', profileId: 'deleted' } },
    });
    expect(resolveEffectiveProxy(globalProxy, profiles(), overrides, '/w').source).toBe('global');
  });

  it('resolves credential references through the same chain', () => {
    const linked = parseWorkingCopyOverrides({
      version: 1,
      overrides: { '/one': { version: 1, workingCopyPath: '/one', updatedAt: 'x', profileId: 'prof-a' } },
    });
    expect(resolveEffectiveCredential(profiles(), linked, '/one')).toEqual({
      credentialsProfileId: 'acme-realm',
      source: 'profile',
      profileName: 'Acme',
    });
    const direct = upsertOverride(linked, '/one', { profileId: 'prof-a', credentialsProfileId: 'wc-realm' });
    expect(resolveEffectiveCredential(profiles(), direct, '/one').source).toBe('override');
    expect(resolveEffectiveCredential(profiles(), direct, '/other').source).toBe('default');
  });
});

describe('known working copies and suggestions', () => {
  it('lists bookmarks first, then recents, deduped', () => {
    const settings = mergeSettings({
      recentRepositories: ['/repos/b', '/repos/a', '/repos/b', ''],
      bookmarks: [{ path: '/repos/star', name: 'Star', addedAt: 1 }],
    } as Partial<AppSettings>);
    expect(listKnownWorkingCopies(settings)).toEqual(['/repos/star', '/repos/b', '/repos/a']);
  });

  it('surfaces a matching profile as a suggestion for the repo URL', () => {
    expect(suggestedProfileForWorkingCopy(profiles(), 'https://svn.acme.com/trunk')?.id).toBe('prof-a');
    expect(suggestedProfileForWorkingCopy(profiles(), undefined)).toBeUndefined();
    expect(suggestedProfileForWorkingCopy(profiles(), 'https://elsewhere')).toBeUndefined();
  });
});
