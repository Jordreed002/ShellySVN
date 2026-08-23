import { describe, expect, it } from 'vitest';

import type { ConnectionProfile } from '@shared/types';

import {
  CONNECTION_PROFILES_STORE_KEY,
  createProfile,
  duplicateProfile,
  findSuggestedProfile,
  parseConnectionProfiles,
  patternToRegExp,
  profileMatchesRepoUrl,
  removeProfile,
  renameProfile,
  SECRET_PROFILE_ROOT_KEYS,
  upsertProfile,
} from '../connectionProfiles';

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return { id: 'p1', name: 'Work', createdAt: 1, updatedAt: 1, ...overrides };
}

describe('connection profile store parsing', () => {
  it('reads the versioned envelope', () => {
    const parsed = parseConnectionProfiles({
      version: 1,
      profiles: [profile({ repoUrlPattern: 'https://svn.acme.com/*', credentialsProfileId: 'realm-1' })],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].repoUrlPattern).toBe('https://svn.acme.com/*');
    expect(parsed[0].credentialsProfileId).toBe('realm-1');
  });

  it('drops invalid entries instead of throwing', () => {
    const parsed = parseConnectionProfiles({
      version: 1,
      profiles: [profile(), { id: '', name: 'no id' }, { id: 'x' }, 'garbage', null, 42],
    });
    expect(parsed).toHaveLength(1);
  });

  it('round-trips a list through parse (the save path sanitizes the same way)', () => {
    const list = [profile(), profile({ id: 'p2', name: 'Home' })];
    const parsed = parseConnectionProfiles(list);
    expect(parsed.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('caps the persisted list length', () => {
    const many = Array.from({ length: 150 }, (_, index) => profile({ id: `p${index}` }));
    expect(parseConnectionProfiles({ version: 1, profiles: many })).toHaveLength(100);
  });

  it('clamps a hostile proxy port into range', () => {
    const parsed = parseConnectionProfiles({
      version: 1,
      profiles: [profile({ proxy: { enabled: true, host: 'h', port: 99999, username: '', password: '', bypassForLocal: true } })],
    });
    expect(parsed[0].proxy?.port).toBe(65535);
  });
});

describe('profiles never store secrets (#91)', () => {
  it('drops secret-looking keys smuggled onto a profile payload', () => {
    const hostile = {
      version: 1,
      profiles: [
        {
          id: 'p1',
          name: 'Evil',
          password: 'hunter2',
          apiKey: 'sk-123',
          api_key: 'sk-456',
          secret: 's',
          token: 't',
          clientSecret: 'cs',
          username: 'alice',
        },
      ],
    };
    const parsed = parseConnectionProfiles(hostile);
    expect(parsed).toHaveLength(1);
    const serialized = JSON.stringify(parsed[0]);
    for (const key of SECRET_PROFILE_ROOT_KEYS) {
      expect(parsed[0]).not.toHaveProperty(key);
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-123');
  });

  it('references credentials by realm id only', () => {
    const parsed = parseConnectionProfiles({
      version: 1,
      profiles: [profile({ credentialsProfileId: '<https://svn.example.com> VisualSVN Server' })],
    });
    expect(typeof parsed[0].credentialsProfileId).toBe('string');
    expect(parsed[0].credentialsProfileId).not.toContain('password');
  });
});

describe('repo URL pattern matching', () => {
  it('matches exactly and with wildcards', () => {
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'https://svn.acme.com/*' }), 'https://svn.acme.com/trunk')).toBe(true);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'https://svn.acme.com' }), 'https://svn.acme.com')).toBe(true);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'https://*.acme.com/*' }), 'https://svn.acme.com/trunk')).toBe(true);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'https://svn.acme.com/*' }), 'https://svn.other.com/trunk')).toBe(false);
  });

  it('is case-insensitive and treats ? as a single character', () => {
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'HTTPS://SVN.ACME.COM' }), 'https://svn.acme.com')).toBe(true);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'repo?' }), 'repo1')).toBe(true);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: 'repo?' }), 'repo12')).toBe(false);
  });

  it('escapes regex metacharacters in patterns', () => {
    expect(patternToRegExp('a.b+c').test('a.b+c')).toBe(true);
    expect(patternToRegExp('a.b+c').test('aXbYc')).toBe(false);
  });

  it('never matches on a missing or blank pattern', () => {
    expect(profileMatchesRepoUrl(profile(), 'https://svn.acme.com')).toBe(false);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: '   ' }), 'https://svn.acme.com')).toBe(false);
    expect(profileMatchesRepoUrl(profile({ repoUrlPattern: '*' }), '')).toBe(false);
  });

  it('suggests the first matching profile in list order', () => {
    const profiles = [
      profile({ id: 'a', repoUrlPattern: 'https://svn.other.com/*' }),
      profile({ id: 'b', repoUrlPattern: 'https://svn.acme.com/*' }),
    ];
    expect(findSuggestedProfile(profiles, 'https://svn.acme.com/trunk')?.id).toBe('b');
    expect(findSuggestedProfile(profiles, 'https://unknown.example.com')).toBeUndefined();
  });
});

describe('profile CRUD', () => {
  it('upserts by id, inserting new profiles at the end', () => {
    const list = [profile()];
    const updated = upsertProfile(list, { ...profile(), name: 'Renamed' });
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Renamed');
    const appended = upsertProfile(list, profile({ id: 'p2', name: 'Second' }));
    expect(appended.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('duplicates under a new id with a (copy) suffix', () => {
    const list = [profile()];
    const duplicated = duplicateProfile(list, 'p1');
    expect(duplicated).toHaveLength(2);
    expect(duplicated[1].id).not.toBe('p1');
    expect(duplicated[1].name).toBe('Work (copy)');
    expect(duplicateProfile(list, 'missing')).toHaveLength(1);
  });

  it('renames with validation and removes by id', () => {
    const list = [profile()];
    expect(renameProfile(list, 'p1', '  New name  ')[0].name).toBe('New name');
    expect(renameProfile(list, 'p1', '   ')).toEqual(list);
    expect(removeProfile(list, 'p1')).toEqual([]);
  });

  it('creates profiles with fresh unique ids', () => {
    const first = createProfile('A');
    const second = createProfile('B');
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe('A');
  });

  it('uses the documented versioned store key', () => {
    expect(CONNECTION_PROFILES_STORE_KEY).toBe('shellysvn:connection-profiles:v1');
  });
});
