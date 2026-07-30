/**
 * Which children of a directory are actually `svn:externals`, not real content.
 *
 * A listing without this is quietly misleading: `svn list` shows an external as
 * an ordinary directory, when in fact its content comes from elsewhere and may
 * be pinned to a revision that does not move with the rest of the tree. This is
 * the one flag the browser is allowed to show outside a working copy, because
 * `svn:externals` is a repository property rather than anything about your disk.
 *
 * One `svn proplist --depth empty` per directory, cached like the listing it
 * annotates. It must never gate the listing: a directory whose properties fail
 * to read is still a perfectly good directory, so failures resolve to "no
 * externals known" rather than to an error.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { parseExternalsProperty } from '../adapters';
import type { PegRevision } from '../types';
import {
  pegToRevisionArg,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_LIST_STALE_TIME_MS,
  REPO_BROWSER_QUERY_ROOT,
  credentialQueryKey,
  type RepoBrowserCredentials,
} from './queryKeys';

export interface UseRepoExternalsOptions {
  credentials?: RepoBrowserCredentials | null;
  enabled?: boolean;
}

export interface UseRepoExternalsResult {
  /** Repository-relative paths defined by `svn:externals`, ready for `mergeEntries`. */
  externalPaths: Map<string, { pegged: boolean }>;
  /** The raw property value, when the directory has one — for the properties pane. */
  definition: string | null;
  isLoading: boolean;
}

export function repoExternalsQueryKey(
  url: string,
  revision: string,
  credentials: RepoBrowserCredentials | null | undefined
) {
  return [
    REPO_BROWSER_QUERY_ROOT,
    'externals',
    url,
    revision,
    credentialQueryKey(credentials),
  ] as const;
}

const NO_EXTERNALS: Map<string, { pegged: boolean }> = new Map();

export function useRepoExternals(
  dirUrl: string,
  dirPath: string,
  peg: PegRevision,
  options: UseRepoExternalsOptions = {}
): UseRepoExternalsResult {
  const { credentials = null, enabled = true } = options;
  const revision = useMemo(() => pegToRevisionArg(peg), [peg]);

  const query = useQuery({
    queryKey: repoExternalsQueryKey(dirUrl, revision, credentials),
    queryFn: async (): Promise<string | null> => {
      /*
       * `--depth empty` asks about this directory alone. Recursing would answer
       * the same question for a whole monorepo subtree, at a cost nobody asked
       * for. Inherited properties are deliberately not requested: an externals
       * definition on an ancestor describes that ancestor's children, not these.
       */
      const result = await window.api.svn.proplist(dirUrl, { revision, depth: 'empty' });
      if (result.error) return null;
      return result.properties.find((property) => property.name === 'svn:externals')?.value ?? null;
    },
    enabled: enabled && dirUrl.length > 0,
    staleTime: REPO_BROWSER_LIST_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const externalPaths = useMemo(() => {
    if (!query.data) return NO_EXTERNALS;
    return parseExternalsProperty(query.data, dirPath);
  }, [query.data, dirPath]);

  return {
    externalPaths,
    definition: query.data ?? null,
    // Reported so a caller can wait before claiming a directory has no externals,
    // never to block the listing itself.
    isLoading: query.isLoading,
  };
}
