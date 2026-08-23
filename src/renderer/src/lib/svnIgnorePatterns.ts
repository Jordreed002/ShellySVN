/**
 * svn:ignore / svn:global-ignores pattern handling — pure functions only.
 *
 * Semantics mirrored from Subversion (`svn_wc`'s `match_ignore_pattern`,
 * which calls APR's `apr_fnmatch` with `APR_FNM_PERIOD`):
 *
 * - Matching is **case-sensitive on every platform** (TortoiseSVN documents
 *   `[Tt][Ee]...` character pairing as the workaround on Windows/macOS).
 * - Patterns match *names* (file or directory basename), never paths.
 * - A leading `.` in the name must be matched by a literal `.` in the
 *   pattern: `*` does **not** match `.DS_Store` (APR_FNM_PERIOD).
 * - Supported metacharacters: `*`, `?`, `[...]` classes (with `!`/`^`
 *   negation and ranges) and `\` escapes. There is no `**` globstar and no
 *   `!` negation prefix (those are Git-isms).
 */

export type IgnoreLintSeverity = 'error' | 'warning' | 'info';

export type IgnoreLintCode =
  | 'duplicate'
  | 'case-variant'
  | 'path-separator'
  | 'trailing-slash'
  | 'negation'
  | 'globstar'
  | 'redundant'
  | 'unterminated-class'
  | 'bad-escape'
  | 'dot-segment'
  | 'broad';

export interface IgnoreLintIssue {
  /** 1-based index of the offending line in the pattern list. */
  line: number;
  pattern: string;
  severity: IgnoreLintSeverity;
  code: IgnoreLintCode;
  message: string;
  /** Suggested replacement pattern, when a mechanical fix exists. */
  fix?: string;
}

/** Split a property value into its pattern lines (trimmed, blanks dropped). */
export function parseIgnorePatterns(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Serialize patterns back to a property value (one per line). */
export function formatIgnorePatterns(patterns: string[]): string {
  return patterns.join('\n');
}

const METACHARS = new Set(['*', '?', '[', '\\']);

/** Whether the pattern contains any glob metacharacter. */
export function hasGlobMetacharacters(pattern: string): boolean {
  return [...pattern].some((char) => METACHARS.has(char));
}

/**
 * Glob match with APR_FNM_PERIOD semantics (see module doc). An
 * unterminated `[` class falls back to matching a literal `[`, mirroring
 * the lenient reading most clients apply — the linter flags it anyway.
 */
export function matchesIgnorePattern(name: string, pattern: string): boolean {
  if (pattern.length === 0) return false;
  // APR_FNM_PERIOD: a leading dot must be matched by a literal dot.
  if (name.startsWith('.') && pattern[0] !== '.') return false;
  return globMatch(pattern, 0, name, 0);
}

function globMatch(pattern: string, pi: number, name: string, ni: number): boolean {
  while (pi < pattern.length) {
    const pc = pattern[pi];
    if (pc === '*') {
      while (pattern[pi] === '*') pi++;
      if (pi >= pattern.length) return true; // trailing star consumes the rest
      for (let k = ni; k <= name.length; k++) {
        if (globMatch(pattern, pi, name, k)) return true;
      }
      return false;
    }
    if (ni >= name.length) return false;
    if (pc === '?') {
      pi++;
      ni++;
      continue;
    }
    if (pc === '[') {
      const end = findClassEnd(pattern, pi);
      if (end === -1) {
        // Unterminated class: treat '[' literally (linter flags it).
        if (name[ni] !== '[') return false;
        pi++;
        ni++;
        continue;
      }
      if (!matchCharClass(pattern, pi + 1, end, name[ni])) return false;
      pi = end + 1;
      ni++;
      continue;
    }
    if (pc === '\\' && pi + 1 < pattern.length) {
      if (name[ni] !== pattern[pi + 1]) return false;
      pi += 2;
      ni++;
      continue;
    }
    if (pc !== name[ni]) return false;
    pi++;
    ni++;
  }
  return ni === name.length;
}

/** Index of the closing `]` for the class starting at `openIndex`, or -1. */
function findClassEnd(pattern: string, openIndex: number): number {
  for (let i = openIndex + 1; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++; // skip escaped character inside the class
      continue;
    }
    if (pattern[i] === ']') return i;
  }
  return -1;
}

/** Match one character against the `[...]` class spanning [start, end). */
function matchCharClass(pattern: string, start: number, end: number, char: string): boolean {
  let i = start;
  let negate = false;
  if (i < end && (pattern[i] === '!' || pattern[i] === '^')) {
    negate = true;
    i++;
  }
  let matched = false;
  for (; i < end; i++) {
    let lo = pattern[i];
    if (lo === '\\' && i + 1 < end) {
      i++;
      lo = pattern[i];
    }
    if (i + 2 < end && pattern[i + 1] === '-' && pattern[i + 2] !== ']') {
      let hi = pattern[i + 2];
      if (hi === '\\' && i + 3 < end) {
        i++;
        hi = pattern[i + 2];
      }
      if (char >= lo && char <= hi) matched = true;
      i += 2;
      continue;
    }
    if (char === lo) matched = true;
  }
  return negate ? !matched : matched;
}

/**
 * Lint a pattern list. `errors` must block applying the property (they mean
 * a pattern can never match, or the value would change unrelated lines);
 * warnings/infos are advisory.
 */
export function lintIgnorePatterns(patterns: string[]): IgnoreLintIssue[] {
  const issues: IgnoreLintIssue[] = [];
  const seen = new Map<string, number>(); // exact pattern -> first 1-based line
  const seenInsensitive = new Map<string, number>();

  patterns.forEach((pattern, index) => {
    const line = index + 1;

    const firstExact = seen.get(pattern);
    if (firstExact !== undefined) {
      issues.push({
        line,
        pattern,
        severity: 'error',
        code: 'duplicate',
        message: `Duplicate pattern — already on line ${firstExact}. Subversion keeps both, but the second one is dead weight.`,
      });
    } else {
      seen.set(pattern, line);
    }

    const lower = pattern.toLowerCase();
    const firstVariant = seenInsensitive.get(lower);
    if (firstVariant === undefined) {
      seenInsensitive.set(lower, line);
    } else if (firstExact === undefined) {
      issues.push({
        line,
        pattern,
        severity: 'info',
        code: 'case-variant',
        message: `Differs from line ${firstVariant} only by case. Ignore matching is case-sensitive even on case-insensitive filesystems (macOS, Windows); pair characters as in [Bb][Uu][Ii][Ll][Dd] to cover both spellings.`,
      });
    }

    if (pattern.endsWith('/')) {
      issues.push({
        line,
        pattern,
        severity: 'warning',
        code: 'trailing-slash',
        message:
          'Trailing "/" is a Git habit. Subversion patterns never contain a separator — use the bare name (svn:ignore matches directories and files alike).',
        fix: pattern.replace(/\/+$/, ''),
      });
    } else if (pattern.includes('\\') || pattern.includes('/')) {
      issues.push({
        line,
        pattern,
        severity: 'error',
        code: 'path-separator',
        message:
          'Path separator in pattern: svn:ignore patterns match file names only, so a pattern containing "/" or "\\" can never match. Ignore the file in the directory that contains it instead.',
        fix: pattern.split(/[\\/]/).pop() ?? pattern,
      });
    }

    if (pattern.startsWith('!')) {
      issues.push({
        line,
        pattern,
        severity: 'warning',
        code: 'negation',
        message:
          'Subversion has no negation patterns (that is Git syntax). "!" is matched literally, so this pattern almost certainly does nothing useful.',
      });
    }

    if (pattern.includes('**')) {
      issues.push({
        line,
        pattern,
        severity: 'warning',
        code: 'globstar',
        message:
          '"**" is a Git globstar. Subversion treats it as "*" followed by "*", which still matches everything — one "*" is enough.',
        fix: pattern.replace(/\*{2,}/g, '*'),
      });
    }

    if (pattern.includes('[') && findClassEnd(pattern, pattern.indexOf('[')) === -1) {
      issues.push({
        line,
        pattern,
        severity: 'error',
        code: 'unterminated-class',
        message: 'Unterminated "[" character class. Close it with "]" or escape the bracket as "\\[".',
        fix: pattern.replace(/\[$/, '[]'),
      });
    }

    if (pattern.endsWith('\\') && !pattern.endsWith('\\\\')) {
      issues.push({
        line,
        pattern,
        severity: 'warning',
        code: 'bad-escape',
        message: 'Pattern ends with a lone backslash; escape it as "\\\\" to match a literal backslash.',
      });
    }

    if (pattern === '.' || pattern === '..') {
      issues.push({
        line,
        pattern,
        severity: 'warning',
        code: 'dot-segment',
        message: 'Dot segments refer to directories themselves and never match an unversioned entry.',
      });
    }

    if (pattern === '*') {
      issues.push({
        line,
        pattern,
        severity: 'info',
        code: 'broad',
        message:
          '"*" hides every unversioned entry in this directory — including new files you may actually want to add (dotfiles are still shown, thanks to the leading-period rule).',
      });
    }

    if (firstExact === undefined && !hasGlobMetacharacters(pattern)) {
      const coveredBy = patterns
        .slice(0, index)
        .find((other) => other !== pattern && matchesIgnorePattern(pattern, other));
      if (coveredBy !== undefined) {
        issues.push({
          line,
          pattern,
          severity: 'warning',
          code: 'redundant',
          message: `Already covered by "${coveredBy}" — Subversion checks every pattern, so this line is redundant.`,
        });
      }
    }
  });

  return issues;
}

export function hasIgnoreLintErrors(issues: IgnoreLintIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export interface UnversionedCandidate {
  name: string;
  isDirectory: boolean;
}

export interface MatchedUnversionedFile extends UnversionedCandidate {
  matchedBy: string;
}

/** Which of the currently-known unversioned entries each pattern list covers. */
export function matchUnversionedEntries(
  patterns: string[],
  candidates: UnversionedCandidate[]
): { matched: MatchedUnversionedFile[]; unmatched: UnversionedCandidate[] } {
  const matched: MatchedUnversionedFile[] = [];
  const unmatched: UnversionedCandidate[] = [];
  for (const candidate of candidates) {
    const matchedBy = patterns.find((pattern) => matchesIgnorePattern(candidate.name, pattern));
    if (matchedBy === undefined) unmatched.push(candidate);
    else matched.push({ ...candidate, matchedBy });
  }
  return { matched, unmatched };
}

export interface EffectiveIgnoreInput {
  /** svn:ignore set on this directory (its own value; inherited svn:ignore does NOT apply). */
  explicitIgnore?: string | null;
  /** svn:global-ignores set on this directory, if any. */
  explicitGlobalIgnores?: string | null;
  /** Nearest inherited svn:global-ignores value from an ancestor, if any. */
  inheritedGlobalIgnores?: string | null;
  /** Where the inherited value comes from, for display. */
  inheritedGlobalFrom?: string;
}

export interface EffectiveIgnoreResult {
  /** Patterns svn will actually apply to this directory's entries. */
  effective: string[];
  /** The svn:global-ignores patterns that apply here and where they came from. */
  effectiveGlobal: { patterns: string[]; source: 'explicit' | 'inherited' | 'none'; from?: string };
}

/**
 * Effective ignore set for a directory:
 *
 * - own `svn:ignore` patterns, plus
 * - the *nearest* `svn:global-ignores` at this path or above — inherited
 *   values replace, not merge (SVN 1.8+ inherited-properties behavior).
 *
 * Inherited `svn:ignore` deliberately contributes nothing: `svn:ignore`
 * only ever applies to the directory it is set on; propagation is what
 * `svn:global-ignores` exists for. The runtime `global-ignores` config
 * also applies but is not visible through property APIs.
 */
export function computeEffectiveIgnore(input: EffectiveIgnoreInput): EffectiveIgnoreResult {
  let effectiveGlobal: EffectiveIgnoreResult['effectiveGlobal'] = { patterns: [], source: 'none' };
  if (input.explicitGlobalIgnores != null && input.explicitGlobalIgnores.trim() !== '') {
    effectiveGlobal = {
      patterns: parseIgnorePatterns(input.explicitGlobalIgnores),
      source: 'explicit',
    };
  } else if (input.inheritedGlobalIgnores != null && input.inheritedGlobalIgnores.trim() !== '') {
    effectiveGlobal = {
      patterns: parseIgnorePatterns(input.inheritedGlobalIgnores),
      source: 'inherited',
      from: input.inheritedGlobalFrom,
    };
  }
  const effective = [...parseIgnorePatterns(input.explicitIgnore), ...effectiveGlobal.patterns];
  return { effective, effectiveGlobal };
}

/** Parent directory of a path, using either separator; '.' at the root. */
export function parentDirectoryOf(path: string): string {
  const withoutTrailing = path.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(withoutTrailing.lastIndexOf('/'), withoutTrailing.lastIndexOf('\\'));
  if (separatorIndex <= 0) {
    // "/foo" -> "/", "C:\foo" -> "C:\", bare "foo" -> "."
    if (separatorIndex === 0 || withoutTrailing[1] === ':') {
      return withoutTrailing.slice(0, separatorIndex + 1) || '/';
    }
    return '.';
  }
  return withoutTrailing.slice(0, separatorIndex);
}
