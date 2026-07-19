export type BranchKind = 'trunk' | 'branch' | 'tag' | 'other';

export interface BranchContext {
  /** Repository URL that holds the trunk/branches/tags triad. */
  branchRootUrl: string;
  /** Human label for the current branch (e.g. 'trunk', 'feature-x'). */
  branch: string;
  branchKind: BranchKind;
  /** Path within the branch (after trunk/ or branches/<name>/). '' at the branch root. */
  subPath: string;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Layer A — resolve the nearest branch-root for a repository URL by locating the
 * deepest trunk/branches/tags layout marker. SVN branches can live at any folder
 * level, so we key off the standard layout rather than a fixed depth.
 *
 * Returns null when the URL doesn't follow a standard layout (no marker found).
 */
export function resolveBranchContext(url: string | undefined | null): BranchContext | null {
  if (!url) return null;
  const u = stripTrailingSlash(url.replace(/\\/g, '/'));

  const candidates: BranchContext[] = [];

  const trunk = u.match(/^(.*)\/trunk(?:\/(.*))?$/);
  if (trunk) {
    candidates.push({
      branchRootUrl: trunk[1],
      branch: 'trunk',
      branchKind: 'trunk',
      subPath: trunk[2] ?? '',
    });
  }

  const branch = u.match(/^(.*)\/branches\/([^/]+)(?:\/(.*))?$/);
  if (branch) {
    candidates.push({
      branchRootUrl: branch[1],
      branch: branch[2],
      branchKind: 'branch',
      subPath: branch[3] ?? '',
    });
  }

  const tag = u.match(/^(.*)\/tags\/([^/]+)(?:\/(.*))?$/);
  if (tag) {
    candidates.push({
      branchRootUrl: tag[1],
      branch: tag[2],
      branchKind: 'tag',
      subPath: tag[3] ?? '',
    });
  }

  if (candidates.length === 0) return null;

  // Most specific = deepest branch-root (longest prefix) for nested layouts.
  return candidates.sort((a, b) => b.branchRootUrl.length - a.branchRootUrl.length)[0];
}

/**
 * Given the current branch context and a target branch URL, return the URL that
 * preserves the current sub-path on the target branch — used when switching so
 * you stay on the same file/folder across branches.
 */
export function mapSubPathToBranch(branchUrl: string, subPath: string): string {
  const base = stripTrailingSlash(branchUrl);
  return subPath ? `${base}/${subPath}` : base;
}
