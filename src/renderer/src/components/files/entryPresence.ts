/**
 * Presence of a file-listing entry, in the repository browser's vocabulary.
 *
 * `svn ls` describes the server and `svn status` describes your disk. A local
 * listing can be asked to include the entries the repository has in this folder
 * that the disk does not (see the Files toolbar's "Show items not checked out"),
 * and those entries are **presence, never status**: Subversion has nothing to
 * say about the state of a path it never fetched.
 *
 * This app carries them through `SvnStatusEntry` with the code `'O'`, so this is
 * the one place that translates that code into the word the repository browser
 * uses for the same fact — `LocalPresence`, imported read-only from
 * `features/repo-browser`, so the two views cannot drift into two vocabularies.
 */

import type { SvnStatusEntry } from '@shared/types';

import type { LocalPresence } from '../../features/repo-browser/types';

/**
 * `'none'` — the repository lists this path and it is not on disk here.
 *
 * `undefined` for everything else, deliberately: telling `full` from `sparse`
 * needs a checkout depth `svn info` does not report, and a presence nobody
 * measured is not a presence to print. See `SPEC.md`, "never print a confident
 * zero for something you did not measure".
 */
export function entryPresence(
  entry: Pick<SvnStatusEntry, 'status'> | null | undefined
): LocalPresence | undefined {
  return entry?.status === 'O' ? 'none' : undefined;
}

/** True when the repository has this entry and this working copy does not. */
export function isNotOnDisk(entry: Pick<SvnStatusEntry, 'status'> | null | undefined): boolean {
  return entryPresence(entry) === 'none';
}
