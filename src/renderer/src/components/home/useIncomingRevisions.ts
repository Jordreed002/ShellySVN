/**
 * "What is incoming" for the working copies on this machine.
 *
 * Subversion cannot answer this from disk. `svn info` gives BASE; HEAD needs
 * `svn info <URL>` and the number of revisions between them needs
 * `svn log -r BASE+1:HEAD` — both are round trips to the server. So this hook
 * does two things and nothing else:
 *
 * 1. **It reads, it does not poll.** Every query is keyed exactly as the
 *    repository browser keys it (`workingCopyHeadQueryKey`,
 *    `workingCopyIncomingQueryKey`), so a working copy the browser already
 *    measured shows its count on Home for free — a cache hit, not a second
 *    `svn log`. Nothing is fetched on load: the briefing asks the server only
 *    when the user presses "Check server" for that checkout.
 * 2. **It never invents the answer.** Un-asked and unmeasured are the same
 *    state and both render as `—` with the reason; `at HEAD` is only said when
 *    HEAD was actually read and equals BASE.
 */

import { useQueries } from '@tanstack/react-query';

// Read-only imports: Home shares the repository browser's cache rather than
// keeping a parallel one, so neither surface pays for what the other measured.
import {
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_INFO_STALE_TIME_MS,
  workingCopyHeadQueryKey,
  workingCopyIncomingQueryKey,
} from '@renderer/features/repo-browser/hooks/queryKeys';
import { MAX_INCOMING_REVISIONS } from '@renderer/features/repo-browser/hooks/useWorkingCopyForPath';

import type { HomeWorkingCopy } from './homeBriefing';

/** Where one working copy stands relative to the server. */
export interface IncomingState {
  /** BASE revision from `svn info`. Absent when that read has not answered. */
  base?: number;
  /** HEAD from `svn info <URL>`. Absent until the server was asked. */
  head?: number;
  /** Revisions between BASE and HEAD, once counted. */
  count?: number;
  /** True when `count` hit the ceiling and is really "N or more". */
  capped: boolean;
  /** A server read is in flight. */
  pending: boolean;
  /**
   * - `unmeasured` — nobody has asked the server about this checkout;
   * - `at-head`    — HEAD was read and equals BASE;
   * - `behind`     — HEAD is ahead of BASE; `count` may still be counting;
   * - `error`      — the server could not be reached, and we say so.
   */
  kind: 'unmeasured' | 'at-head' | 'behind' | 'error';
  /** Verbatim failure text, for `error`. */
  error?: string;
  /** The command behind whatever this row is claiming. */
  command: string;
}

const UNMEASURED: IncomingState = {
  capped: false,
  pending: false,
  kind: 'unmeasured',
  command: 'svn info <URL>',
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Incoming state per working-copy path.
 *
 * `requested` holds the checkouts the user asked about. A path outside it is
 * still reported when its counts happen to be in the cache already, because
 * that costs nothing and a measured fact should not be hidden.
 */
export function useIncomingRevisions(
  rows: readonly HomeWorkingCopy[],
  requested: ReadonlySet<string>
): ReadonlyMap<string, IncomingState> {
  // Only checkouts `svn info` answered for have a URL and a BASE to compare.
  const targets = rows.flatMap((row) => {
    const info = row.info;
    if (!info?.url || !info.revision) return [];
    return [{ path: row.path, url: info.url, base: info.revision }];
  });

  const heads = useQueries({
    queries: targets.map((target) => ({
      queryKey: workingCopyHeadQueryKey(target.url),
      queryFn: async (): Promise<number> => {
        const info = await window.api.svn.infoUrl(target.url);
        return info?.revision ?? 0;
      },
      enabled: requested.has(target.path),
      staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
      gcTime: REPO_BROWSER_GC_TIME_MS,
      retry: false,
    })),
  });

  const incoming = useQueries({
    queries: targets.map((target, index) => {
      const head = heads[index]?.data ?? 0;
      const behind = head > target.base;
      return {
        queryKey: workingCopyIncomingQueryKey(target.url, target.base, head),
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<number> => {
          const result = await window.api.svn.log(
            target.url,
            MAX_INCOMING_REVISIONS,
            head,
            target.base + 1,
            false,
            { signal }
          );
          return result?.entries?.length ?? 0;
        },
        enabled: requested.has(target.path) && behind,
        staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
        gcTime: REPO_BROWSER_GC_TIME_MS,
        retry: false,
      };
    }),
  });

  const states = new Map<string, IncomingState>();
  for (const row of rows) states.set(row.path, UNMEASURED);

  targets.forEach((target, index) => {
    const headQuery = heads[index];
    const countQuery = incoming[index];
    if (!headQuery) return;

    if (headQuery.isError) {
      states.set(target.path, {
        base: target.base,
        capped: false,
        pending: false,
        kind: 'error',
        error: describeError(headQuery.error),
        command: `svn info ${target.url}`,
      });
      return;
    }

    const head = headQuery.data;
    if (typeof head !== 'number' || head === 0) {
      states.set(target.path, {
        ...UNMEASURED,
        base: target.base,
        pending: headQuery.isFetching,
        command: `svn info ${target.url}`,
      });
      return;
    }

    if (head <= target.base) {
      states.set(target.path, {
        base: target.base,
        head,
        capped: false,
        pending: false,
        kind: 'at-head',
        command: `svn info ${target.url}`,
      });
      return;
    }

    const count = countQuery?.data;
    states.set(target.path, {
      base: target.base,
      head,
      count: typeof count === 'number' ? count : undefined,
      capped: typeof count === 'number' && count >= MAX_INCOMING_REVISIONS,
      pending: Boolean(countQuery?.isFetching),
      kind: countQuery?.isError ? 'error' : 'behind',
      error: countQuery?.isError ? describeError(countQuery.error) : undefined,
      command: `svn log -r ${target.base + 1}:${head} ${target.url}`,
    });
  });

  return states;
}
