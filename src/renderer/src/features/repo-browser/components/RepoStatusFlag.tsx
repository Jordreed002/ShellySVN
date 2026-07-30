/**
 * Status flags for the repository-browser contents list.
 *
 * Subversion's vocabulary, used precisely: every flag shows the **word and the
 * code together** (`Modified M`, `Conflicted C`) so the letter people see in
 * `svn status` output is always tied to its meaning.
 *
 * Nothing in this file decides *whether* a status may be shown — that is the
 * caller's job, and the rule is absolute: status is a working-copy fact and
 * must never be rendered for a plain `svn list` of the server. See
 * `RepoContentsRow`, which is the only place that decision is made.
 *
 * Design source: `prototypes/12-browser.html` (`.flag`, `.flag.quiet`).
 */

import type { ReactElement } from 'react';
import { HardDrive, Lock } from 'lucide-react';

import type { RepoRollup, RepoStatusCode } from '../types';

/** The word Subversion uses for each status code. */
const STATUS_LABEL: Record<RepoStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  C: 'Conflicted',
  R: 'Replaced',
  X: 'External',
  '?': 'Unversioned',
  I: 'Ignored',
  '!': 'Missing',
  '~': 'Obstructed',
};

/**
 * Colour per code, from the project's SVN status tokens. Conflicts are the one
 * status that is filled rather than tinted — a conflict stops work, so it is
 * allowed to shout.
 */
const STATUS_TONE: Record<RepoStatusCode, string> = {
  M: 'border-svn-modified/40 bg-svn-modified/10 text-svn-modified',
  A: 'border-svn-added/40 bg-svn-added/10 text-svn-added',
  D: 'border-svn-deleted/40 bg-svn-deleted/10 text-svn-deleted',
  C: 'border-svn-conflict bg-svn-conflict text-bg',
  R: 'border-svn-replaced/40 bg-svn-replaced/10 text-svn-replaced',
  X: 'border-svn-external/40 bg-svn-external/10 text-svn-external',
  '?': 'border-svn-unversioned/40 bg-svn-unversioned/10 text-svn-unversioned',
  I: 'border-svn-ignored/40 bg-svn-ignored/10 text-svn-ignored',
  '!': 'border-svn-missing/40 bg-svn-missing/10 text-svn-missing',
  '~': 'border-svn-obstructed/40 bg-svn-obstructed/10 text-svn-obstructed',
};

const FLAG_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-1.5 py-px text-xs font-bold leading-5';

/** The word Subversion uses for a status code, e.g. `M` → `Modified`. */
export function repoStatusLabel(code: RepoStatusCode): string {
  return STATUS_LABEL[code];
}

export interface RepoStatusFlagProps {
  /** The `svn status` code for this entry. */
  code: RepoStatusCode;
  /**
   * Hide the spelled-out word and show the bare code. Only for places with no
   * room for the word — the list always has room.
   */
  codeOnly?: boolean;
  className?: string;
}

/**
 * One status, as the word and the code together: `Modified M`.
 */
export function RepoStatusFlag({ code, codeOnly = false, className }: RepoStatusFlagProps): ReactElement {
  const label = STATUS_LABEL[code];

  return (
    <span
      className={`${FLAG_BASE} ${STATUS_TONE[code]}${className ? ` ${className}` : ''}`}
      title={`${label} — svn status ${code}`}
    >
      {codeOnly ? (
        <span className="font-mono text-2xs font-medium">{code}</span>
      ) : (
        <>
          {label}
          <span className="font-mono text-2xs font-medium opacity-70">{code}</span>
        </>
      )}
    </span>
  );
}

export interface RepoRollupFlagsProps {
  /**
   * Counts of changed descendants. Only ever computed inside a working copy —
   * do not pass anything derived from `svn list`.
   */
  rollup: RepoRollup;
  className?: string;
}

/**
 * Roll-up counts for a directory: changed descendants and conflicted
 * descendants as two separate chips, because a conflict is not "more of the
 * same kind of change" — it is a different problem with a different fix.
 *
 * Renders nothing when the subtree is clean.
 */
export function RepoRollupFlags({ rollup, className }: RepoRollupFlagsProps): ReactElement | null {
  const changed = rollup.modified + rollup.added;

  if (changed === 0 && rollup.conflicted === 0) return null;

  return (
    <span className={`inline-flex items-center gap-1${className ? ` ${className}` : ''}`}>
      {changed > 0 && (
        <span
          className={`${FLAG_BASE} ${STATUS_TONE.M}`}
          title={`${changed} changed ${changed === 1 ? 'item' : 'items'} below this directory (${rollup.modified} modified, ${rollup.added} added)`}
        >
          {changed}
          <span className="sr-only">
            {' '}
            changed {changed === 1 ? 'item' : 'items'} below this directory
          </span>
        </span>
      )}
      {rollup.conflicted > 0 && (
        <span
          className={`${FLAG_BASE} ${STATUS_TONE.C}`}
          title={`${rollup.conflicted} conflicted ${rollup.conflicted === 1 ? 'item' : 'items'} below this directory`}
        >
          {rollup.conflicted}
          <span className="sr-only">
            {' '}
            conflicted {rollup.conflicted === 1 ? 'item' : 'items'} below this directory
          </span>
        </span>
      )}
    </span>
  );
}

export interface RepoPresenceFlagProps {
  /** `full` → checked out; `sparse` → partly checked out. `none` renders nothing. */
  presence: 'full' | 'sparse' | 'none';
  className?: string;
}

/**
 * Marks the **exception, not the rule**. In a repository with fifty-one client
 * directories, "not checked out" is the normal state and labelling it would be
 * noise — so only the ones that *are* on disk get a mark, and it is deliberately
 * quiet.
 */
export function RepoPresenceFlag({ presence, className }: RepoPresenceFlagProps): ReactElement | null {
  if (presence === 'none') return null;

  const label = presence === 'full' ? 'checked out' : 'partly checked out';

  return (
    <span
      className={`${FLAG_BASE} border-border bg-bg-tertiary font-semibold text-text-secondary${className ? ` ${className}` : ''}`}
      title={
        presence === 'full'
          ? 'A working copy of this directory exists on disk'
          : 'On disk at a limited depth — some subtrees were never fetched (svn info --depth)'
      }
    >
      <HardDrive className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export interface RepoLockFlagProps {
  /** The lock as reported by `svn info`. */
  lock: { owner: string; comment?: string; created: string };
  className?: string;
}

/**
 * Lock indicator. Sits next to the name rather than in the status column: a
 * lock is not a change, and it applies whether or not the file is modified.
 */
export function RepoLockFlag({ lock, className }: RepoLockFlagProps): ReactElement {
  const description = `Locked by ${lock.owner}${lock.comment ? ` — ${lock.comment}` : ''} · svn unlock`;

  return (
    <span
      className={`inline-flex shrink-0 items-center text-svn-modified${className ? ` ${className}` : ''}`}
      title={description}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{description}</span>
    </span>
  );
}
