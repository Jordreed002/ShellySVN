/**
 * `svn blame` for one file, mapped to `BlameView`'s `BlameLine[]`.
 *
 * The distinction the view is built around: **uncommitted lines have no
 * revision.** The XML parser gives them `revision: 0` and `author: 'unknown'`,
 * which would render as a real commit by a real person called "unknown". They
 * are mapped to `revision: null` here so `BlameView` can mark, count and
 * explain them instead.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SvnBlameLine } from '@shared/types';

import type { BlameLine } from '../types';
import {
  describeError,
  isAuthFailure,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_HISTORY_STALE_TIME_MS,
  repoBlameQueryKey,
  type RepoBrowserCredentials,
} from './queryKeys';

/** `svn blame` marks a line with no commit as r0 with an unknown author. */
export function toBlameLine(line: SvnBlameLine): BlameLine {
  const committed = typeof line.revision === 'number' && line.revision > 0;
  return {
    revision: committed ? line.revision : null,
    author: committed ? line.author : '',
    date: committed ? line.date : '',
    lineNumber: line.lineNumber,
    content: line.content,
  };
}

export interface UseRepoBlameOptions {
  credentials?: RepoBrowserCredentials | null;
  /** Restrict the annotation to a revision range. */
  startRevision?: number | null;
  endRevision?: number | null;
  enabled?: boolean;
}

export interface UseRepoBlameResult {
  /** Straight into `BlameView`'s `lines`. */
  lines: BlameLine[];
  /** Lines attributed to nobody because they are not committed yet. */
  uncommittedCount: number;
  loading: boolean;
  error: string | null;
  needsAuth: boolean;
  /** SVN returned a truncated annotation. */
  partial: boolean;
  refetch: () => void;
}

const EMPTY_LINES: BlameLine[] = [];

export function useRepoBlame(
  url: string,
  options: UseRepoBlameOptions = {}
): UseRepoBlameResult {
  const {
    credentials = null,
    startRevision = null,
    endRevision = null,
    enabled = true,
  } = options;

  const query = useQuery({
    queryKey: repoBlameQueryKey(url, startRevision, endRevision, credentials),
    queryFn: ({ signal }) =>
      window.api.svn.blame(url, startRevision ?? undefined, endRevision ?? undefined, { signal }),
    enabled: enabled && url.length > 0,
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  // `svn:blame` resolves with an error field rather than throwing.
  const result = query.data;
  const resultError = result?.error ?? null;

  const lines = useMemo(() => {
    if (!result || resultError) return EMPTY_LINES;
    return result.lines.map(toBlameLine);
  }, [result, resultError]);

  const uncommittedCount = useMemo(
    () => lines.reduce((total, line) => (line.revision === null ? total + 1 : total), 0),
    [lines]
  );

  const thrownError = describeError(query.error);
  const error = thrownError ?? resultError;
  const needsAuth = isAuthFailure(query.error, resultError);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    lines,
    uncommittedCount,
    loading: query.isLoading || query.isFetching,
    error: error && !needsAuth ? error : null,
    needsAuth,
    partial: result?.partial === true,
    refetch,
  };
}
