/**
 * Path Resolution Utility
 * Resolves remote SVN URLs to local filesystem paths using working copy context.
 * Pure calculation module - no network calls.
 */

function normalizeToForwardSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeToPlatformPath(path: string): string {
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
  const normalized = normalizeToForwardSlash(path);
  return isWindows ? normalized.replace(/\//g, '\\') : normalized;
}

/**
 * Gets the relative path from a base path to a full path.
 * @example
 * getRelativePath('/repo/trunk/src/file.ts', '/repo/trunk') // 'src/file.ts'
 * getRelativePath('C:\\Project\\src\\file.ts', 'C:\\Project') // 'src\\file.ts'
 */
export function getRelativePath(fullPath: string, basePath: string): string {
  if (!fullPath || !basePath) {
    return '';
  }

  const normalizedFull = normalizeToForwardSlash(fullPath).replace(/\/+$/, '');
  const normalizedBase = normalizeToForwardSlash(basePath).replace(/\/+$/, '');

  if (normalizedFull === normalizedBase) {
    return '';
  }

  const baseWithSlash = normalizedBase + '/';

  if (normalizedFull.startsWith(baseWithSlash)) {
    return normalizedFull.slice(baseWithSlash.length);
  }

  if (normalizedFull.startsWith(normalizedBase) && normalizedFull.length > normalizedBase.length) {
    const remaining = normalizedFull.slice(normalizedBase.length);
    return remaining.startsWith('/') ? remaining.slice(1) : remaining;
  }

  return '';
}

/**
 * Resolves a remote SVN URL to a local filesystem path.
 * Returns null if the URL is external to the repository.
 * @example
 * resolveRemoteUrlToLocalPath(
 *   'https://svn.example.com/repo/trunk/src/file.ts',
 *   '/Users/user/project',
 *   'https://svn.example.com/repo'
 * ) // '/Users/user/project/trunk/src/file.ts'
 */
export function resolveRemoteUrlToLocalPath(
  remoteUrl: string,
  workingCopyRoot: string,
  repositoryRoot: string
): string | null {
  if (!remoteUrl || !workingCopyRoot || !repositoryRoot) {
    return null;
  }

  const normalizedUrl = normalizeToForwardSlash(remoteUrl);
  const normalizedRepoRoot = normalizeToForwardSlash(repositoryRoot).replace(/\/+$/, '');
  const normalizedWorkingCopyRoot = normalizeToForwardSlash(workingCopyRoot).replace(/\/+$/, '');

  const repoRootWithSlash = normalizedRepoRoot + '/';

  if (normalizedUrl === normalizedRepoRoot) {
    return normalizeToPlatformPath(normalizedWorkingCopyRoot);
  }

  if (!normalizedUrl.startsWith(repoRootWithSlash)) {
    return null;
  }

  const relativePath = normalizedUrl.slice(repoRootWithSlash.length);
  const localPath = normalizedWorkingCopyRoot + '/' + relativePath;

  return normalizeToPlatformPath(localPath);
}

/**
 * Checks if a remote URL belongs to the given repository.
 * Useful for detecting externals.
 */
export function isUrlInRepository(remoteUrl: string, repositoryRoot: string): boolean {
  if (!remoteUrl || !repositoryRoot) {
    return false;
  }

  const normalizedUrl = normalizeToForwardSlash(remoteUrl).replace(/\/+$/, '');
  const normalizedRepoRoot = normalizeToForwardSlash(repositoryRoot).replace(/\/+$/, '');

  if (normalizedUrl === normalizedRepoRoot) {
    return true;
  }

  const repoRootWithSlash = normalizedRepoRoot + '/';

  return normalizedUrl.startsWith(repoRootWithSlash);
}
