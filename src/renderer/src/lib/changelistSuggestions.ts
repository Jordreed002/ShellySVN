/**
 * Changelist auto-grouping suggestions (#65).
 *
 * Pure path heuristics — no IPC, no React. Given the changed paths of a
 * working copy, produce suggested changelists by clustering files along three
 * axes:
 *
 * 1. File-type clusters — tests, docs and config files are pulled out of the
 *    source pool first (a "tests" changelist is almost always what you want).
 * 2. Directory clusters — files that live in the same directory belong
 *    together; when every file sits in a different directory, the heuristic
 *    walks up one segment at a time and merges groups that collide on a
 *    shared parent directory (the "common prefix" family).
 * 3. Confidence — how tight the cluster is: exact directory beats parent
 *    directory beats grandparent, and type-only clusters rank below any
 *    directory cluster.
 *
 * The output is advisory only: callers must never apply a suggestion without
 * an explicit user action (accept / dismiss / adjust).
 */

/** How a suggestion was derived; surfaced in the UI as the rationale line. */
export type ChangelistSuggestionReason = 'same-directory' | 'common-prefix' | 'file-type';

export interface ChangelistSuggestion {
  /** Stable id derived from name + members (safe as a React key). */
  id: string;
  /** Suggested changelist name, e.g. `src: core` or `tests`. */
  name: string;
  /** 0..1 — how strongly the heuristic believes in the grouping. */
  confidence: number;
  reason: ChangelistSuggestionReason;
  /** Absolute paths of the files that make up the suggestion. */
  members: string[];
  /** Human-readable one-liner explaining the grouping. */
  description: string;
}

interface FileBucket {
  key: 'tests' | 'docs' | 'config' | 'source';
  label: string;
}

const TEST_DIRECTORY_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const DOC_DIRECTORY_SEGMENTS = new Set(['doc', 'docs', 'documentation']);
const CONFIG_DIRECTORY_SEGMENTS = new Set(['.github', '.vscode', '.idea', 'config', 'ci']);

const TEST_BASENAME_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|[-_.])(test|spec)\.[cm]?[jt]sx?$/i,
  /^test_[^/]+\.py$/i,
  /_test\.(go|py)$/i,
  /Tests?\.cs$/i,
];

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.adoc', '.asciidoc', '.txt']);
const CONFIG_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'jsconfig.json',
  'composer.json',
  'cargo.toml',
  'makefile',
  'dockerfile',
  'vite.config.ts',
]);
const CONFIG_BASENAME_PATTERNS = [
  /^tsconfig\..+\.json$/i,
  /\.config\.[cm]?[jt]s$/i,
  /\.conf\.ini$/i,
];
const CONFIG_EXTENSIONS = new Set(['.yml', '.yaml', '.toml', '.ini', '.editorconfig', '.gitignore', '.gitattributes']);

/** Normalize separators so Windows and POSIX paths cluster identically. */
function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf('/');
  if (index === -1) return { dir: '', base: path };
  return { dir: path.slice(0, index), base: path.slice(index + 1) };
}

function extensionOf(base: string): string {
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

function classifyFile(path: string): FileBucket {
  const { dir, base } = splitPath(path);
  const segments = dir.split('/').filter(Boolean);
  const lowerBase = base.toLowerCase();
  const extension = extensionOf(base);

  if (segments.some((segment) => TEST_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) {
    return { key: 'tests', label: 'tests' };
  }
  if (TEST_BASENAME_PATTERNS.some((pattern) => pattern.test(base))) {
    return { key: 'tests', label: 'tests' };
  }
  if (segments.some((segment) => DOC_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) {
    return { key: 'docs', label: 'docs' };
  }
  if (DOC_EXTENSIONS.has(extension)) return { key: 'docs', label: 'docs' };
  if (CONFIG_BASENAMES.has(lowerBase) || CONFIG_BASENAMES.has(`${lowerBase}.json`)) {
    return { key: 'config', label: 'config' };
  }
  if (CONFIG_BASENAME_PATTERNS.some((pattern) => pattern.test(base))) {
    return { key: 'config', label: 'config' };
  }
  if (segments.some((segment) => CONFIG_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) {
    return { key: 'config', label: 'config' };
  }
  if (segments.length <= 1 && CONFIG_EXTENSIONS.has(extension)) {
    return { key: 'config', label: 'config' };
  }
  return { key: 'source', label: 'source' };
}

/**
 * Cluster files of one bucket by directory.
 *
 * Exact directories with more than one file are immediate clusters (level 0).
 * Remaining singletons walk up one directory segment at a time; whenever two
 * of them collide on a shared parent directory they merge into a common-prefix
 * cluster whose level records how far up the merge happened. Lone strays that
 * never collide are reported as `unclustered`.
 */
interface DirectoryCluster {
  directory: string;
  /** Trailing directory segments dropped to form the cluster. */
  level: number;
  files: string[];
}

interface DirectoryClusterResult {
  clusters: DirectoryCluster[];
  unclustered: string[];
}

function clusterByDirectory(paths: string[]): DirectoryClusterResult {
  const byDirectory = new Map<string, string[]>();
  for (const path of paths) {
    const { dir } = splitPath(path);
    const existing = byDirectory.get(dir);
    if (existing) existing.push(path);
    else byDirectory.set(dir, [path]);
  }

  let clusters: DirectoryCluster[] = [];
  let pending = Array.from(byDirectory.entries())
    .map(([directory, files]) => ({ directory, files }))
    .filter((group) => {
      if (group.files.length > 1) {
        clusters.push({ directory: group.directory, level: 0, files: group.files });
        return false;
      }
      return true;
    })
    .map((group) => ({ directory: group.directory, files: group.files }));

  let level = 0;
  // Merging is capped at the grandparent directory: files whose only shared
  // ancestor is the working-copy root are unrelated, not a cluster.
  const maxPrefixLevel = 2;
  while (level < maxPrefixLevel && pending.length > 1 && pending.some((group) => group.directory !== '')) {
    level += 1;
    const merged = new Map<string, { directory: string; files: string[] }>();
    for (const group of pending) {
      const { dir } = splitPath(group.directory);
      const existing = merged.get(dir);
      if (existing) existing.files.push(...group.files);
      else merged.set(dir, { directory: dir, files: [...group.files] });
    }
    const next: typeof pending = [];
    for (const group of merged.values()) {
      if (group.files.length > 1) {
        clusters.push({ directory: group.directory, level, files: group.files });
      } else {
        next.push(group);
      }
    }
    pending = next;
  }

  clusters = clusters.toSorted((left, right) => left.directory.localeCompare(right.directory));
  return { clusters, unclustered: pending.flatMap((group) => group.files) };
}

/** `src/core` → `src: core`; `lib` → `lib`. */
function clusterName(directory: string, rootPath: string | undefined): string {
  let relativeDir = directory;
  if (rootPath) {
    const root = normalizePath(rootPath).replace(/\/+$/, '');
    if (directory === root) relativeDir = '';
    else if (directory.startsWith(`${root}/`)) relativeDir = directory.slice(root.length + 1);
  }
  const segments = relativeDir.split('/').filter(Boolean);
  if (segments.length === 0) return 'root';
  if (segments.length === 1) return segments[0] || 'root';
  return `${segments[segments.length - 2]}: ${segments[segments.length - 1]}`;
}

function suggestionId(name: string, members: string[]): string {
  // Anchor on the smallest member, not members[0]: the id doubles as a React
  // key and must not change when the caller feeds the same paths in a
  // different order (members are sorted only after ids are assigned).
  const anchor = members.reduce<string | null>(
    (min, path) => (min === null || path < min ? path : min),
    null
  );
  return `${name}::${members.length}::${anchor ?? ''}`;
}

const CONFIDENCE_BY_LEVEL: Record<number, number> = { 0: 0.9, 1: 0.75, 2: 0.6 };
const CONFIDENCE_TYPE_SINGLETON = 0.4;

export interface SuggestChangelistsOptions {
  /**
   * Working-copy root. Stripped from cluster directories before deriving
   * suggestion names so `/wc/src/core` yields `src: core`, not `wc: src`.
   */
  rootPath?: string;
}

/**
 * Produce changelist suggestions for the given changed paths.
 *
 * - Fewer than two distinct paths → no suggestions (nothing to group).
 * - tests / docs / config files become one type-level suggestion per bucket
 *   (splitting "tests" by directory is noise at this level).
 * - Source files cluster by directory: exact directory first, then the
 *   nearest common prefix when every file sits in a different directory.
 * - Source files no heuristic captures end up in a weak `misc` suggestion.
 */
export function suggestChangelists(
  paths: readonly string[],
  options: SuggestChangelistsOptions = {}
): ChangelistSuggestion[] {
  const unique = Array.from(new Set(paths.map(normalizePath).filter(Boolean)));
  if (unique.length < 2) return [];

  const buckets = new Map<string, string[]>();
  for (const path of unique) {
    const bucket = classifyFile(path);
    const existing = buckets.get(bucket.key);
    if (existing) existing.push(path);
    else buckets.set(bucket.key, [path]);
  }

  const suggestions: ChangelistSuggestion[] = [];

  // Type buckets: tests / docs / config — always one suggestion per bucket.
  for (const key of ['tests', 'docs', 'config'] as const) {
    const files = buckets.get(key);
    if (!files || files.length === 0) continue;
    suggestions.push({
      id: suggestionId(key, files),
      name: key,
      confidence: files.length > 1 ? 0.55 : CONFIDENCE_TYPE_SINGLETON,
      reason: 'file-type',
      members: files,
      description:
        files.length > 1
          ? `${files.length} ${key} files`
          : `Single ${key.replace(/s$/, '')} file`,
    });
  }

  // Source bucket: directory clusters with prefix walk-up.
  const sourceFiles = buckets.get('source') ?? [];
  const { clusters: sourceClusters } = clusterByDirectory(sourceFiles);

  for (const cluster of sourceClusters) {
    const name = clusterName(cluster.directory, options.rootPath);
    const level = Math.min(cluster.level, 2);
    suggestions.push({
      id: suggestionId(name, cluster.files),
      name,
      confidence: CONFIDENCE_BY_LEVEL[level] ?? 0.55,
      reason: cluster.level === 0 ? 'same-directory' : 'common-prefix',
      members: cluster.files,
      description:
        cluster.level === 0
          ? `${cluster.files.length} files in ${cluster.directory || 'the root directory'}`
          : `${cluster.files.length} files under ${cluster.directory || 'the root directory'}`,
    });
  }

  // Highest confidence first, then most members, then name for determinism.
  // Members are sorted so suggestions are stable across input re-orderings.
  return suggestions
    .map((suggestion) => ({
      ...suggestion,
      members: suggestion.members.toSorted((left, right) => left.localeCompare(right)),
    }))
    .toSorted(
      (left, right) =>
        right.confidence - left.confidence ||
        right.members.length - left.members.length ||
        left.name.localeCompare(right.name)
    );
}

/** Map a suggestion's confidence to a short label for UI badges. */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  if (confidence >= 0.45) return 'low';
  return 'weak';
}
