import type {
  BranchComparisonReport,
  BranchComparisonResult,
  SvnDiffFile,
  SvnLogEntry,
} from '@shared/types';
import { getLog, getUrlDiff } from './svn-history';
import { validateRepositoryUrl } from './svn-intelligence-validation';
import { deriveRevisionImpact } from './svn-revision-impact';

const MAX_FILES = 5_000;
const MAX_LOG_ENTRIES = 250;
function deriveBranchComparison(
  leftUrl: string,
  rightUrl: string,
  files: SvnDiffFile[],
  leftLog: SvnLogEntry[],
  rightLog: SvnLogEntry[]
): BranchComparisonReport {
  const leftRevisions = new Set(leftLog.map((entry) => entry.revision));
  const rightRevisions = new Set(rightLog.map((entry) => entry.revision));
  const boundedFiles = files.slice(0, MAX_FILES).map(({ oldPath, newPath, isBinary }) => ({
    oldPath,
    newPath,
    ...(isBinary === undefined ? {} : { isBinary }),
  }));
  const impact = deriveRevisionImpact(rightUrl, rightLog);
  return {
    leftUrl,
    rightUrl,
    hasDifferences: files.length > 0,
    changedFiles: boundedFiles,
    leftOnlyRevisions: [...leftRevisions]
      .filter((revision) => !rightRevisions.has(revision))
      .toSorted((a, b) => b - a)
      .slice(0, MAX_LOG_ENTRIES),
    rightOnlyRevisions: [...rightRevisions]
      .filter((revision) => !leftRevisions.has(revision))
      .toSorted((a, b) => b - a)
      .slice(0, MAX_LOG_ENTRIES),
    impactGroups: impact.groups,
    truncated:
      files.length > boundedFiles.length ||
      leftLog.length > MAX_LOG_ENTRIES ||
      rightLog.length > MAX_LOG_ENTRIES,
  };
}

export async function compareBranches(
  leftUrl: string,
  rightUrl: string
): Promise<BranchComparisonResult> {
  const left = validateRepositoryUrl(leftUrl, 'Left branch');
  const right = validateRepositoryUrl(rightUrl, 'Right branch');
  const [diff, leftHistory, rightHistory] = await Promise.all([
    getUrlDiff(left, right),
    getLog(left, MAX_LOG_ENTRIES),
    getLog(right, MAX_LOG_ENTRIES),
  ]);
  if (
    diff.error ||
    leftHistory.error ||
    rightHistory.error ||
    leftHistory.parseError ||
    rightHistory.parseError
  )
    throw new Error(
      diff.error ??
        leftHistory.error ??
        rightHistory.error ??
        'SVN returned invalid branch comparison evidence.'
    );
  return {
    summary: deriveBranchComparison(
      left,
      right,
      diff.files,
      leftHistory.entries,
      rightHistory.entries
    ),
    diff,
  };
}
