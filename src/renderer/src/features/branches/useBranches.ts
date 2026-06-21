import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SvnRepoEntry } from '@shared/types';

export interface BranchEntry {
  name: string;
  url: string;
  revision: number;
  author: string;
  date: string;
}

export interface BranchList {
  trunkUrl: string;
  branches: BranchEntry[];
  tags: BranchEntry[];
  /** Youngest revision seen across branches/tags — used to detect changes. */
  youngestRev: number;
}

const STORE_PREFIX = 'shellysvn:branches:';
const STALE_TIME = 60_000;
const POLL_INTERVAL = 3 * 60_000;

function toBranchEntry(entry: SvnRepoEntry): BranchEntry {
  return {
    name: entry.name,
    url: entry.url,
    revision: entry.revision,
    author: entry.author,
    date: entry.date,
  };
}

async function listDirs(url: string): Promise<BranchEntry[]> {
  try {
    const res = await window.api.svn.list(url);
    return (res.entries || []).filter((e) => e.kind === 'dir').map(toBranchEntry);
  } catch {
    // branches/ or tags/ may not exist for this project — treat as empty.
    return [];
  }
}

async function fetchBranchList(branchRootUrl: string): Promise<BranchList> {
  const root = branchRootUrl.replace(/\/+$/, '');
  const [branches, tags] = await Promise.all([
    listDirs(`${root}/branches`),
    listDirs(`${root}/tags`),
  ]);
  const youngestRev = [...branches, ...tags].reduce((max, b) => Math.max(max, b.revision || 0), 0);
  return { trunkUrl: `${root}/trunk`, branches, tags, youngestRev };
}

/**
 * Layer B — lazy, self-refreshing branch list for a branch-root, keyed by its
 * URL. Stale-while-revalidate: shows cached/persisted data instantly, refreshes
 * on focus and on a gentle background interval, and persists across sessions.
 */
export function useBranchList(branchRootUrl: string | null | undefined) {
  const queryClient = useQueryClient();

  // Seed from the persisted store for instant display when reopening a repo.
  useEffect(() => {
    if (!branchRootUrl) return;
    const key = ['branches', branchRootUrl];
    if (queryClient.getQueryData(key)) return;
    let cancelled = false;
    window.api.store
      .get<BranchList>(`${STORE_PREFIX}${branchRootUrl}`)
      .then((value) => {
        if (!cancelled && value && !queryClient.getQueryData(key)) {
          queryClient.setQueryData(key, value);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [branchRootUrl, queryClient]);

  const query = useQuery({
    queryKey: ['branches', branchRootUrl],
    queryFn: () => fetchBranchList(branchRootUrl as string),
    enabled: Boolean(branchRootUrl),
    staleTime: STALE_TIME,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL,
  });

  // Persist successful results so a reopen is instant (then revalidated).
  useEffect(() => {
    if (branchRootUrl && query.data) {
      void window.api.store.set(`${STORE_PREFIX}${branchRootUrl}`, query.data);
    }
  }, [branchRootUrl, query.data]);

  return query;
}

/** Invalidate a branch-root's cached list after a local branch/tag/switch op. */
export function useInvalidateBranches() {
  const queryClient = useQueryClient();
  return (branchRootUrl: string) =>
    queryClient.invalidateQueries({ queryKey: ['branches', branchRootUrl] });
}
