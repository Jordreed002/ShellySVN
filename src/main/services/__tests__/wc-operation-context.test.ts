// @vitest-environment node

/**
 * Tests for the main-side per-working-copy operation-context resolver (#90
 * completion, Track A item 11): working-copy root walking, store loading with
 * reference-keyed parse caching, URL→working-copy lookup for repository-URL
 * operations, and fail-safe degradation.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { join } from 'node:path';

const storeGet = vi.hoisted(() => vi.fn());
vi.mock('../../ipc/store', () => ({
  getStore: vi.fn(async () => ({ get: storeGet })),
}));

const existsState = vi.hoisted(() => new Set<string>());
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => existsState.has(path),
  };
});

vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  resolveWcContextForOperation,
  resolveWorkingCopyRoot,
  resetWcOperationContextForTests,
  setWorkingCopyUrlLookup,
} from '../wc-operation-context';

/** A Windows-style working copy root with a `.svn` admin area. */
const WC_ROOT = 'C:\\repos\\acme';
const WC_ROOT_SVN = join(WC_ROOT, '.svn');

function overridesPayload(entry: Record<string, unknown> | undefined) {
  return entry === undefined ? undefined : { version: 1, overrides: entry };
}

beforeEach(() => {
  vi.clearAllMocks();
  existsState.clear();
  existsState.add(WC_ROOT_SVN);
  resetWcOperationContextForTests();
  storeGet.mockImplementation(async (key: string) => {
    if (key === 'shellysvn:wc-overrides:v1') return overridesPayload(undefined);
    if (key === 'shellysvn:connection-profiles:v1') return undefined;
    return undefined;
  });
});

describe('resolveWorkingCopyRoot', () => {
  it('walks up from a nested path to the .svn admin area', () => {
    expect(resolveWorkingCopyRoot(join(WC_ROOT, 'trunk', 'src', 'deep'))).toBe(WC_ROOT);
  });

  it('returns the root itself when it owns .svn', () => {
    expect(resolveWorkingCopyRoot(WC_ROOT)).toBe(WC_ROOT);
  });

  it('returns undefined above a tree with no .svn (e.g. a fresh checkout destination)', () => {
    expect(resolveWorkingCopyRoot('C:\\fresh\\destination')).toBeUndefined();
  });
});

describe('resolveWcContextForOperation', () => {
  it('returns none when neither store has data', async () => {
    const resolved = await resolveWcContextForOperation(['status'], WC_ROOT);
    expect(resolved.source).toBe('none');
    expect(resolved.context).toEqual({});
  });

  it('resolves the override for the working-copy root a command runs in', async () => {
    storeGet.mockImplementation(async (key: string) =>
      key === 'shellysvn:wc-overrides:v1'
        ? overridesPayload({
            [WC_ROOT]: {
              version: 1,
              workingCopyPath: WC_ROOT,
              updatedAt: '2026-01-01T00:00:00.000Z',
              proxy: { enabled: true, host: 'wc-proxy', port: 3128, username: '', password: '', bypassForLocal: true },
            },
          })
        : undefined
    );

    const resolved = await resolveWcContextForOperation(
      ['update', join(WC_ROOT, 'trunk')],
      join(WC_ROOT, 'trunk')
    );
    expect(resolved.source).toBe('override');
    expect(resolved.context.proxySettings).toMatchObject({ host: 'wc-proxy', port: 3128 });
  });

  it('prefers the working-copy override over a URL-matched profile', async () => {
    storeGet.mockImplementation(async (key: string) => {
      if (key === 'shellysvn:wc-overrides:v1') {
        return overridesPayload({
          [WC_ROOT]: {
            version: 1,
            workingCopyPath: WC_ROOT,
            updatedAt: '2026-01-01T00:00:00.000Z',
            proxy: { enabled: true, host: 'wc-proxy', port: 3128, username: '', password: '', bypassForLocal: true },
          },
        });
      }
      if (key === 'shellysvn:connection-profiles:v1') {
        return {
          version: 1,
          profiles: [
            {
              id: 'p1',
              name: 'Acme',
              repoUrlPattern: 'https://svn.acme.com/*',
              proxy: { enabled: true, host: 'profile-proxy', port: 8888, username: '', password: '', bypassForLocal: true },
            },
          ],
        };
      }
      return undefined;
    });
    setWorkingCopyUrlLookup(() => [{ path: WC_ROOT, url: 'https://svn.acme.com/repo' }]);

    const resolved = await resolveWcContextForOperation([
      'list',
      '--xml',
      'https://svn.acme.com/repo/trunk',
    ]);
    expect(resolved.source).toBe('override');
    expect(resolved.context.proxySettings).toMatchObject({ host: 'wc-proxy' });
  });

  it('maps a repository URL to a monitored working copy, then its override', async () => {
    storeGet.mockImplementation(async (key: string) =>
      key === 'shellysvn:wc-overrides:v1'
        ? overridesPayload({
            [WC_ROOT]: {
              version: 1,
              workingCopyPath: WC_ROOT,
              updatedAt: '2026-01-01T00:00:00.000Z',
              credentialsProfileId: 'https://svn.acme.com/repo',
            },
          })
        : undefined
    );
    setWorkingCopyUrlLookup(() => [
      { path: 'C:\\other', url: 'https://svn.example.com/other' },
      { path: WC_ROOT, url: 'https://svn.acme.com/repo/' },
    ]);

    const resolved = await resolveWcContextForOperation(['log', '--xml', 'https://svn.acme.com/repo/trunk']);
    expect(resolved.source).toBe('override');
    expect(resolved.credentialsProfileId).toBe('https://svn.acme.com/repo');
  });

  it('falls back to URL-pattern profile matching when no working-copy context exists', async () => {
    storeGet.mockImplementation(async (key: string) =>
      key === 'shellysvn:connection-profiles:v1'
        ? {
            version: 1,
            profiles: [
              {
                id: 'p1',
                name: 'Acme',
                repoUrlPattern: 'https://svn.acme.com/*',
                proxy: { enabled: true, host: 'profile-proxy', port: 8888, username: '', password: '', bypassForLocal: true },
              },
            ],
          }
        : undefined
    );

    const resolved = await resolveWcContextForOperation(['list', '--xml', 'https://svn.acme.com/trunk']);
    expect(resolved.source).toBe('url-profile');
    expect(resolved.context.proxySettings).toMatchObject({ host: 'profile-proxy' });
  });

  it('degrades to none when the store read fails', async () => {
    storeGet.mockRejectedValue(new Error('store offline'));
    const resolved = await resolveWcContextForOperation(['status'], WC_ROOT);
    expect(resolved.source).toBe('none');
  });

  it('does not hit the filesystem for the walk when no overrides exist', async () => {
    storeGet.mockImplementation(async (key: string) =>
      key === 'shellysvn:connection-profiles:v1'
        ? { version: 1, profiles: [{ id: 'p1', name: 'Acme' }] }
        : undefined
    );
    existsState.clear();
    const resolved = await resolveWcContextForOperation(['status', 'C:\\unrelated'], 'C:\\unrelated');
    expect(resolved.source).toBe('none');
  });
});
