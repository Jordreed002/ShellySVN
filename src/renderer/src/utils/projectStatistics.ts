import type { SvnLogEntry } from '@shared/types';

export interface ProjectStatistics {
  commitsOverTime: Array<{ date: string; commits: number }>;
  authors: Array<{ author: string; commits: number }>;
  fileChurn: Array<{ path: string; changes: number; additions: number; deletions: number }>;
  branchTagActivity: Array<{ path: string; type: 'branch' | 'tag'; revisions: number[] }>;
}

function toDateKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function classifyBranchTag(path: string): 'branch' | 'tag' | null {
  if (path.includes('/branches/')) return 'branch';
  if (path.includes('/tags/')) return 'tag';
  return null;
}

export function buildProjectStatistics(entries: SvnLogEntry[]): ProjectStatistics {
  const commitsByDate = new Map<string, number>();
  const authors = new Map<string, number>();
  const churn = new Map<string, { path: string; changes: number; additions: number; deletions: number }>();
  const branchTagActivity = new Map<string, { path: string; type: 'branch' | 'tag'; revisions: Set<number> }>();

  for (const entry of entries) {
    const dateKey = toDateKey(entry.date);
    commitsByDate.set(dateKey, (commitsByDate.get(dateKey) ?? 0) + 1);
    authors.set(entry.author || 'Unknown', (authors.get(entry.author || 'Unknown') ?? 0) + 1);

    for (const changedPath of entry.paths) {
      const item = churn.get(changedPath.path) ?? {
        path: changedPath.path,
        changes: 0,
        additions: 0,
        deletions: 0,
      };
      item.changes += 1;
      if (changedPath.action === 'A') item.additions += 1;
      if (changedPath.action === 'D') item.deletions += 1;
      churn.set(changedPath.path, item);

      const branchTagType = classifyBranchTag(changedPath.path) ?? (
        changedPath.copyFromPath ? classifyBranchTag(changedPath.copyFromPath) : null
      );
      if (branchTagType) {
        const activity = branchTagActivity.get(changedPath.path) ?? {
          path: changedPath.path,
          type: branchTagType,
          revisions: new Set<number>(),
        };
        activity.revisions.add(entry.revision);
        branchTagActivity.set(changedPath.path, activity);
      }
    }
  }

  return {
    commitsOverTime: Array.from(commitsByDate, ([date, commits]) => ({ date, commits })).sort(
      (a, b) => a.date.localeCompare(b.date)
    ),
    authors: Array.from(authors, ([author, commits]) => ({ author, commits })).sort(
      (a, b) => b.commits - a.commits || a.author.localeCompare(b.author)
    ),
    fileChurn: Array.from(churn.values()).sort(
      (a, b) => b.changes - a.changes || a.path.localeCompare(b.path)
    ),
    branchTagActivity: Array.from(branchTagActivity.values())
      .map((item) => ({
        path: item.path,
        type: item.type,
        revisions: Array.from(item.revisions).sort((a, b) => a - b),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
