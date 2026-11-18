/**
 * The facts behind the Home briefing, as pure functions.
 *
 * Home is the first screen of the session, so it is also the easiest place to
 * print a number nobody measured. Every helper here keeps three states apart:
 *
 * - **measured** — `svn status` / `svn info` answered for this checkout;
 * - **not measured yet** — the read has not resolved, so there is no count;
 * - **not a checkout** — there are no local facts to have, which is not zero.
 *
 * Nothing in this file fetches. The rail's queries (`useWorkingCopyOverview`,
 * `useWorkingCopyShelves`, `collectProblems`) are the only source of these
 * facts, and Home is a second consumer of that same cache.
 */

import type {
  RailProblems,
  RepoStatusCounts,
  SidebarPresence,
  WorkingCopyInfo,
  WorkingCopySummary,
} from '@renderer/components/sidebar/sidebarData';
import { describeRepo } from '@renderer/components/sidebar/sidebarData';

/** One working copy as the briefing describes it. */
export interface HomeWorkingCopy {
  /** Absolute path of the checkout on this machine. */
  path: string;
  /** Last path segment — what the row is titled. */
  name: string;
  presence: SidebarPresence;
  /** Present only when `svn status` answered for this path. */
  status?: RepoStatusCounts;
  /** Present only when `svn info` answered for this path. */
  info?: WorkingCopyInfo;
}

/** Working copies in rail order (most recently opened first). */
export function buildHomeWorkingCopies(
  paths: readonly string[],
  overview: ReadonlyMap<string, WorkingCopySummary>
): HomeWorkingCopy[] {
  return paths.map((path) => {
    const summary = overview.get(path);
    return {
      path,
      name: describeRepo(path).name,
      presence: summary?.presence ?? 'unknown',
      status: summary?.status,
      info: summary?.info,
    };
  });
}

/** True for a path `svn status` answered for, i.e. one with local facts. */
export function isCheckedOut(row: HomeWorkingCopy): boolean {
  return row.presence === 'full' || row.presence === 'sparse';
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The mono line under the briefing's heading.
 *
 * Only measured segments appear. Local changes are summed across the checkouts
 * that answered, and the ones that have not answered are counted separately
 * rather than being folded in as zero — `20 local changes` and
 * `20 local changes · 1 not measured` are different claims.
 */
export function summarizeBriefing(
  rows: readonly HomeWorkingCopy[],
  problems: RailProblems
): string {
  const parts: string[] = [plural(rows.length, 'working copy', 'working copies')];

  let changes = 0;
  let conflicts = 0;
  let measured = 0;
  for (const row of rows) {
    const status = row.status;
    if (!status) continue;
    measured += 1;
    changes += status.changes;
    conflicts += status.conflicts;
  }

  if (measured > 0) parts.push(plural(changes, 'local change', 'local changes'));
  if (problems.total > 0) parts.push(plural(problems.total, 'problem', 'problems'));
  if (conflicts > 0) parts.push(plural(conflicts, 'conflicted (C)', 'conflicted (C)'));

  const notCheckedOut = rows.filter((row) => row.presence === 'none').length;
  if (notCheckedOut > 0) parts.push(`${notCheckedOut} not checked out`);
  if (problems.unmeasured > 0) parts.push(`${problems.unmeasured} not measured`);

  return parts.join(' · ');
}

/* ── the four operations ─────────────────────────────────────────────────── */

type OperationKind = 'update' | 'commit' | 'revert' | 'diff';

export interface OperationState {
  kind: OperationKind;
  /** Subversion's word for it. There are no synonyms. */
  word: string;
  /** The command it runs, shown next to the word — never hidden behind a mode. */
  command: string;
  /** False when the operation would fail, with `note` saying why. */
  enabled: boolean;
  /** Visible sub-line: the target, or the reason this is unavailable. */
  note: string;
  /** Longer form for `title` — the sub-line has to fit the tile. */
  detail: string;
}

const NO_WORKING_COPY = 'No working copy open';

/**
 * What each operation would do right now, and where it cannot.
 *
 * `svn commit` is the interesting one: Subversion aborts a commit whose target
 * contains a conflicted item, so offering the button and letting it fail is
 * worse than refusing it with the reason. Where local changes have not been
 * measured the operation stays available and says so — refusing an action
 * because a read is slow would be its own kind of lie.
 */
export function describeOperations(target: HomeWorkingCopy | undefined): OperationState[] {
  if (!target) {
    return [
      {
        kind: 'update',
        word: 'Update',
        command: 'svn update',
        enabled: false,
        note: NO_WORKING_COPY,
        detail: 'Open a working copy or check one out before updating.',
      },
      {
        kind: 'commit',
        word: 'Commit',
        command: 'svn commit',
        enabled: false,
        note: NO_WORKING_COPY,
        detail: 'There is nothing to commit until a working copy is open.',
      },
      {
        kind: 'revert',
        word: 'Revert',
        command: 'svn revert',
        enabled: false,
        note: NO_WORKING_COPY,
        detail: 'Reverting discards local edits, which only exist in a checkout.',
      },
      {
        kind: 'diff',
        word: 'Diff',
        command: 'svn diff',
        enabled: false,
        note: NO_WORKING_COPY,
        detail: 'A diff compares your working copy with BASE — open one first.',
      },
    ];
  }

  const { name, path, status, info } = target;
  const changes = status?.changes;
  const conflicts = status?.conflicts ?? 0;
  const unmeasured = !status;
  const changeNote = unmeasured
    ? 'changes not measured yet'
    : plural(changes ?? 0, 'change', 'changes');

  return [
    {
      kind: 'update',
      word: 'Update',
      command: 'svn update',
      enabled: true,
      note: `in ${name}`,
      detail: `Bring ${path} up to HEAD${info ? ` from ${info.url}` : ''} — svn update`,
    },
    {
      kind: 'commit',
      word: 'Commit',
      command: 'svn commit',
      enabled: conflicts === 0 && changes !== 0,
      note:
        conflicts > 0
          ? `${conflicts} conflicted (C) blocks commit`
          : changes === 0
            ? `Nothing modified in ${name}`
            : `${changeNote} in ${name}`,
      detail:
        conflicts > 0
          ? `Subversion aborts a commit while ${path} holds a conflicted item — svn resolve it first`
          : changes === 0
            ? `svn status found nothing to commit in ${path}`
            : `Commit ${changeNote} in ${path} — svn commit`,
    },
    {
      kind: 'revert',
      word: 'Revert',
      command: 'svn revert',
      enabled: changes !== 0,
      note: changes === 0 ? `Nothing to discard in ${name}` : `${changeNote} in ${name}`,
      detail:
        changes === 0
          ? `svn status found no local edits in ${path}`
          : `Discard local edits in ${path} — svn revert`,
    },
    {
      kind: 'diff',
      word: 'Diff',
      command: 'svn diff',
      enabled: true,
      note: info ? `working copy ↔ BASE r${info.revision}` : `in ${name}`,
      detail: info
        ? `Compare ${path} with BASE r${info.revision} — your uncommitted edits only`
        : `Compare ${path} with BASE — svn diff`,
    },
  ];
}

/* ── the focus working copy ──────────────────────────────────────────────── */

/**
 * The working copy Home leads with: the most recently opened one that is (or
 * may still turn out to be) a checkout. A row whose status is still loading is
 * kept in place rather than skipped, so the focus does not jump to another
 * working copy when a slow `svn status` resolves.
 */
export function pickFocusWorkingCopy(
  rows: readonly HomeWorkingCopy[]
): HomeWorkingCopy | undefined {
  return rows.find((row) => row.presence !== 'none') ?? rows[0];
}

export type LocalStateTone = 'muted' | 'clean' | 'modified' | 'conflict';

export interface LocalStateDescription {
  label: string;
  tone: LocalStateTone;
}

const formatCount = (count: number) => count.toLocaleString('en-US');

/**
 * One phrase for what `svn status` said about a working copy. Keeps the three
 * states apart: a checkout that answered, one that has not answered yet, and
 * a path that is no longer a checkout at all.
 */
export function describeLocalState(row: HomeWorkingCopy): LocalStateDescription {
  if (row.presence === 'none') return { label: 'Not a working copy', tone: 'conflict' };
  const status = row.status;
  if (!status) return { label: 'Reading local state…', tone: 'muted' };
  if (status.conflicts > 0) {
    return {
      label: `${plural(status.conflicts, 'conflict', 'conflicts')} · ${formatCount(status.changes)} local ${
        status.changes === 1 ? 'change' : 'changes'
      }`,
      tone: 'conflict',
    };
  }
  if (status.changes > 0) {
    return {
      label: `${formatCount(status.changes)} local ${status.changes === 1 ? 'change' : 'changes'}`,
      tone: 'modified',
    };
  }
  return { label: 'No local changes', tone: 'clean' };
}
