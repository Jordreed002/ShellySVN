import type { SvnExternalsResult, SvnStatusResult } from '@shared/types';

import type { RepoProblem } from './types';

function normalizedStatusPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

/** Pure problem derivation shared by the repository browser and sidebar. */
export function deriveProblems(options: {
  status: SvnStatusResult | undefined;
  externals: SvnExternalsResult | undefined;
  localPath: string;
  needsCleanup?: boolean;
  staleLockDays?: number;
  incomingRevisions?: number;
  incomingCapped?: boolean;
}): RepoProblem[] {
  const {
    status,
    externals,
    localPath,
    needsCleanup,
    staleLockDays = 14,
    incomingRevisions = 0,
    incomingCapped = false,
  } = options;
  const problems: RepoProblem[] = [];
  const missingPaths = new Set(
    (status?.entries ?? [])
      .filter((entry) => entry.status === '!')
      .map((entry) => normalizedStatusPath(entry.path))
  );
  const treeConflictPaths = new Set(
    (status?.entries ?? [])
      .filter((entry) => entry.treeConflict)
      .map((entry) => normalizedStatusPath(entry.path))
  );

  for (const entry of status?.entries ?? []) {
    if (entry.treeConflict) {
      problems.push({
        kind: 'tree-conflict',
        severity: 'blocking',
        path: entry.path,
        title: `Tree conflict · ${entry.path}`,
        explanation:
          'An incoming structural change collided with a local move or delete. No merge editor can decide which directory structure should win.',
        command: `svn resolve --accept working "${entry.path}"`,
      });
    } else if (entry.status === 'C') {
      problems.push({
        kind: 'text-conflict',
        severity: 'blocking',
        path: entry.path,
        title: `Conflicted · ${entry.path}`,
        explanation:
          'You and someone else changed the same lines. Subversion kept every version alongside the file and stopped, rather than guessing. Commit is blocked until this is resolved.',
        command: `svn resolve --accept working "${entry.path}"`,
      });
    } else if (entry.status === '!') {
      // A remote-aware status reports this exact combination when the path was
      // removed in a newer repository revision. Updating reconciles it; it is
      // not a local working-copy problem.
      if (entry.remoteStatus === 'D') continue;
      let parentPath = normalizedStatusPath(entry.path);
      let nestedBelowMissingPath = false;
      while (parentPath.includes('/')) {
        parentPath = parentPath.slice(0, parentPath.lastIndexOf('/'));
        if (treeConflictPaths.has(parentPath)) {
          nestedBelowMissingPath = true;
          break;
        }
        if (missingPaths.has(parentPath)) {
          nestedBelowMissingPath = true;
          break;
        }
      }
      if (nestedBelowMissingPath) continue;
      problems.push({
        kind: 'missing',
        severity: 'blocking',
        path: entry.path,
        title: `Missing · ${entry.path}`,
        explanation:
          'The working copy still expects this versioned item, but it is absent from disk. Restore it, or schedule its deletion explicitly before committing.',
        command: `svn revert "${entry.path}"`,
      });
    }
    if (entry.lock) {
      const lockedAt = Date.parse(entry.lock.date);
      const ageDays = Number.isNaN(lockedAt) ? 0 : (Date.now() - lockedAt) / (1000 * 60 * 60 * 24);
      if (ageDays > staleLockDays) {
        problems.push({
          kind: 'stale-lock',
          severity: 'warning',
          path: entry.path,
          title: `Stale lock · ${entry.path}`,
          explanation: `Held by ${entry.lock.owner} for ${Math.round(ageDays)} days. Subversion locks never expire on their own, so a forgotten lock blocks everyone until it is broken.`,
          command: `svn unlock --force "${entry.path}"`,
        });
      }
    }
  }

  if (needsCleanup) {
    problems.push({
      kind: 'needs-cleanup',
      severity: 'blocking',
      path: localPath,
      title: `Working copy needs cleanup · ${localPath}`,
      explanation:
        'An operation was interrupted, so the working copy is still holding its own internal lock. Nothing is lost and nothing is broken — but every further operation on this copy will refuse to start until it is cleared.',
      command: `svn cleanup "${localPath}"`,
    });
  }

  for (const external of externals?.externals ?? []) {
    const pegged =
      typeof external.pegRevision === 'number' || typeof external.revision === 'number';
    if (!pegged) {
      problems.push({
        kind: 'floating-external',
        severity: 'advisory',
        path: external.path,
        title: `Floating external · ${external.path}`,
        explanation:
          'This external has no peg revision, so every update can silently pull different content and the build stops being reproducible. Pin it to a revision or a tag.',
        command: `svn propedit svn:externals "${external.path}"`,
      });
    }
  }

  if (incomingRevisions > 0) {
    const count = incomingCapped ? `${incomingRevisions}+` : `${incomingRevisions}`;
    problems.push({
      kind: 'out-of-date',
      severity: 'advisory',
      path: localPath,
      title: `${count} revision${incomingRevisions === 1 ? '' : 's'} behind`,
      explanation:
        'Work has landed on the server that this copy does not have yet. Committing is still allowed, but the longer the gap the more likely the next update produces conflicts — and a merge from here will be reasoning about an old picture of the branch.',
      command: `svn update "${localPath}"`,
    });
  }

  return problems;
}
