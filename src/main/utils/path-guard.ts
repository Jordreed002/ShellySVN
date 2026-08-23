/**
 * Filesystem path containment guard (IPC security boundary).
 *
 * SECURITY: every path that crosses the renderer -> main boundary and reaches
 * a filesystem operation must pass through this module (directly, or via the
 * approved-roots registry in utils/approved-paths.ts). It centralizes:
 *
 * 1. Shape sanitization — null bytes, Windows device names (CON, NUL, COM1…),
 *    UNC / Win32 namespace prefixes (`\\server`, `\\?\`, `//./`), and
 *    drive-relative paths (`C:file`), all of which can bypass naive
 *    normalization checks.
 * 2. Lexical containment — `path.resolve()` + `path.relative()` based (never
 *    string prefix matching), so `../` traversal and absolute-path overrides
 *    are rejected.
 * 3. Symlink-escape auditing — the target is canonicalized with realpath for
 *    its longest existing prefix, and every existing ancestor is checked with
 *    lstat, so a symlink planted inside an approved root (`safe/link -> /etc`)
 *    cannot redirect access outside it.
 *
 * Approved-root model:
 * - Renderer-facing fs IPC is confined to the approved-roots registry
 *   (native-picker selections plus the application home; see
 *   utils/approved-paths.ts) and app-designated temp directories.
 * - Service-side extraction (portable shelves, patch output) confines writes
 *   to a known destination root via `assertWithinRoot`.
 *
 * Known limitations (accepted and documented):
 * - TOCTOU: a symlink created between the audit and the actual filesystem
 *   call can still redirect. This guard raises the bar; it is not a sandbox.
 * - When realpath/lstat cannot resolve a path (permissions, symlink loops),
 *   containment is decided on the deepest canonical ancestor, mirroring the
 *   approved-paths behavior.
 */

import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, win32 } from 'path';

export type PathGuardReason =
  | 'invalid-type'
  | 'invalid-character'
  | 'invalid-segment'
  | 'absolute-entry'
  | 'escapes-root'
  | 'symlink-escape';

export class PathGuardError extends Error {
  constructor(
    message: string,
    public readonly reason: PathGuardReason
  ) {
    super(message);
    this.name = 'PathGuardError';
  }
}

const NULL_BYTE = /\0/;
// `\\?\C:\…`, `\\.\pipe\…`, `//?/C:/…`, `//./…` — Win32 namespace prefixes
// that bypass ordinary path normalization.
const WIN32_NAMESPACE_PREFIX = /^(?:\\\\|\/\/)[?.]/;
// `\\server\share\…` or `//server/…` — UNC server paths and the POSIX
// "implementation-defined" double-leading-slash form.
const UNC_OR_DOUBLE_SLASH_PREFIX = /^(?:\\\\|\/\/)/;
// `C:file` — drive-relative (anchored to the drive's current directory).
const DRIVE_RELATIVE_PREFIX = /^[a-zA-Z]:($|[^\\/])/;
// Reserved Windows device names; checked on every OS because portable
// artifacts (shelves, patches) may be produced on one OS and consumed on another.
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function pathSegments(path: string): string[] {
  return path.split(/[/\\]+/).filter((segment) => segment.length > 0);
}

function realpathBestEffort(path: string): string {
  const native = (realpathSync as unknown as { native?: (p: string) => string }).native;
  return typeof native === 'function' ? native.call(realpathSync, path) : realpathSync(path);
}

/**
 * Canonicalize the deepest part of `path` that exists on disk.
 *
 * realpath is applied to the whole path first; on failure (missing tail,
 * EACCES, ELOOP, …) the walk retries on the parent directory. The result is
 * the fully resolved real path of the longest existing prefix.
 */
export function realpathOfLongestExistingPrefix(path: string): string {
  let current = resolve(path);
  for (;;) {
    try {
      return realpathBestEffort(current);
    } catch {
      // Keep climbing towards the filesystem root.
    }
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function isContained(root: string, candidate: string): boolean {
  const rel =
    process.platform === 'win32'
      ? relative(root.toLowerCase(), candidate.toLowerCase())
      : relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Reject null bytes, Windows device names, UNC / Win32 namespace prefixes and
 * drive-relative paths. Applied to every renderer-supplied path before any
 * containment logic runs.
 */
export function assertSanitizedPath(path: string, operation = 'Path access'): string {
  if (typeof path !== 'string') {
    throw new PathGuardError(`${operation} failed: path must be a string.`, 'invalid-type');
  }
  if (!path.trim()) {
    throw new PathGuardError(`${operation} failed: path must not be empty.`, 'invalid-character');
  }
  if (NULL_BYTE.test(path)) {
    throw new PathGuardError(`${operation} failed: path contains a null byte.`, 'invalid-character');
  }
  if (WIN32_NAMESPACE_PREFIX.test(path) || UNC_OR_DOUBLE_SLASH_PREFIX.test(path)) {
    throw new PathGuardError(
      `${operation} failed: UNC or Win32 namespace paths are not accepted.`,
      'invalid-character'
    );
  }
  if (DRIVE_RELATIVE_PREFIX.test(path)) {
    throw new PathGuardError(
      `${operation} failed: drive-relative paths are not accepted.`,
      'invalid-character'
    );
  }
  for (const segment of pathSegments(path)) {
    if (WINDOWS_DEVICE_SEGMENT.test(segment)) {
      throw new PathGuardError(
        `${operation} failed: path segment "${segment}" is a reserved Windows device name.`,
        'invalid-segment'
      );
    }
  }
  return path;
}

/**
 * Validate a relative entry name coming from archive-like content (portable
 * shelf metadata, patch payloads): must be relative, free of `..` segments
 * (either separator style), null bytes, absolute prefixes, UNC tricks and
 * reserved device names. Returns the normalized relative path.
 */
export function assertSafeEntryRelativePath(entryPath: string, operation = 'Entry path'): string {
  assertSanitizedPath(entryPath, operation);
  if (isAbsolute(entryPath) || win32.isAbsolute(entryPath)) {
    throw new PathGuardError(
      `${operation} "${entryPath}" must be relative.`,
      'absolute-entry'
    );
  }
  for (const segment of pathSegments(entryPath)) {
    if (segment === '..') {
      throw new PathGuardError(
        `${operation} "${entryPath}" must not contain ".." segments.`,
        'escapes-root'
      );
    }
  }
  return normalize(entryPath);
}

/**
 * Find a symlink under `canonicalRoot` on the path to `resolvedTarget` whose
 * realpath lands outside the root. Returns the offending symlink path, or
 * null when no escaping symlink is involved.
 */
function findEscapingSymlink(canonicalRoot: string, resolvedTarget: string): string | null {
  const rel = relative(canonicalRoot, resolvedTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    // Lexical escape (or the root itself) — not a symlink concern.
    return null;
  }

  let current = canonicalRoot;
  for (const segment of rel.split(/[/\\]+/).filter(Boolean)) {
    const candidate = join(current, segment);
    let stats: { isSymbolicLink(): boolean } | null = null;
    try {
      stats = lstatSync(candidate);
    } catch {
      stats = null;
    }
    if (!stats) break; // Nothing below this point exists on disk yet.
    if (stats.isSymbolicLink()) {
      const real = realpathOfLongestExistingPrefix(candidate);
      if (!isContained(canonicalRoot, real)) return candidate;
      current = real;
    } else {
      current = candidate;
    }
  }
  return null;
}

/**
 * Assert that `targetPath` (absolute, or relative to `root`) stays inside
 * `root` under real path semantics: the resolved target, canonicalized
 * through every existing ancestor, must remain contained. Returns the target
 * re-anchored under the canonical root (absolute targets whose lexical
 * prefix differs from the canonical root, e.g. `/tmp/...` on macOS, keep
 * their lexical form — both forms address the same location).
 */
export function assertWithinRoot(
  root: string,
  targetPath: string,
  operation = 'Path access'
): string {
  assertSanitizedPath(targetPath, operation);
  assertSanitizedPath(root, `${operation} root`);

  const lexicalRoot = resolve(root);
  const canonicalRoot = realpathOfLongestExistingPrefix(lexicalRoot);
  const anchoredTarget = resolve(lexicalRoot, targetPath);
  const targetRelative = relative(lexicalRoot, anchoredTarget);
  const isAnchored =
    targetRelative === '' ||
    (!targetRelative.startsWith('..') && !isAbsolute(targetRelative));
  const resolvedTarget = isAnchored ? resolve(canonicalRoot, targetRelative) : anchoredTarget;
  const canonicalTarget = realpathOfLongestExistingPrefix(resolvedTarget);

  if (!isContained(canonicalRoot, canonicalTarget)) {
    const escapingSymlink = isAnchored
      ? findEscapingSymlink(canonicalRoot, resolvedTarget)
      : null;
    if (escapingSymlink) {
      throw new PathGuardError(
        `${operation} failed: "${escapingSymlink}" is a symlink that redirects outside the approved root.`,
        'symlink-escape'
      );
    }
    throw new PathGuardError(
      `${operation} failed: "${targetPath}" resolves outside the approved root "${canonicalRoot}".`,
      'escapes-root'
    );
  }

  return resolvedTarget;
}

/**
 * Assert that the real (fully canonicalized) location of `targetPath`
 * satisfies `isAllowed`. Used to compose the guard with the approved-roots
 * registry: a path that is lexically inside an approved root but reaches an
 * unapproved location through a symlink is rejected. Returns the resolved
 * (lexical) target path.
 */
export function assertRealpathSatisfies(
  targetPath: string,
  isAllowed: (realPath: string) => boolean,
  operation: string
): string {
  const resolved = resolve(targetPath);
  const real = realpathOfLongestExistingPrefix(resolved);
  if (!isAllowed(real)) {
    throw new PathGuardError(
      `${operation} failed: "${resolved}" resolves through symlinks to "${real}", which is outside the approved roots.`,
      'symlink-escape'
    );
  }
  return resolved;
}
