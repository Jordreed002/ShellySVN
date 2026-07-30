/**
 * A diff, and — the point of this hook — an honest statement of what it compares.
 *
 * Subversion can produce five materially different answers for "show me the
 * diff". Picking the wrong `svn` invocation does not error; it silently answers
 * a different question. So the choice is a pure function, `planRepoDiff`, that
 * the tests pin down:
 *
 * | Comparand       | Call                     | Arguments                                    |
 * | --------------- | ------------------------ | -------------------------------------------- |
 * | `wc-base`       | `svn.diff`               | `(workingCopyPath)` — no revision → BASE↔work |
 * | `wc-head`       | *(none)*                 | unsupported, see below                        |
 * | `base-head`     | `svn.diffUrls`           | `(url@BASE, url@HEAD)`                        |
 * | `branch-trunk`  | `svn.diffUrls`           | `(compareUrl, url)`                           |
 * | `rev-rev`       | `svn.diffUrls`           | `(url@left, url@right)`                       |
 *
 * **`wc-head` has no API.** `window.api.svn.diff(path, revision)` builds
 * `svn diff -c <revision> -- <path>` — `-c`, the *change introduced by* a
 * revision, not `-r`, a range. There is no way through the IPC surface to
 * produce `svn diff -r HEAD PATH`, and `diffUrls` is server-side so it cannot
 * see uncommitted edits at all. Passing `'HEAD'` to `svn.diff` would run
 * `-c HEAD` and render a confidently wrong diff, so the hook returns an
 * explicit unsupported state instead.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SvnDiffFile, SvnDiffHunk } from '@shared/types';

import type { Comparand } from '../types';
import {
  describeError,
  isAuthFailure,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_HISTORY_STALE_TIME_MS,
  repoDiffQueryKey,
  type UnsupportedCapability,
} from './queryKeys';

/** Which SVN call answers a comparand, with everything needed to make it. */
export type RepoDiffPlan =
  | {
      call: 'diff';
      /** Local working-copy path. */
      path: string;
      /** Left undefined on purpose: `svn.diff` maps this to `-c`, not `-r`. */
      revision?: string;
      label: string;
      consequence: string;
    }
  | {
      call: 'diffUrls';
      leftUrl: string;
      rightUrl: string;
      label: string;
      consequence: string;
    }
  | {
      call: 'unsupported';
      label: string;
      consequence: string;
      unsupported: UnsupportedCapability;
    };

export interface RepoDiffInputs {
  /** BASE revision of the working copy. Required for `base-head`. */
  baseRevision?: number | null;
  /** The other side of a `branch-trunk` comparison. */
  compareUrl?: string | null;
  /** Endpoints for `rev-rev`. */
  leftRevision?: number | null;
  rightRevision?: number | null;
}

function revisionLabel(revision: number | null | undefined): string {
  return typeof revision === 'number' ? `r${revision}` : 'BASE';
}

/**
 * Choose the SVN call for a comparand. Pure — no `window.api`, no React.
 */
export function planRepoDiff(
  url: string,
  comparand: Comparand,
  workingCopyPath: string | null | undefined,
  inputs: RepoDiffInputs = {}
): RepoDiffPlan {
  const { baseRevision = null, compareUrl = null, leftRevision = null, rightRevision = null } =
    inputs;

  switch (comparand) {
    case 'wc-base': {
      if (!workingCopyPath) {
        return {
          call: 'unsupported',
          label: 'working copy ↔ BASE',
          consequence: 'Uncommitted local edits only — nothing incoming from the server.',
          unsupported: {
            capability: 'diff:wc-base',
            reason:
              'This path is not inside a checkout, so there is no working copy to compare against BASE. Only server-side comparisons are available here.',
            command: 'svn checkout <url> <path>',
          },
        };
      }
      return {
        call: 'diff',
        path: workingCopyPath,
        // No revision: `svn diff -- PATH` is BASE ↔ working, which is exactly
        // this comparand. Supplying one would switch it to `-c`.
        label: `working copy ↔ BASE ${revisionLabel(baseRevision)}`,
        consequence:
          'Your uncommitted edits only — anything committed to the server since your last update is not in this diff.',
      };
    }

    case 'wc-head': {
      return {
        call: 'unsupported',
        label: `working copy ↔ HEAD`,
        consequence:
          'Would show your edits plus everything incoming — the full distance between your disk and the server.',
        unsupported: {
          capability: 'diff:wc-head',
          reason:
            'The IPC layer only exposes `svn diff -c CHANGE` for working-copy paths, never `-r BASE:HEAD`, and URL diffs run server-side so they cannot see uncommitted edits. Combining the two would misreport the result, so this comparison is not offered.',
          command: workingCopyPath
            ? `svn diff -r HEAD "${workingCopyPath}"`
            : 'svn diff -r HEAD <working copy path>',
        },
      };
    }

    case 'base-head': {
      if (typeof baseRevision !== 'number') {
        return {
          call: 'unsupported',
          label: 'BASE ↔ HEAD',
          consequence: 'Incoming changes only — your edits are not in this diff.',
          unsupported: {
            capability: 'diff:base-head',
            reason:
              'The BASE revision comes from `svn info` on a working copy. Without a checkout there is no BASE to compare HEAD against — pick two explicit revisions instead.',
            command: 'svn diff <url>@<rev> <url>@HEAD',
          },
        };
      }
      return {
        call: 'diffUrls',
        leftUrl: `${url}@${baseRevision}`,
        rightUrl: `${url}@HEAD`,
        label: `BASE r${baseRevision} ↔ HEAD`,
        consequence:
          'Incoming changes only — your edits are not in this diff. This is what an update would bring you.',
      };
    }

    case 'branch-trunk': {
      if (!compareUrl) {
        return {
          call: 'unsupported',
          label: 'branch ↔ trunk',
          consequence: 'Divergence between two paths, ignoring anything uncommitted.',
          unsupported: {
            capability: 'diff:branch-trunk',
            reason:
              'No comparison path has been chosen. Subversion cannot infer which branch this one should be measured against — pick one.',
            command: `svn diff <other url> "${url}"`,
          },
        };
      }
      return {
        call: 'diffUrls',
        leftUrl: compareUrl,
        rightUrl: url,
        label: `${compareUrl} ↔ ${url}`,
        consequence:
          'Every difference between the two paths on the server, including changes each inherited separately. Uncommitted local edits are not included.',
      };
    }

    case 'rev-rev': {
      if (typeof leftRevision !== 'number' || typeof rightRevision !== 'number') {
        return {
          call: 'unsupported',
          label: 'revision ↔ revision',
          consequence: 'Any two revisions, compared on the server.',
          unsupported: {
            capability: 'diff:rev-rev',
            reason: 'Both revisions must be chosen before Subversion can compare them.',
            command: `svn diff "${url}@<from>" "${url}@<to>"`,
          },
        };
      }
      return {
        call: 'diffUrls',
        leftUrl: `${url}@${leftRevision}`,
        rightUrl: `${url}@${rightRevision}`,
        label: `r${leftRevision} ↔ r${rightRevision}`,
        consequence:
          'Two points in the repository’s history. Nothing on your disk is involved, so uncommitted edits are not shown.',
      };
    }

    default: {
      return {
        call: 'unsupported',
        label: 'unknown comparison',
        consequence: 'No comparison selected.',
        unsupported: {
          capability: 'diff:unknown',
          reason: 'No comparison has been selected.',
        },
      };
    }
  }
}

/** Query-key fragment identifying a plan, so two plans never share a cache slot. */
export function repoDiffPlanKey(plan: RepoDiffPlan): readonly (string | number | null)[] {
  if (plan.call === 'diff') return ['diff', plan.path, plan.revision ?? null];
  if (plan.call === 'diffUrls') return ['diffUrls', plan.leftUrl, plan.rightUrl];
  return ['unsupported', plan.label];
}

export interface UseRepoDiffOptions extends RepoDiffInputs {
  enabled?: boolean;
}

export interface UseRepoDiffResult {
  /** Straight into `DiffView`'s `hunks` — already `SvnDiffHunk` from @shared/types. */
  hunks: SvnDiffHunk[];
  /** The per-file breakdown, when the caller needs more than one file's hunks. */
  files: SvnDiffFile[];
  /** `DiffView`'s `isBinary`. */
  isBinary: boolean;
  /** `DiffView`'s `comparisonLabel`, e.g. `working copy ↔ BASE r4821`. */
  comparisonLabel: string;
  /** What this comparison does and does not include — the spec's rule 3. */
  consequence: string;
  loading: boolean;
  error: string | null;
  needsAuth: boolean;
  /** Set when the comparand cannot be answered; render this, do not fake a diff. */
  unsupported: UnsupportedCapability | null;
  /** The chosen call, exposed so the UI can show the `svn` command hint. */
  plan: RepoDiffPlan;
  /** Raw unified diff when SVN could not be parsed into hunks. */
  rawDiff: string | null;
  refetch: () => void;
}

const EMPTY_FILES: SvnDiffFile[] = [];
const EMPTY_HUNKS: SvnDiffHunk[] = [];

export function useRepoDiff(
  url: string,
  comparand: Comparand,
  workingCopyPath: string | null | undefined,
  options: UseRepoDiffOptions = {}
): UseRepoDiffResult {
  const {
    enabled = true,
    baseRevision = null,
    compareUrl = null,
    leftRevision = null,
    rightRevision = null,
  } = options;

  const plan = useMemo(
    () =>
      planRepoDiff(url, comparand, workingCopyPath, {
        baseRevision,
        compareUrl,
        leftRevision,
        rightRevision,
      }),
    [url, comparand, workingCopyPath, baseRevision, compareUrl, leftRevision, rightRevision]
  );

  const query = useQuery({
    queryKey: repoDiffQueryKey(repoDiffPlanKey(plan)),
    queryFn: ({ signal }) => {
      if (plan.call === 'diff') {
        return window.api.svn.diff(plan.path, plan.revision, { signal });
      }
      if (plan.call === 'diffUrls') {
        return window.api.svn.diffUrls(plan.leftUrl, plan.rightUrl, { signal });
      }
      // Unreachable: the query is disabled for unsupported plans.
      return Promise.reject(new Error(plan.unsupported.reason));
    },
    enabled: enabled && url.length > 0 && plan.call !== 'unsupported',
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  // `svn:diff` resolves with an error field rather than throwing.
  const result = query.data;
  const resultError = result?.error ?? null;

  const files = useMemo(() => {
    if (!result || resultError) return EMPTY_FILES;
    // Defensive: `svn:diff` always sends `files`, even on failure — but this is
    // an IPC boundary, and a payload without it would otherwise take the whole
    // route down with it rather than showing an empty diff.
    return result.files ?? EMPTY_FILES;
  }, [result, resultError]);

  const hunks = useMemo(() => {
    if (files.length === 0) return EMPTY_HUNKS;
    return files.flatMap((file) => file.hunks);
  }, [files]);

  const isBinary =
    result?.isBinary === true ||
    (files.length > 0 && files.every((file) => file.isBinary === true));

  const thrownError = describeError(query.error);
  const error = thrownError ?? resultError;
  const needsAuth = isAuthFailure(query.error, resultError);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    hunks,
    files,
    isBinary,
    comparisonLabel: plan.label,
    consequence: plan.consequence,
    loading: plan.call !== 'unsupported' && (query.isLoading || query.isFetching),
    error: error && !needsAuth ? error : null,
    needsAuth,
    unsupported: plan.call === 'unsupported' ? plan.unsupported : null,
    plan,
    rawDiff: result?.rawDiff ?? null,
    refetch,
  };
}
