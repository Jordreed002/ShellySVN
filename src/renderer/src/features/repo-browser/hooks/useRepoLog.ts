/**
 * Paged `svn log`, mapped to `LogEntry[]` for `RevisionLogView`.
 *
 * Pages walk backwards: the first page is `svn log -l N URL@PEG`, and each
 * subsequent page asks for `-r <lowest-1>:1`. A page shorter than the limit
 * means the log has reached r1 for this path, which is what turns off the
 * "load more" affordance.
 *
 * Issue references come from the repository's own `bugtraq:` properties, not
 * from a hard-coded pattern. `bugtraq:logregex` is one or two regexes: with two,
 * the first finds the reference block in the message and the second extracts the
 * bare id from it. An invalid or absent property leaves `issue` undefined —
 * never a guess.
 */

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { LogEntry, PegRevision } from '../types';
import {
  describeError,
  isRepoBrowserAuthError,
  pegToRevisionArg,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_HISTORY_STALE_TIME_MS,
  repoBugtraqQueryKey,
  repoLogQueryKey,
  withPeg,
  type RepoBrowserCredentials,
  type UnsupportedCapability,
} from './queryKeys';

export const DEFAULT_LOG_PAGE_SIZE = 100;

/** Placeholder Subversion's `bugtraq:url` uses for the issue id. */
const BUGTRAQ_PLACEHOLDER = /%BUGID%/g;

interface BugtraqConfig {
  logregex: string | null;
  urlTemplate: string | null;
}

/**
 * Pull an issue reference out of a commit message using `bugtraq:logregex`.
 *
 * Pure and exported so the route, the log view and tests agree on the rule.
 */
export function extractIssueReference(
  message: string,
  logregex: string | null | undefined
): string | undefined {
  if (!logregex) return undefined;
  const patterns = logregex
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (patterns.length === 0) return undefined;

  try {
    if (patterns.length === 1) {
      const match = new RegExp(patterns[0]).exec(message);
      if (!match) return undefined;
      return (match[1] ?? match[0]).trim() || undefined;
    }

    // Two-regex form: find the reference block, then the bare id inside it.
    const block = new RegExp(patterns[0]).exec(message);
    if (!block) return undefined;
    const scope = block[1] ?? block[0];
    const id = new RegExp(patterns[1]).exec(scope);
    if (!id) return undefined;
    return (id[1] ?? id[0]).trim() || undefined;
  } catch {
    // A malformed property is the repository's problem, not a reason to fail
    // rendering the log.
    return undefined;
  }
}

/** Expand `bugtraq:url`'s `%BUGID%` placeholder. */
export function buildBugtraqUrl(template: string | null, issue: string): string | null {
  if (!template) return null;
  return template.replace(BUGTRAQ_PLACEHOLDER, encodeURIComponent(issue));
}

export interface UseRepoLogOptions {
  credentials?: RepoBrowserCredentials | null;
  pageSize?: number;
  enabled?: boolean;
  /** Skip the `bugtraq:` property lookup when the caller knows there is none. */
  resolveIssues?: boolean;
  /** `svn log --use-merge-history`. */
  useMergeHistory?: boolean;
  stopOnCopy?: boolean;
}

export interface UseRepoLogResult {
  entries: LogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  error: string | null;
  needsAuth: boolean;
  /** SVN truncated a page; the history shown is incomplete. */
  partial: boolean;
  /** `bugtraq:url` template with `%BUGID%`, when the repository defines one. */
  issueUrlTemplate: string | null;
  /** Ready to hand to `RevisionLogView`'s `onIssueClick`. */
  buildIssueUrl: (issue: string) => string | null;
  /** Facts `RevisionLogView` can display but no IPC call can supply. */
  unsupported: UnsupportedCapability[];
  refetch: () => void;
}

/**
 * `LogEntry.build` exists for a CI integration. There is no build-status IPC
 * call, so the field is left undefined rather than invented.
 */
const BUILD_STATUS_UNSUPPORTED: UnsupportedCapability = {
  capability: 'log:build-status',
  reason:
    'No CI integration is wired into the IPC surface, so revisions carry no build outcome. The column stays empty rather than showing a guessed result.',
};

export function useRepoLog(
  url: string,
  peg: PegRevision,
  options: UseRepoLogOptions = {}
): UseRepoLogResult {
  const {
    credentials = null,
    pageSize = DEFAULT_LOG_PAGE_SIZE,
    enabled = true,
    resolveIssues = true,
    useMergeHistory = false,
    stopOnCopy = false,
  } = options;

  const revision = useMemo(() => pegToRevisionArg(peg), [peg]);
  const target = useMemo(() => withPeg(url, peg), [url, peg]);
  const isEnabled = enabled && url.length > 0;

  /* ── bugtraq configuration, read once per path/revision ── */

  const bugtraqQuery = useQuery({
    queryKey: repoBugtraqQueryKey(url, revision, credentials),
    queryFn: async (): Promise<BugtraqConfig> => {
      // These are normally set on the repository root and inherited, so ask for
      // inherited values. A missing property is absence, not failure.
      const read = async (name: string): Promise<string | null> => {
        try {
          const result = await window.api.svn.propget(url, name, {
            revision,
            showInherited: true,
          });
          const value = result?.value?.trim();
          return value ? value : null;
        } catch {
          return null;
        }
      };
      const [logregex, urlTemplate] = await Promise.all([
        read('bugtraq:logregex'),
        read('bugtraq:url'),
      ]);
      return { logregex, urlTemplate };
    },
    enabled: isEnabled && resolveIssues,
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  /* ── the log itself ── */

  const logQuery = useInfiniteQuery({
    queryKey: repoLogQueryKey(target, revision, pageSize, credentials),
    // `null` is the first page: no `-r`, so SVN walks back from the peg.
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      window.api.svn.log(
        target,
        pageSize,
        pageParam ?? undefined,
        pageParam === null ? undefined : 1,
        useMergeHistory,
        { signal, stopOnCopy }
      ),
    getNextPageParam: (lastPage) => {
      const entries = lastPage?.entries ?? [];
      // Short page: this path's history has reached r1.
      if (entries.length < pageSize) return undefined;
      const lowest = entries.reduce(
        (min, entry) => (entry.revision < min ? entry.revision : min),
        entries[0].revision
      );
      return lowest > 1 ? lowest - 1 : undefined;
    },
    enabled: isEnabled,
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const logregex = bugtraqQuery.data?.logregex ?? null;
  const issueUrlTemplate = bugtraqQuery.data?.urlTemplate ?? null;

  const entries = useMemo<LogEntry[]>(() => {
    const pages = logQuery.data?.pages ?? [];
    const seen = new Set<number>();
    const mapped: LogEntry[] = [];
    for (const page of pages) {
      for (const entry of page?.entries ?? []) {
        // Page boundaries can overlap by one when a page ends exactly on a
        // revision; de-duplicate rather than render the same commit twice.
        if (seen.has(entry.revision)) continue;
        seen.add(entry.revision);
        const issue = extractIssueReference(entry.message, logregex);
        mapped.push({
          revision: entry.revision,
          author: entry.author,
          date: entry.date,
          message: entry.message,
          changedPaths: entry.paths?.length ?? 0,
          // `build` is deliberately omitted — see BUILD_STATUS_UNSUPPORTED.
          ...(issue ? { issue } : {}),
        });
      }
    }
    return mapped;
  }, [logQuery.data, logregex]);

  const partial = useMemo(
    () => (logQuery.data?.pages ?? []).some((page) => page?.partial === true),
    [logQuery.data]
  );

  const buildIssueUrl = useCallback(
    (issue: string) => buildBugtraqUrl(issueUrlTemplate, issue),
    [issueUrlTemplate]
  );

  const fetchNextPage = useCallback(() => {
    if (logQuery.hasNextPage && !logQuery.isFetchingNextPage) void logQuery.fetchNextPage();
  }, [logQuery]);

  const refetch = useCallback(() => {
    void logQuery.refetch();
  }, [logQuery]);

  const error = describeError(logQuery.error);

  return {
    entries,
    isLoading: logQuery.isLoading,
    isFetching: logQuery.isFetching,
    isFetchingNextPage: logQuery.isFetchingNextPage,
    hasNextPage: logQuery.hasNextPage,
    fetchNextPage,
    error: error && !isRepoBrowserAuthError(logQuery.error) ? error : null,
    needsAuth: isRepoBrowserAuthError(logQuery.error),
    partial,
    issueUrlTemplate,
    buildIssueUrl,
    unsupported: [BUILD_STATUS_UNSUPPORTED],
    refetch,
  };
}
