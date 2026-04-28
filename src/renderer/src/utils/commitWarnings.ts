import type { SvnStatusChar, SvnStatusEntry } from '@shared/types';

export type CommitWarningSeverity = 'info' | 'warning' | 'danger';

export interface CommitWarning {
  id: string;
  severity: CommitWarningSeverity;
  message: string;
  paths: string[];
}

export interface CommitWarningFile {
  path: string;
  status: SvnStatusChar;
  selected: boolean;
  propsStatus?: SvnStatusChar;
  revision?: number;
  switched?: boolean;
  lock?: SvnStatusEntry['lock'];
}

const MAX_PATHS = 4;

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function summarizePaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_PATHS);
  const remaining = paths.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')} and ${remaining} more` : shown.join(', ');
}

function pathContains(parent: string, child: string): boolean {
  if (parent === child) return true;
  const normalizedParent = parent.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedChild = child.replace(/\\/g, '/');
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

export function getCommitWarnings(
  files: CommitWarningFile[],
  statusEntries: Pick<SvnStatusEntry, 'path' | 'status' | 'switched'>[] = files
): CommitWarning[] {
  const selectedFiles = files.filter((file) => file.selected);
  const warnings: CommitWarning[] = [];

  const conflictedPaths = selectedFiles
    .filter((file) => file.status === 'C' || file.propsStatus === 'C')
    .map((file) => file.path);
  if (conflictedPaths.length > 0) {
    warnings.push({
      id: 'conflicts',
      severity: 'danger',
      message: `Resolve conflicted paths before committing: ${summarizePaths(conflictedPaths)}.`,
      paths: conflictedPaths,
    });
  }

  const mixedRevisionFiles = selectedFiles.filter(
    (file) => file.revision !== undefined && file.status !== '?' && file.status !== 'A'
  );
  const revisions = unique(mixedRevisionFiles.map((file) => file.revision));
  if (revisions.length > 1) {
    const paths = mixedRevisionFiles.map((file) => file.path);
    warnings.push({
      id: 'mixed-revisions',
      severity: 'warning',
      message: `Selected paths span mixed working-copy revisions (${revisions
        .toSorted((a, b) => (a ?? 0) - (b ?? 0))
        .map((revision) => `r${revision}`)
        .join(', ')}): ${summarizePaths(paths)}.`,
      paths,
    });
  }

  const switchedPaths = selectedFiles
    .filter((file) => file.switched)
    .map((file) => file.path);
  if (switchedPaths.length > 0) {
    warnings.push({
      id: 'switched-paths',
      severity: 'warning',
      message: `Selected paths are switched to another repository URL: ${summarizePaths(
        switchedPaths
      )}.`,
      paths: switchedPaths,
    });
  }

  const lockedPaths = selectedFiles.filter((file) => file.lock).map((file) => file.path);
  if (lockedPaths.length > 0) {
    warnings.push({
      id: 'locks',
      severity: 'warning',
      message: `Selected paths have SVN locks: ${summarizePaths(lockedPaths)}.`,
      paths: lockedPaths,
    });
  }

  const externalRoots = statusEntries
    .filter((entry) => entry.status === 'X')
    .map((entry) => entry.path);
  const selectedExternalPaths = selectedFiles
    .filter((file) => externalRoots.some((root) => pathContains(root, file.path)))
    .map((file) => file.path);
  if (externalRoots.length > 0) {
    warnings.push({
      id: 'externals',
      severity: selectedExternalPaths.length > 0 ? 'warning' : 'info',
      message:
        selectedExternalPaths.length > 0
          ? `Selected paths include SVN externals or nested working-copy content: ${summarizePaths(
              selectedExternalPaths
            )}.`
          : `SVN externals are present and are not committed with this working copy: ${summarizePaths(
              externalRoots
            )}.`,
      paths: selectedExternalPaths.length > 0 ? selectedExternalPaths : externalRoots,
    });
  }

  const unversionedPaths = selectedFiles
    .filter((file) => file.status === '?')
    .map((file) => file.path);
  if (unversionedPaths.length > 0) {
    warnings.push({
      id: 'unversioned',
      severity: 'info',
      message: `Unversioned paths are selected and may need to be added before commit: ${summarizePaths(
        unversionedPaths
      )}.`,
      paths: unversionedPaths,
    });
  }

  return warnings;
}
