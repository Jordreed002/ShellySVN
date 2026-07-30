/**
 * `svn proplist -v` for the selected path, mapped to `PropertiesView`'s
 * `SvnPropertyEntry[]`.
 *
 * Inherited properties are requested: `bugtraq:*`, `svn:global-ignores` and
 * `svn:auto-props` are almost always set once on the repository root, and a
 * properties pane that hides them tells you the repository has no conventions
 * when in fact it has several.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { SvnPropertyEntry } from '../components/PropertiesView';
import type { PegRevision } from '../types';
import {
  describeError,
  isAuthFailure,
  pegToRevisionArg,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_HISTORY_STALE_TIME_MS,
  repoPropertiesQueryKey,
  type RepoBrowserCredentials,
} from './queryKeys';

export interface UseRepoPropertiesOptions {
  credentials?: RepoBrowserCredentials | null;
  /** Include properties inherited from ancestors. On by default. */
  showInherited?: boolean;
  enabled?: boolean;
}

export interface UseRepoPropertiesResult {
  /** Straight into `PropertiesView`'s `properties`. */
  properties: SvnPropertyEntry[];
  /** Names of the properties that came from an ancestor rather than this path. */
  inheritedNames: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  needsAuth: boolean;
  /** Read a single property value on demand, e.g. before an edit. */
  getProperty: (name: string) => Promise<string | null>;
  refetch: () => void;
}

const EMPTY_PROPERTIES: SvnPropertyEntry[] = [];
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

export function useRepoProperties(
  url: string,
  peg: PegRevision,
  options: UseRepoPropertiesOptions = {}
): UseRepoPropertiesResult {
  const { credentials = null, showInherited = true, enabled = true } = options;

  const revision = useMemo(() => pegToRevisionArg(peg), [peg]);

  const query = useQuery({
    queryKey: repoPropertiesQueryKey(url, revision, credentials, showInherited),
    // `svn:proplist` takes no `CancellableRequestOptions`, so there is no
    // signal to forward; the short stale time keeps it from re-running often.
    queryFn: () => window.api.svn.proplist(url, { revision, showInherited }),
    enabled: enabled && url.length > 0,
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const result = query.data;
  const resultError = result?.error ?? null;

  const properties = useMemo<SvnPropertyEntry[]>(() => {
    if (!result || resultError) return EMPTY_PROPERTIES;
    return result.properties
      .map((property) => ({ name: property.name, value: property.value ?? '' }))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }, [result, resultError]);

  const inheritedNames = useMemo<ReadonlySet<string>>(() => {
    if (!result || resultError) return EMPTY_NAMES;
    const names = new Set<string>();
    for (const property of result.properties) {
      if (property.inherited) names.add(property.name);
    }
    return names;
  }, [result, resultError]);

  const getProperty = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const value = await window.api.svn.propget(url, name, { revision, showInherited });
        return value?.value ?? null;
      } catch {
        return null;
      }
    },
    [url, revision, showInherited]
  );

  const thrownError = describeError(query.error);
  const error = thrownError ?? resultError;
  const needsAuth = isAuthFailure(query.error, resultError);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    properties,
    inheritedNames,
    loading: query.isLoading || query.isFetching,
    error: error && !needsAuth ? error : null,
    needsAuth,
    getProperty,
    refetch,
  };
}
