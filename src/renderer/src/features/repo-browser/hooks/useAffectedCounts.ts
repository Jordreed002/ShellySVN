/**
 * Affected-path counts for a pending remote operation (#69), with lazy
 * completion from the server.
 *
 * The confirmation dialog must be able to say "47 paths affected" for a move
 * or delete of a directory — and say so *honestly*. The browser already holds
 * most subtrees in TanStack Query (the tree pane lists them on expand), so
 * the count starts from that cache and only the directories that were never
 * listed are fetched, one `svn list --depth infinity` each, while the dialog
 * shows a "counting…" state. The summary therefore reads either a real number
 * or "at least N", never a guess dressed as one.
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { SvnListResult } from '@shared/types';

import { computeAffectedCounts, type AffectedCounts, type RemoteOpItem } from '../lib/remoteOps';
import { joinRepoUrl, pegToRevisionArg, REPO_BROWSER_QUERY_ROOT } from './queryKeys';
import type { PegRevision, RepoEntry } from '../types';

export interface UseAffectedCountsOptions {
  /** Repository root URL; unloaded directories are listed beneath it. */
  rootUrl: string;
  /** Applied while counting, so a pegged view counts the pegged tree. */
  peg?: PegRevision;
  /** Children keyed by repository-relative parent path (`undefined` = not listed). */
  childrenByPath?: Readonly<Record<string, RepoEntry[] | undefined>>;
  /** Server-side child counts from earlier `svn list` calls. */
  childCountByPath?: Readonly<Record<string, number | undefined>>;
  /** Injection seam for tests. */
  listFn?: (url: string, revision: string) => Promise<SvnListResult>;
}

export interface UseAffectedCountsResult {
  counts: AffectedCounts;
  /** True while unloaded directories are being counted on the server. */
  isCounting: boolean;
}

function affectedCountsQueryKey(rootUrl: string, path: string, revision: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'affected-count', rootUrl, path, revision] as const;
}

export function useAffectedCounts(
  items: readonly RemoteOpItem[],
  { rootUrl, peg, childrenByPath, childCountByPath, listFn }: UseAffectedCountsOptions
): UseAffectedCountsResult {
  const revision = pegToRevisionArg(peg ?? { kind: 'head' });

  const base = useMemo(
    () => computeAffectedCounts(items, { childrenByPath, childCountByPath }),
    [items, childrenByPath, childCountByPath]
  );

  /*
   * Which directory items the loaded tree cannot answer for. Recomputed with
   * `childrenByPath` so a directory whose children land mid-dialog drops out
   * of the lazy list instead of being counted twice.
   */
  const unloadedDirs = useMemo(
    () =>
      items
        .filter((item) => item.kind === 'dir' && childrenByPath?.[item.path] === undefined)
        .map((item) => item.path),
    [items, childrenByPath]
  );

  // One query per unloaded directory; most confirmations need none, because
  // the tree pane has usually listed the subtree already.
  const queries = useQueries({
    queries: unloadedDirs.map((path) => ({
      queryKey: affectedCountsQueryKey(rootUrl, path, revision),
      queryFn: async (): Promise<SvnListResult> => {
        if (listFn) return listFn(joinRepoUrl(rootUrl, path), revision);
        return window.api.svn.list(joinRepoUrl(rootUrl, path), revision, 'infinity');
      },
      staleTime: 30_000,
      retry: false,
    })),
  });

  const lazyCounts = useMemo(() => {
    let descendants = 0;
    let resolved = 0;
    let pending = false;
    for (const query of queries) {
      if (query.isFetching) pending = true;
      const listing = query.data;
      if (listing && !listing.error) {
        descendants += listing.entries.length;
        resolved += 1;
      }
    }
    return { descendants, resolved, pending };
  }, [queries]);

  /*
   * Merge: every unloaded dir a lazy listing answered contributes its entry
   * count; ones still pending (or failed — the server may be unreachable)
   * keep the "at least" wording alive by leaving the unloaded count > 0.
   */
  const counts: AffectedCounts = useMemo(() => {
    const unresolved = Math.max(0, unloadedDirs.length - lazyCounts.resolved);
    return {
      direct: base.direct,
      knownDescendants: base.knownDescendants + lazyCounts.descendants,
      unloadedDirs: unresolved,
    };
  }, [base, lazyCounts, unloadedDirs.length]);

  const isCounting =
    unloadedDirs.length > 0 && lazyCounts.pending && lazyCounts.resolved < unloadedDirs.length;

  return { counts, isCounting };
}
