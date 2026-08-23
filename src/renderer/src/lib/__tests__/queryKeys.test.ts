/**
 * The registry's two contracts:
 *
 *  1. Factories reproduce the literal keys the app already used — a registry
 *     that changed one coordinate would orphan every existing cache entry.
 *  2. `resetRepositoryQueries` drops URL-keyed queries and invalidates
 *     path-keyed ones after relocate/switch, and leaves everything else alone.
 */

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  diagnostics,
  fsGetDeepStatus,
  fsGetStatus,
  keyTouchesPrefix,
  onboarding,
  repoBrowserShelves,
  repoList,
  resetRepositoryQueries,
  segmentTouchesPrefix,
  svnInfo,
  svnLog,
  svnStatus,
  svnTree,
  type RepositoryCacheClient,
} from '../queryKeys';

const OLD_URL = 'https://old-server.com/svn/repo';
const NEW_URL = 'https://new-server.com/svn/repo';
const WC = '/wc/atlas';

describe('query key factories', () => {
  it('reproduce the literal keys the app already used', () => {
    expect(svnInfo(WC)).toEqual(['svn:info', WC]);
    expect(svnLog(WC)).toEqual(['svn:log', WC]);
    expect(svnLog(WC, 200)).toEqual(['svn:log', WC, 200]);
    expect(svnStatus(WC)).toEqual(['svn:status', WC]);
    expect(svnStatus()).toEqual(['svn:status']);
    expect(svnTree(OLD_URL, 'cred-1')).toEqual(['svn:tree', OLD_URL, 'cred-1']);
    expect(svnTree(OLD_URL, undefined)).toEqual(['svn:tree', OLD_URL, undefined]);
    expect(repoList(OLD_URL)).toEqual(['repo:list', OLD_URL]);
    expect(repoBrowserShelves(WC)).toEqual(['repo-browser:shelves', WC]);
    expect(repoBrowserShelves(null)).toEqual(['repo-browser:shelves', null]);
    expect(diagnostics(WC)).toEqual(['diagnostics', WC]);
    expect(diagnostics()).toEqual(['diagnostics']);
    expect(fsGetStatus(WC)).toEqual(['fs:getStatus', WC]);
    expect(fsGetDeepStatus(WC)).toEqual(['fs:getDeepStatus', WC]);
    expect(onboarding()).toEqual(['onboarding']);
  });
});

describe('segmentTouchesPrefix', () => {
  it('matches the prefix itself and anything underneath it', () => {
    expect(segmentTouchesPrefix(`${OLD_URL}/trunk`, OLD_URL)).toBe(true);
    expect(segmentTouchesPrefix(`${OLD_URL}/`, OLD_URL)).toBe(true);
    expect(segmentTouchesPrefix(`${OLD_URL}elsewhere`, OLD_URL)).toBe(false);
    expect(segmentTouchesPrefix('https://other.com/svn/repo', OLD_URL)).toBe(false);
  });

  it('normalises separators and casing of Windows paths against the prefix', () => {
    expect(segmentTouchesPrefix('C:\\wc\\atlas\\src', 'C:/wc/atlas')).toBe(true);
    expect(segmentTouchesPrefix('C:\\wc\\atlasaurus', 'C:/wc/atlas')).toBe(false);
  });
});

describe('keyTouchesPrefix', () => {
  it('scans every string segment and ignores objects', () => {
    expect(keyTouchesPrefix(['repo-browser', OLD_URL, 'HEAD', { session: 1 }], OLD_URL)).toBe(true);
    expect(keyTouchesPrefix(['repo-browser', NEW_URL, 'HEAD', null], OLD_URL)).toBe(false);
  });
});

describe('resetRepositoryQueries', () => {
  function clientWith(keys: readonly (readonly unknown[])[]) {
    const removed: (readonly unknown[])[] = [];
    const invalidated: (readonly unknown[])[] = [];

    const fake: RepositoryCacheClient = {
      removeQueries: ({ predicate }) => {
        for (const key of keys) if (predicate?.({ queryKey: key })) removed.push(key);
      },
      invalidateQueries: ({ predicate }) => {
        for (const key of keys) if (predicate?.({ queryKey: key })) invalidated.push(key);
      },
    };

    return { fake, removed, invalidated };
  }

  it('drops queries keyed by the old repository URL and invalidates the working copy path', () => {
    const keys = [
      svnInfo(OLD_URL),
      svnInfo(`${OLD_URL}/trunk`),
      repoList(OLD_URL),
      svnTree(OLD_URL, undefined),
      ['repo-browser', OLD_URL, 'HEAD', null],
      ['auth', OLD_URL],
      svnLog(WC),
      svnStatus(WC),
      fsGetStatus(`${WC}/src`),
      repoBrowserShelves(WC),
      // none of these may move
      svnInfo(NEW_URL),
      svnLog('/wc/other'),
      onboarding(),
    ] as const;

    const { fake, removed, invalidated } = clientWith(keys);
    resetRepositoryQueries(fake, { previousRepoUrl: OLD_URL, workingCopyPath: WC });

    expect(removed).toEqual([
      svnInfo(OLD_URL),
      svnInfo(`${OLD_URL}/trunk`),
      repoList(OLD_URL),
      svnTree(OLD_URL, undefined),
      ['repo-browser', OLD_URL, 'HEAD', null],
      ['auth', OLD_URL],
    ]);
    expect(invalidated).toEqual([
      svnLog(WC),
      svnStatus(WC),
      fsGetStatus(`${WC}/src`),
      repoBrowserShelves(WC),
    ]);
    expect(removed).not.toContain(svnInfo(NEW_URL));
    expect(invalidated).not.toContain(svnLog('/wc/other'));
  });

  it('drops old-URL queries without touching path families when only the URL is known', () => {
    const { fake, removed, invalidated } = clientWith([svnInfo(OLD_URL), svnLog(WC)] as const);

    resetRepositoryQueries(fake, { previousRepoUrl: OLD_URL });

    expect(removed).toEqual([svnInfo(OLD_URL)]);
    expect(invalidated).toEqual([]);
  });

  it('invalidates path families without dropping anything when only the path is known (plain switch)', () => {
    const { fake, removed, invalidated } = clientWith([svnStatus(WC), svnInfo(NEW_URL)] as const);

    resetRepositoryQueries(fake, { workingCopyPath: WC });

    expect(removed).toEqual([]);
    expect(invalidated).toEqual([svnStatus(WC)]);
  });

  it('works against a real QueryClient', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(svnInfo(OLD_URL), { repositoryRoot: OLD_URL });
    queryClient.setQueryData(['repo-browser', OLD_URL, 'HEAD', null], { entries: [] });
    queryClient.setQueryData(svnLog(WC), { entries: [] });
    queryClient.setQueryData(onboarding(), { done: true });

    resetRepositoryQueries(
      queryClient as Pick<QueryClient, 'removeQueries' | 'invalidateQueries'>,
      {
        previousRepoUrl: OLD_URL,
        workingCopyPath: WC,
      }
    );

    // Removals are async on a real client; let them settle.
    await Promise.resolve();

    expect(queryClient.getQueryData(svnInfo(OLD_URL))).toBeUndefined();
    expect(queryClient.getQueryData(['repo-browser', OLD_URL, 'HEAD', null])).toBeUndefined();
    expect(queryClient.getQueryData(onboarding())).toEqual({ done: true });
    expect(queryClient.getQueryState(svnLog(WC))?.isInvalidated).toBe(true);
  });
});
