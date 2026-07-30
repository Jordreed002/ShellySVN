/**
 * Which of the user's checkouts belong to the repository being browsed?
 *
 * The browser's local facts — the working-copy band, status codes, roll-ups,
 * problems — only exist inside a checkout, and until now they only appeared when
 * a route happened to pass a `localPath`. Nobody does, so a user browsing
 * `clients/acme-corp/website/trunk` was told "nothing checked out here" while
 * having that exact path on disk. TortoiseSVN binds the two automatically; this
 * hook is the lookup that lets us do the same.
 *
 * The candidates come from `AppSettings.recentRepositories` (the same list the
 * sidebar rail renders), resolved with one `svn info` each. Three things this is
 * careful about:
 *
 * 1. **"Not a working copy" is a normal answer.** `recentRepositories` goes
 *    stale — folders get deleted or were never versioned — and `svn info` then
 *    throws E155007/E155010. Such an entry is simply not a checkout: it is
 *    dropped, never surfaced as an error, because one dead entry must not stop
 *    the other nine from binding.
 * 2. **Containment is by path segment, not by prefix.** `startsWith` would make
 *    a checkout of `clients/acme-corp` "contain" `clients/acme`, binding a
 *    working copy to a directory that has nothing to do with it and showing
 *    somebody else's local edits. See `repoPathContains`.
 * 3. **No `svn status`.** This hook answers "where are my checkouts", nothing
 *    about their contents. Scanning them all would cost one recursive disk walk
 *    per checkout on every navigation; `useWorkingCopyForPath` runs the single
 *    scan that is actually needed once a checkout has been picked.
 */

import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { SvnInfoResult } from '@shared/types';

import { useSettings } from '@renderer/hooks/useSettings';

import {
  isNotAWorkingCopyError,
  normaliseLocalPath,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_INFO_STALE_TIME_MS,
  trimTrailingSlash,
  urlToRepoPath,
  workingCopyInfoQueryKey,
} from './queryKeys';

/** A local checkout, paired with the repository location it came from. */
export interface RepositoryCheckout {
  /** Absolute local path of the checkout root. */
  localPath: string;
  /** Its svn URL. */
  url: string;
  /** Repository root URL, as reported by `svn info`. */
  repositoryRoot: string;
  /** Repository-relative path of the checkout root (`''` at the root). */
  repoPath: string;
}

export interface UseRepositoryCheckoutsResult {
  /** Checkouts belonging to THIS repository, in `recentRepositories` order. */
  checkouts: readonly RepositoryCheckout[];
  /** Deepest checkout containing `repoPath`, or null. */
  findCheckoutFor: (repoPath: string) => RepositoryCheckout | null;
  /** Settings or any `svn info` still in flight. Do not say "not checked out" yet. */
  isResolving: boolean;
}

export interface UseRepositoryCheckoutsOptions {
  enabled?: boolean;
}

/**
 * The `['repo-browser','wc','info',path]` payload, shared *by shape* with
 * `useWorkingCopyForPath`'s identity query so that browsing into a bound
 * checkout is a cache hit rather than a second `svn info`. Keep the two in step.
 */
interface CheckoutIdentity {
  info: SvnInfoResult;
  /** Repository-relative path of the checkout root, derived from url − root. */
  repoPath: string;
}

const EMPTY_PATHS: readonly string[] = [];

/* ─────────────────────────── pure path semantics ────────────────────────── */

/** A repository-relative path with no leading or trailing slashes. */
export function normaliseRepoPath(value: string): string {
  return trimTrailingSlash(value).replace(/^\/+/, '');
}

/**
 * Do two URLs name the same repository?
 *
 * Only a trailing slash is forgiven: `svn info` reports the root with or without
 * one depending on how the checkout was made. Nothing else is normalised —
 * Subversion paths are case-sensitive, and lower-casing them here would happily
 * bind `/repo/Clients` to a checkout of `/repo/clients`.
 */
export function isSameRepository(a: string, b: string): boolean {
  const left = trimTrailingSlash(a);
  const right = trimTrailingSlash(b);
  return left.length > 0 && left === right;
}

/**
 * Does a checkout rooted at `checkoutRepoPath` contain `repoPath`?
 *
 * Segment-boundary matching, deliberately not `startsWith`: `clients/acme-corp`
 * must not swallow `clients/acme`. A checkout of the repository root (`''`)
 * contains everything.
 */
export function repoPathContains(checkoutRepoPath: string, repoPath: string): boolean {
  const root = normaliseRepoPath(checkoutRepoPath);
  const target = normaliseRepoPath(repoPath);
  if (root.length === 0) return true;
  if (target === root) return true;
  return target.startsWith(`${root}/`);
}

/**
 * The deepest checkout containing `repoPath`, or null.
 *
 * Nested checkouts are normal in SVN — a working copy of `clients` and another
 * of `clients/acme-corp/website` can both be on disk — and the nearer one is the
 * one whose `svn status` actually describes the directory on screen. Any two
 * checkouts containing the same path are ancestors of one another, so the longer
 * `repoPath` is unambiguously the deeper.
 */
export function findDeepestCheckout<T extends { repoPath: string }>(
  checkouts: readonly T[],
  repoPath: string
): T | null {
  let deepest: T | null = null;
  let deepestLength = -1;
  for (const checkout of checkouts) {
    if (!repoPathContains(checkout.repoPath, repoPath)) continue;
    const length = normaliseRepoPath(checkout.repoPath).length;
    if (length > deepestLength) {
      deepest = checkout;
      deepestLength = length;
    }
  }
  return deepest;
}

/* ─────────────────────────────── the hook ───────────────────────────────── */

export function useRepositoryCheckouts(
  rootUrl: string,
  options: UseRepositoryCheckoutsOptions = {}
): UseRepositoryCheckoutsResult {
  const { enabled = true } = options;
  const { settings, isLoading: isLoadingSettings } = useSettings();

  // Without a repository root there is nothing to compare a checkout against,
  // so resolving one would be wasted work rather than merely early.
  const canResolve = enabled && trimTrailingSlash(rootUrl).length > 0;

  const candidates = useMemo(() => {
    if (!canResolve) return EMPTY_PATHS;
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const path of settings.recentRepositories ?? []) {
      if (typeof path !== 'string' || path.length === 0) continue;
      // The same checkout can be recorded with and without a trailing slash;
      // resolve it once, keeping the form the settings actually hold so the
      // query key matches whatever `useWorkingCopyForPath` was given.
      const key = normaliseLocalPath(path);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      paths.push(path);
    }
    return paths;
  }, [canResolve, settings.recentRepositories]);

  const queries = useMemo(
    () =>
      candidates.map((localPath) => ({
        queryKey: workingCopyInfoQueryKey(localPath),
        queryFn: async (): Promise<CheckoutIdentity | null> => {
          try {
            const info = await window.api.svn.info(localPath);
            // A path can resolve without being versioned; a missing URL is the
            // same answer as "not a working copy", not a half-built checkout.
            if (!info?.url) return null;
            const repoPath = urlToRepoPath(info.url, info.repositoryRoot);
            if (repoPath === null) return null;
            return { info, repoPath };
          } catch (error) {
            // E155007 and friends: this entry is stale or was never a checkout.
            // That is an answer, so cache it instead of retrying or throwing.
            if (isNotAWorkingCopyError(error)) return null;
            throw error;
          }
        },
        staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
        gcTime: REPO_BROWSER_GC_TIME_MS,
        retry: false,
      })),
    [candidates]
  );

  // `combine` runs through `replaceEqualDeep`, so an unchanged set of checkouts
  // keeps its identity across renders and `findCheckoutFor` stays stable.
  const combine = useCallback(
    (results: readonly { data?: CheckoutIdentity | null; isLoading: boolean }[]) => {
      const checkouts: RepositoryCheckout[] = [];
      let isResolving = false;
      results.forEach((result, index) => {
        if (result.isLoading) isResolving = true;
        const identity = result.data;
        if (!identity) return;
        // A checkout of a different repository must never bind, however similar
        // its paths look.
        if (!isSameRepository(identity.info.repositoryRoot, rootUrl)) return;
        checkouts.push({
          // The recorded path, not `info.workingCopyRoot`: `localPath` and `url`
          // have to describe the same node. When a recent entry points at a
          // subdirectory of a checkout, pairing the working-copy root with that
          // subdirectory's URL would put the two out of step by a few segments.
          localPath: candidates[index] ?? identity.info.path,
          url: identity.info.url,
          repositoryRoot: identity.info.repositoryRoot,
          repoPath: identity.repoPath,
        });
      });
      return { checkouts, isResolving };
    },
    [candidates, rootUrl]
  );

  const { checkouts, isResolving } = useQueries({ queries, combine });

  const findCheckoutFor = useCallback(
    (repoPath: string): RepositoryCheckout | null => findDeepestCheckout(checkouts, repoPath),
    [checkouts]
  );

  return {
    checkouts,
    findCheckoutFor,
    // Settings gate the whole fan-out, so "still loading settings" is still
    // resolving — otherwise a caller renders "nothing checked out here" for a
    // moment before the checkouts it owns show up.
    isResolving: (canResolve && isLoadingSettings) || isResolving,
  };
}
