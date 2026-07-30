/**
 * Binding the browser to the checkouts the user already has.
 *
 * Two traps are covered deliberately, because both produce a *plausible looking*
 * wrong answer rather than a crash:
 *
 * - prefix matching would bind a checkout of `clients/acme-corp` to
 *   `clients/acme`, showing one client's local edits while browsing another;
 * - a stale `recentRepositories` entry makes `svn info` throw E155007, which is
 *   the normal "not a working copy" answer and must not become an error.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnInfoResult } from '@shared/types';

import {
  findDeepestCheckout,
  isSameRepository,
  normaliseRepoPath,
  repoPathContains,
  useRepositoryCheckouts,
  type RepositoryCheckout,
} from '../hooks/useRepositoryCheckouts';

const REPO_ROOT = 'https://svn.example.com/repo';
const OTHER_ROOT = 'https://svn.example.com/other';

const info = vi.fn();
const storeGet = vi.fn();

/** `svn info` for a checkout of `repoPath` at `localPath`. */
function checkoutInfo(localPath: string, repoPath: string, root = REPO_ROOT): SvnInfoResult {
  return {
    path: localPath,
    url: repoPath ? `${root}/${repoPath}` : root,
    repositoryRoot: root,
    repositoryUuid: 'uuid',
    revision: 4800,
    nodeKind: 'dir',
    lastChangedAuthor: 'priya',
    lastChangedRevision: 4800,
    lastChangedDate: '2026-01-01T00:00:00Z',
    workingCopyRoot: localPath,
  };
}

/** Wire `recentRepositories` and the `svn info` answer for each of those paths. */
function givenCheckouts(paths: Record<string, SvnInfoResult | Error>) {
  storeGet.mockResolvedValue({ recentRepositories: Object.keys(paths) });
  info.mockImplementation(async (path: string) => {
    const answer = paths[path];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error(`svn: E155007: '${path}' is not a working copy`);
    return answer;
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeGet.mockResolvedValue({ recentRepositories: [] });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { info }, store: { get: storeGet, set: vi.fn() } },
  });
});

/* ───────────────────────────── pure semantics ───────────────────────────── */

describe('normaliseRepoPath', () => {
  it('strips leading and trailing slashes', () => {
    expect(normaliseRepoPath('/clients/acme-corp/')).toBe('clients/acme-corp');
    expect(normaliseRepoPath('/')).toBe('');
    expect(normaliseRepoPath('')).toBe('');
  });
});

describe('repoPathContains', () => {
  it('does not treat a shared prefix as containment', () => {
    // The bug this exists to prevent: `startsWith` says yes here.
    expect(repoPathContains('clients/acme-corp', 'clients/acme')).toBe(false);
    expect(repoPathContains('clients/acme', 'clients/acme-corp')).toBe(false);
  });

  it('contains itself and its descendants', () => {
    expect(repoPathContains('clients/acme-corp', 'clients/acme-corp')).toBe(true);
    expect(repoPathContains('clients/acme-corp', 'clients/acme-corp/website/trunk')).toBe(true);
  });

  it('treats a checkout of the repository root as containing everything', () => {
    expect(repoPathContains('', '')).toBe(true);
    expect(repoPathContains('', 'clients/acme-corp/website')).toBe(true);
  });

  it('is case-sensitive, as Subversion paths are', () => {
    expect(repoPathContains('clients/Acme', 'clients/acme/site')).toBe(false);
  });

  it('tolerates stray slashes on either side', () => {
    expect(repoPathContains('/clients/acme-corp/', 'clients/acme-corp/website')).toBe(true);
  });
});

describe('isSameRepository', () => {
  it('forgives a trailing slash', () => {
    expect(isSameRepository(`${REPO_ROOT}/`, REPO_ROOT)).toBe(true);
  });

  it('rejects a different repository, and an empty root', () => {
    expect(isSameRepository(REPO_ROOT, OTHER_ROOT)).toBe(false);
    expect(isSameRepository('', '')).toBe(false);
  });
});

describe('findDeepestCheckout', () => {
  const shallow = { repoPath: 'clients' };
  const deep = { repoPath: 'clients/acme-corp/website' };

  it('prefers the deepest containing checkout regardless of order', () => {
    expect(findDeepestCheckout([shallow, deep], 'clients/acme-corp/website/trunk')).toBe(deep);
    expect(findDeepestCheckout([deep, shallow], 'clients/acme-corp/website/trunk')).toBe(deep);
  });

  it('falls back to an ancestor when the deeper one does not contain the path', () => {
    expect(findDeepestCheckout([shallow, deep], 'clients/globex')).toBe(shallow);
  });

  it('returns null when nothing contains the path', () => {
    expect(findDeepestCheckout([deep], 'internal/tools')).toBeNull();
  });
});

/* ──────────────────────────────── the hook ──────────────────────────────── */

describe('useRepositoryCheckouts', () => {
  it('resolves only the checkouts belonging to the repository being browsed', async () => {
    givenCheckouts({
      '/Users/dev/wc/acme-website': checkoutInfo(
        '/Users/dev/wc/acme-website',
        'clients/acme-corp/website/trunk'
      ),
      '/Users/dev/wc/other': checkoutInfo('/Users/dev/wc/other', 'trunk', OTHER_ROOT),
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    expect(result.current.isResolving).toBe(false);
    expect(result.current.checkouts[0]).toEqual<RepositoryCheckout>({
      localPath: '/Users/dev/wc/acme-website',
      url: `${REPO_ROOT}/clients/acme-corp/website/trunk`,
      repositoryRoot: REPO_ROOT,
      repoPath: 'clients/acme-corp/website/trunk',
    });
    // A checkout of another repository never binds, however similar the paths.
    expect(result.current.findCheckoutFor('trunk')).toBeNull();
  });

  it('binds a browsed path to the checkout that contains it', async () => {
    givenCheckouts({
      '/Users/dev/wc/acme-website': checkoutInfo(
        '/Users/dev/wc/acme-website',
        'clients/acme-corp/website'
      ),
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    expect(result.current.findCheckoutFor('clients/acme-corp/website/trunk')?.localPath).toBe(
      '/Users/dev/wc/acme-website'
    );
    // `clients/acme` shares a prefix with `clients/acme-corp` and nothing else.
    expect(result.current.findCheckoutFor('clients/acme')).toBeNull();
    expect(result.current.findCheckoutFor('clients')).toBeNull();
  });

  it('returns the deepest checkout when nested ones both contain the path', async () => {
    givenCheckouts({
      '/Users/dev/wc/all-clients': checkoutInfo('/Users/dev/wc/all-clients', 'clients'),
      '/Users/dev/wc/acme-website': checkoutInfo(
        '/Users/dev/wc/acme-website',
        'clients/acme-corp/website'
      ),
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(2));
    expect(result.current.findCheckoutFor('clients/acme-corp/website/trunk')?.localPath).toBe(
      '/Users/dev/wc/acme-website'
    );
    // Outside the deeper checkout the ancestor still applies.
    expect(result.current.findCheckoutFor('clients/globex')?.localPath).toBe(
      '/Users/dev/wc/all-clients'
    );
  });

  it('lets a checkout of the repository root contain every path', async () => {
    givenCheckouts({
      '/Users/dev/wc/whole-repo': checkoutInfo('/Users/dev/wc/whole-repo', ''),
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    expect(result.current.checkouts[0].repoPath).toBe('');
    expect(result.current.findCheckoutFor('')?.localPath).toBe('/Users/dev/wc/whole-repo');
    expect(result.current.findCheckoutFor('clients/acme-corp/website')?.localPath).toBe(
      '/Users/dev/wc/whole-repo'
    );
  });

  it('omits a stale entry that is not a working copy, without erroring', async () => {
    givenCheckouts({
      // Deleted folder: `svn info` reports E155007. This is an answer, not a fault.
      '/Users/dev/wc/deleted': new Error(
        "svn: E155007: '/Users/dev/wc/deleted' is not a working copy"
      ),
      '/Users/dev/wc/acme-website': checkoutInfo(
        '/Users/dev/wc/acme-website',
        'clients/acme-corp/website'
      ),
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    // The dead entry must not stop the live one from binding.
    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.checkouts[0].localPath).toBe('/Users/dev/wc/acme-website');
    expect(result.current.findCheckoutFor('clients/acme-corp/website')).not.toBeNull();
  });

  it('drops a versioned-looking path whose info carries no URL', async () => {
    givenCheckouts({
      '/Users/dev/wc/empty': { ...checkoutInfo('/Users/dev/wc/empty', 'trunk'), url: '' },
    });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.checkouts).toHaveLength(0);
  });

  it('issues no svn calls when there are no recent repositories', async () => {
    storeGet.mockResolvedValue({ recentRepositories: [] });

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(storeGet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(info).not.toHaveBeenCalled();
    expect(result.current.checkouts).toHaveLength(0);
    expect(result.current.findCheckoutFor('clients/acme-corp')).toBeNull();
  });

  it('issues no svn calls when disabled, or without a repository root', async () => {
    givenCheckouts({
      '/Users/dev/wc/acme-website': checkoutInfo('/Users/dev/wc/acme-website', 'clients'),
    });

    const disabled = renderHook(() => useRepositoryCheckouts(REPO_ROOT, { enabled: false }), {
      wrapper: createWrapper(),
    });
    const rootless = renderHook(() => useRepositoryCheckouts(''), { wrapper: createWrapper() });

    await waitFor(() => expect(storeGet).toHaveBeenCalled());
    expect(info).not.toHaveBeenCalled();
    expect(disabled.result.current.isResolving).toBe(false);
    expect(rootless.result.current.isResolving).toBe(false);
  });

  it('runs one svn info per checkout and keeps findCheckoutFor stable', async () => {
    givenCheckouts({
      '/Users/dev/wc/acme-website': checkoutInfo('/Users/dev/wc/acme-website', 'clients'),
    });

    const { result, rerender } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    const findCheckoutFor = result.current.findCheckoutFor;

    rerender();

    // Callers depend on this identity; a new function every render would restart
    // whatever effect resolves the working copy.
    expect(result.current.findCheckoutFor).toBe(findCheckoutFor);
    expect(info).toHaveBeenCalledTimes(1);
    // "Where are my checkouts" never needs a disk scan.
    expect(info).toHaveBeenCalledWith('/Users/dev/wc/acme-website');
  });

  it('ignores a duplicate recent entry that differs only by a trailing slash', async () => {
    storeGet.mockResolvedValue({
      recentRepositories: ['/Users/dev/wc/acme-website', '/Users/dev/wc/acme-website/'],
    });
    info.mockResolvedValue(checkoutInfo('/Users/dev/wc/acme-website', 'clients'));

    const { result } = renderHook(() => useRepositoryCheckouts(REPO_ROOT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.checkouts).toHaveLength(1));
    expect(info).toHaveBeenCalledTimes(1);
  });
});
