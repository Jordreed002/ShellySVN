import type { RepositoryAiStyleHints } from '@shared/types';

/**
 * Pure commit-style analyzer (#110).
 *
 * Given recent commit messages (subject/body pairs, straight from
 * `window.api.svn.log`), computes `RepositoryAiStyleHints`. No DOM, no IPC, no
 * clock reads — pass `now` for deterministic tests. The result is merged into
 * the repository AI profile and consumed by prompt building as advisory
 * conventions, never as instructions.
 */

export interface CommitStyleSample {
  subject: string;
  body?: string;
}

/** Split a raw commit message into its subject (first line) and body (rest). */
export function splitCommitMessage(message: string): CommitStyleSample {
  const normalized = (message ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (!normalized) return { subject: '', body: undefined };
  const separator = normalized.indexOf('\n');
  if (separator < 0) return { subject: normalized };
  const subject = normalized.slice(0, separator).trim();
  const body = normalized.slice(separator + 1).trim();
  return body ? { subject, body } : { subject };
}

/** `feat:` / `feat(core):` style prefixes. */
const PREFIX_PATTERN = /^([a-zA-Z][a-zA-Z0-9_-]*(?:\([^)\s]{1,30}\))?):\s\S/;

const IMPERATIVE_VERBS = new Set([
  'add',
  'allow',
  'apply',
  'avoid',
  'bake',
  'bump',
  'call',
  'catch',
  'change',
  'check',
  'clean',
  'cleanup',
  'commit',
  'compute',
  'configure',
  'copy',
  'create',
  'decode',
  'decorate',
  'deprecate',
  'disable',
  'display',
  'drop',
  'enable',
  'ensure',
  'escape',
  'extract',
  'expose',
  'fix',
  'flatten',
  'format',
  'generate',
  'group',
  'handle',
  'hide',
  'ignore',
  'implement',
  'improve',
  'include',
  'increase',
  'introduce',
  'keep',
  'limit',
  'load',
  'make',
  'merge',
  'move',
  'pass',
  'prevent',
  'prune',
  'read',
  'refactor',
  'refine',
  'remove',
  'rename',
  'render',
  'replace',
  'require',
  'resolve',
  'restore',
  'return',
  'revert',
  'sanitize',
  'save',
  'select',
  'separate',
  'set',
  'share',
  'shorten',
  'show',
  'simplify',
  'skip',
  'sort',
  'split',
  'stop',
  'strip',
  'support',
  'switch',
  'sync',
  'test',
  'track',
  'treat',
  'truncate',
  'turn',
  'update',
  'upgrade',
  'use',
  'validate',
  'wrap',
  'write',
]);

/** Past-tense / third-person markers that clearly break imperative mood. */
const NON_IMPERATIVE_PATTERN =
  /^(added|adds|changed|changes|fixed|fixes|updated|updates|removed|removes|created|creates|improved|improves|introduced|introduces|refactored|refactors|is|are|was|were|it|this|that)\b/i;

const DEFAULT_ISSUE_ID_PATTERN = '\\b[A-Z][A-Z0-9]{1,11}-\\d+\\b';
const MAX_PREFIXES = 8;

function stripPrefix(subject: string): string {
  return PREFIX_PATTERN.test(subject) ? subject.slice(subject.indexOf(':') + 1).trim() : subject;
}

function firstWord(text: string): string {
  const match = /[A-Za-z]+/.exec(text);
  return match ? match[0].toLowerCase() : '';
}

function isImperative(subject: string): boolean {
  const rest = stripPrefix(subject);
  const word = firstWord(rest);
  if (!word) return false;
  if (NON_IMPERATIVE_PATTERN.test(rest)) return false;
  return IMPERATIVE_VERBS.has(word);
}

function compileIssuePattern(pattern: string | undefined): RegExp | null {
  const source = pattern?.trim() ? pattern.trim() : DEFAULT_ISSUE_ID_PATTERN;
  try {
    return new RegExp(source);
  } catch {
    try {
      return new RegExp(DEFAULT_ISSUE_ID_PATTERN);
    } catch {
      return null;
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface AnalyzeCommitStyleOptions {
  /** Repository issue pattern (profile.issueIdPattern); falls back to PROJ-123 style. */
  issueIdPattern?: string;
  /** Clock injection for deterministic learnedAt. */
  now?: Date;
}

/**
 * Compute style hints from samples. Empty/garbage input still yields a usable
 * (zeroed) result so callers can rely on the shape.
 */
export function analyzeCommitStyle(
  samples: CommitStyleSample[],
  options: AnalyzeCommitStyleOptions = {}
): RepositoryAiStyleHints {
  const now = options.now ?? new Date();
  const usable = samples.filter(
    (sample) => sample && typeof sample.subject === 'string' && sample.subject.trim()
  );
  const total = usable.length;

  const subjects = usable.map((sample) => sample.subject.trim());
  const lengths = subjects.map((subject) => subject.length);
  const averageSubjectLength = total
    ? round1(lengths.reduce((sum, length) => sum + length, 0) / total)
    : 0;
  const maxSubjectLength = total ? Math.max(...lengths) : 0;

  const prefixCounts: Record<string, number> = {};
  for (const subject of subjects) {
    const match = PREFIX_PATTERN.exec(subject);
    if (!match) continue;
    const prefix = match[1]!.toLowerCase();
    prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;
  }
  const sortedPrefixes = Object.entries(prefixCounts).toSorted((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const boundedPrefixCounts: Record<string, number> = {};
  for (const [prefix, count] of sortedPrefixes.slice(0, MAX_PREFIXES)) {
    boundedPrefixCounts[prefix] = count;
  }
  let dominantPrefix: string | undefined;
  const [topPrefix, topCount] = sortedPrefixes[0] ?? [];
  if (topPrefix !== undefined && topCount !== undefined && topCount >= 2) {
    dominantPrefix = topPrefix;
  }

  const imperativeCount = subjects.filter((subject) => isImperative(subject)).length;
  const imperativeMoodRatio = total ? round1(imperativeCount / total) : 0;

  const withBody = usable.filter((sample) => (sample.body ?? '').trim().length > 0);
  const includesBodyRatio = total ? round1(withBody.length / total) : 0;

  let dashBullets = 0;
  let asteriskBullets = 0;
  for (const sample of withBody) {
    const lines = (sample.body ?? '').split('\n');
    if (lines.some((line) => /^\s*-\s+\S/.test(line))) dashBullets += 1;
    else if (lines.some((line) => /^\s*\*\s+\S/.test(line))) asteriskBullets += 1;
  }
  const bodyBulletStyle: RepositoryAiStyleHints['bodyBulletStyle'] =
    dashBullets === 0 && asteriskBullets === 0
      ? 'none'
      : dashBullets >= asteriskBullets
        ? 'dash'
        : 'asterisk';

  const issuePattern = compileIssuePattern(options.issueIdPattern);
  const issueCount = issuePattern
    ? subjects.filter((subject) => issuePattern.test(stripPrefix(subject))).length
    : 0;
  const issueIdRatio = total ? round1(issueCount / total) : 0;

  return {
    sampledCommits: total,
    averageSubjectLength,
    maxSubjectLength,
    imperativeMoodRatio,
    prefixCounts: boundedPrefixCounts,
    dominantPrefix,
    includesBodyRatio,
    bodyBulletStyle,
    issueIdRatio,
    learnedAt: now.toISOString(),
  };
}

/** One-line human summary of learned hints, for the profile panel. */
export function describeStyleHints(hints: RepositoryAiStyleHints): string {
  const parts = [
    `${hints.sampledCommits} commit${hints.sampledCommits === 1 ? '' : 's'} sampled`,
    `avg subject ${Math.round(hints.averageSubjectLength)} chars`,
    `${Math.round(hints.imperativeMoodRatio * 100)}% imperative`,
  ];
  if (hints.dominantPrefix) parts.push(`dominant prefix ${hints.dominantPrefix}:`);
  if (hints.includesBodyRatio > 0) parts.push(`${Math.round(hints.includesBodyRatio * 100)}% with body`);
  if (hints.issueIdRatio > 0) parts.push(`${Math.round(hints.issueIdRatio * 100)}% reference issues`);
  return parts.join(' · ');
}
