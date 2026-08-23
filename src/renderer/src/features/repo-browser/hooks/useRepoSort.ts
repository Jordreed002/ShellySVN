/**
 * Column sort for the contents list, persisted per repository (#68).
 *
 * `useRepoBrowserState` stays the owner of navigation-shaped state; sorting is
 * a per-*repository* preference rather than a per-navigation one, so it lives
 * here where the root URL — the persistence key — is on hand.
 *
 * Load-then-apply has one rule: a sort the user chose themselves always wins.
 * The stored value is applied only until the first `setSortKey` call for the
 * current repository, so a slow store read can never overwrite a click.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoSort } from '../types';
import {
  DEFAULT_REPO_SORT,
  loadRepoSort,
  nextSortAfter,
  persistRepoSort,
} from '../lib/repoSortStore';

export interface UseRepoSortResult {
  sort: RepoSort;
  /** Same semantics as the menu-less header click: toggle the column, or switch to it ascending. */
  setSortKey: (key: RepoSort['key']) => void;
  /** True once the stored sort (or its absence) has been read for this repository. */
  isLoaded: boolean;
}

export function useRepoSort(rootUrl: string): UseRepoSortResult {
  const [sort, setSort] = useState<RepoSort>(DEFAULT_REPO_SORT);
  const [isLoaded, setIsLoaded] = useState(false);
  /** Set the moment the user sorts for themselves; after this the store is write-only. */
  const userChoseRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    userChoseRef.current = false;
    setIsLoaded(false);
    setSort(DEFAULT_REPO_SORT);

    void loadRepoSort(rootUrl).then((stored) => {
      if (cancelled) return;
      // A click that landed before the store answered keeps priority.
      if (!userChoseRef.current && stored) setSort(stored);
      setIsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [rootUrl]);

  const setSortKey = useCallback(
    (key: RepoSort['key']) => {
      userChoseRef.current = true;
      setSort((current) => {
        const next = nextSortAfter(current, key);
        void persistRepoSort(rootUrl, next);
        return next;
      });
    },
    [rootUrl]
  );

  return { sort, setSortKey, isLoaded };
}
