import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SvnStatusChar } from '@shared/types';

const PINNED_KEY = 'shellysvn:pinned-repos';

/** Split a repository path into its display name and parent directory. */
export function describeRepo(repoPath: string) {
  const parts = repoPath.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] || repoPath;
  const parent = parts.slice(0, -1).join('/');
  return { name, parent };
}

/** Status chars that do NOT represent a pending local change. */
const NON_CHANGE: ReadonlySet<SvnStatusChar> = new Set([' ', '?', 'I', 'X'] as SvnStatusChar[]);

export interface RepoStatusCounts {
  changes: number;
  conflicts: number;
}

/**
 * Pending-change counts for a working copy, derived from `svn status`.
 * Returns null counts on error (e.g. the path is not a working copy).
 */
export function useRepoStatus(path: string, enabled = true) {
  return useQuery<RepoStatusCounts>({
    queryKey: ['sidebar:status', path],
    queryFn: async () => {
      const result = await window.api.svn.status(path);
      let changes = 0;
      let conflicts = 0;
      for (const entry of result.entries) {
        if (entry.status === 'C') {
          conflicts += 1;
          changes += 1;
        } else if (!NON_CHANGE.has(entry.status)) {
          changes += 1;
        }
      }
      return { changes, conflicts };
    },
    enabled: enabled && Boolean(path),
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export interface WorkingCopyInfo {
  url: string;
  revision: number;
  branch: string;
  branchKind: 'trunk' | 'branch' | 'tag' | 'other';
}

/** Derive a friendly branch label from an SVN URL using standard layout conventions. */
export function deriveBranch(url: string): { branch: string; branchKind: WorkingCopyInfo['branchKind'] } {
  if (/\/trunk(\/|$)/i.test(url)) return { branch: 'trunk', branchKind: 'trunk' };
  const branch = url.match(/\/branches\/([^/]+)/i);
  if (branch) return { branch: branch[1], branchKind: 'branch' };
  const tag = url.match(/\/tags\/([^/]+)/i);
  if (tag) return { branch: tag[1], branchKind: 'tag' };
  const last = url.split('/').filter(Boolean).pop();
  return { branch: last || 'working copy', branchKind: 'other' };
}

/** `svn info` for the active working copy root (branch/URL + revision). */
export function useWorkingCopyInfo(path: string | undefined) {
  return useQuery<WorkingCopyInfo>({
    queryKey: ['sidebar:info', path],
    queryFn: async () => {
      const info = await window.api.svn.info(path as string);
      const { branch, branchKind } = deriveBranch(info.url);
      return { url: info.url, revision: info.revision, branch, branchKind };
    },
    enabled: Boolean(path),
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** Persisted set of pinned repository paths (stored via the app settings store). */
export function usePinnedRepos() {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get<string[]>(PINNED_KEY)
      .then((value) => {
        if (!cancelled && Array.isArray(value)) setPinned(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePin = useCallback((repo: string) => {
    setPinned((prev) => {
      const next = prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo];
      void window.api.store.set(PINNED_KEY, next);
      return next;
    });
  }, []);

  const isPinned = useCallback((repo: string) => pinned.includes(repo), [pinned]);

  return { pinned, isPinned, togglePin };
}
