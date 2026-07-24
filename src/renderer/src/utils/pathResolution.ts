/**
 * Path Resolution Utility
 * Resolves remote SVN URLs to local filesystem paths using working copy context.
 * Pure calculation module - no network calls.
 */

function normalizeToForwardSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeToPlatformPath(path: string): string {
  const normalized = normalizeToForwardSlash(path);
  const isWindows =
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('//') ||
    (typeof process !== 'undefined' && process.platform === 'win32');
  return isWindows ? normalized.replace(/\//g, '\\') : normalized;
}

interface ParsedSvnUrl {
  authority: string;
  segments: string[];
}

function parseSvnUrl(value: string): ParsedSvnUrl | null {
  try {
    const url = new URL(value);
    const authority = `${url.protocol.toLowerCase()}//${url.username ? `${url.username}@` : ''}${url.host.toLowerCase()}`;
    const segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => segment === '.' || segment === '..' || /[/\\]/.test(segment))) {
      return null;
    }
    return { authority, segments };
  } catch {
    return null;
  }
}

function hasUrlSegmentPrefix(candidate: ParsedSvnUrl, prefix: ParsedSvnUrl): boolean {
  return (
    candidate.authority === prefix.authority &&
    prefix.segments.every((segment, index) => candidate.segments[index] === segment)
  );
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
  repositoryRoot: string,
  workingCopyUrl: string = repositoryRoot
): string | null {
  if (!remoteUrl || !workingCopyRoot || !repositoryRoot || !workingCopyUrl) {
    return null;
  }

  const parsedUrl = parseSvnUrl(remoteUrl);
  const parsedRepoRoot = parseSvnUrl(repositoryRoot);
  const parsedWorkingCopyUrl = parseSvnUrl(workingCopyUrl);
  if (!parsedUrl || !parsedRepoRoot || !parsedWorkingCopyUrl) return null;
  if (
    !hasUrlSegmentPrefix(parsedUrl, parsedRepoRoot) ||
    !hasUrlSegmentPrefix(parsedWorkingCopyUrl, parsedRepoRoot) ||
    !hasUrlSegmentPrefix(parsedUrl, parsedWorkingCopyUrl)
  ) {
    return null;
  }

  const normalizedWorkingCopyRoot = normalizeToForwardSlash(workingCopyRoot).replace(/\/+$/, '');
  const relativePath = parsedUrl.segments
    .slice(parsedWorkingCopyUrl.segments.length)
    .join('/');
  const localPath = relativePath
    ? `${normalizedWorkingCopyRoot}/${relativePath}`
    : normalizedWorkingCopyRoot;

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

  const parsedUrl = parseSvnUrl(remoteUrl);
  const parsedRepoRoot = parseSvnUrl(repositoryRoot);
  return !!parsedUrl && !!parsedRepoRoot && hasUrlSegmentPrefix(parsedUrl, parsedRepoRoot);
}
