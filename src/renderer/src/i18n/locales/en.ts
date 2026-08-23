/**
 * The `en` message catalog — the source locale (#134).
 *
 * Strings live here exactly as they were rendered before the i18n pilot; the
 * pilot test (`__tests__/pilot.test.tsx`) freezes that byte-identity. New
 * surfaces adopt keys here as they migrate to `useTranslation()`.
 */
import type { MessageCatalog } from '../types';

export const en: MessageCatalog = {
  statusLegend: {
    title: 'What the status colors mean',
    intro: {
      lead: 'Every letter',
      tail: 'can report about a working copy, with the color this app shows it in.',
    },
    entry: {
      none: {
        meaning: 'Versioned, unmodified, and in step with BASE — nothing to do.',
        actions: 'No action needed.',
      },
      A: {
        meaning:
          'Scheduled for addition — a new file or folder waiting for its first commit.',
        actions: 'Commit to send it to the repository, or Revert to unschedule it.',
      },
      C: {
        meaning:
          'A merge or update changed the same lines you did. Subversion refuses to commit until it is resolved.',
        actions: 'Resolve (pick a side or merge by hand), then Commit.',
      },
      D: {
        meaning:
          'Scheduled for deletion from the repository. The local file is already gone.',
        actions: 'Commit to record the deletion, or Revert to restore the file.',
      },
      I: {
        meaning: 'Matched by an ignore pattern, so Subversion skips it entirely.',
        actions: 'Edit ignore patterns to change what is skipped.',
      },
      M: {
        meaning: 'Changed locally against BASE — the everyday working state.',
        actions: 'Diff to review, Commit to keep, Revert to discard.',
      },
      R: {
        meaning:
          'Deleted and re-added in one step — the item keeps its path but starts a new history.',
        actions: 'Commit to record the replacement.',
      },
      X: {
        meaning: 'Pulled in from another repository by an svn:externals definition.',
        actions: 'Update fetches it; the externals manager edits the definition.',
      },
      question: {
        meaning:
          'On disk but not under version control — Subversion will neither commit nor revert it.',
        actions: 'Add to bring it under version control, or ignore it.',
      },
      missing: {
        meaning:
          'Versioned, but the file or folder is not on disk — moved or deleted outside Subversion.',
        actions: 'Revert to restore it, or Delete to schedule its removal.',
      },
      obstructed: {
        meaning:
          'Something of a different kind is in the way — for example a file sitting where a folder is versioned.',
        actions: 'Clear the obstruction, or Delete and re-Add the item.',
      },
      O: {
        meaning:
          'Exists in the repository but not on disk — this spot is only visited by a sparse checkout.',
        actions: 'Update with the right depth to pull it in.',
      },
    },
  },
  routes: {
    files: {
      title: 'File Explorer',
    },
  },
};
