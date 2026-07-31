/**
 * Shared plumbing for the repository-browser data hooks.
 *
 * Query keys, peg-revision translation, entry-path normalisation and the
 * "this capability has no API" primitive all live here so every hook agrees.
 *
 * The listing key is *not* reinvented: it is the route's existing
 * `getRepoBrowserListQueryKey`, re-exported. That matters because the tree and
 * the contents list must share one cache entry — expanding a directory in the
 * tree and then navigating into it is a cache hit, not a second `svn list`.
 */

import { DEFAULT_QUERY_STALE_TIME_MS } from '@shared/constants';
import type { SvnRepoEntry } from '@shared/types';

import type { RepoBrowserCredentials } from '@renderer/routes/repo-browser/-repoBrowserAuth';
import { isRepoBrowserAuthError } from '@renderer/routes/repo-browser/-repoBrowserAuth';
import {
  getRepoBrowserListQueryKey,
  REPO_BROWSER_LIST_STALE_TIME_MS,
} from '@renderer/routes/repo-browser/-repoBrowserCache';
import { normalizeRepoBrowserRevision } from '@renderer/routes/repo-browser/-repoBrowserRevision';

import type { PegRevision } from '../types';

export type { RepoBrowserCredentials };
export {
  getRepoBrowserListQueryKey,
  isRepoBrowserAuthError,
  normalizeRepoBrowserRevision,
  REPO_BROWSER_LIST_STALE_TIME_MS,
};

/** Namespace every repository-browser query shares. */
export const REPO_BROWSER_QUERY_ROOT = 'repo-browser';

/** Committed history is immutable; only a new commit can change it. */
export const REPO_BROWSER_HISTORY_STALE_TIME_MS = DEFAULT_QUERY_STALE_TIME_MS;
/** `svn status` describes your disk, which moves under you. Short, but not zero. */
export const REPO_BROWSER_STATUS_STALE_TIME_MS = 15_000;
/** `svn info` / `svn info URL` — cheap, but not worth re-running per keystroke. */
export const REPO_BROWSER_INFO_STALE_TIME_MS = 60_000;
/** Keep results around after unmount so back/forward navigation is instant. */
export const REPO_BROWSER_GC_TIME_MS = 30 * 60_000;

/* ────────────────────────────── peg revisions ───────────────────────────── */

/**
 * A `PegRevision` as Subversion spells it: `HEAD`, `4821` or `{2024-03-01}`.
 */
export function pegToRevision(peg: PegRevision | undefined | null): string {
  if (!peg || peg.kind === 'head') return 'HEAD';
  if (peg.kind === 'revision') return String(peg.revision);
  return `{${peg.date}}`;
}

/** The revision string the route's cache keys and `svn` invocations expect. */
export function pegToRevisionArg(peg: PegRevision | undefined | null): string {
  return normalizeRepoBrowserRevision(pegToRevision(peg));
}

/**
 * Append the peg to a URL (`^/trunk@4821`).
 *
 * HEAD is left off: it is the default, and omitting it keeps URLs identical to
 * the ones the existing route already caches.
 */
export function withPeg(url: string, peg: PegRevision | undefined | null): string {
  const revision = pegToRevisionArg(peg);
  return revision === 'HEAD' ? url : `${url}@${revision}`;
}

/* ─────────────────────────────── query keys ─────────────────────────────── */

/**
 * The credential discriminator the route's list key already uses, reused
 * verbatim so a password change busts every repository-browser query and not
 * just the listing.
 */
export type RepoBrowserCredentialKey = ReturnType<typeof getRepoBrowserListQueryKey>[3];

export function credentialQueryKey(
  credentials: RepoBrowserCredentials | null | undefined
): RepoBrowserCredentialKey {
  return getRepoBrowserListQueryKey('', 'HEAD', credentials ?? null)[3];
}

export function repoLogQueryKey(
  url: string,
  revision: string,
  pageSize: number,
  credentials: RepoBrowserCredentials | null | undefined
) {
  return [
    REPO_BROWSER_QUERY_ROOT,
    'log',
    url,
    revision,
    pageSize,
    credentialQueryKey(credentials),
  ] as const;
}

export function repoBugtraqQueryKey(
  url: string,
  revision: string,
  credentials: RepoBrowserCredentials | null | undefined
) {
  return [
    REPO_BROWSER_QUERY_ROOT,
    'bugtraq',
    url,
    revision,
    credentialQueryKey(credentials),
  ] as const;
}

export function repoBlameQueryKey(
  url: string,
  startRevision: number | null,
  endRevision: number | null,
  credentials: RepoBrowserCredentials | null | undefined
) {
  return [
    REPO_BROWSER_QUERY_ROOT,
    'blame',
    url,
    startRevision,
    endRevision,
    credentialQueryKey(credentials),
  ] as const;
}

export function repoPropertiesQueryKey(
  url: string,
  revision: string,
  credentials: RepoBrowserCredentials | null | undefined,
  showInherited: boolean
) {
  return [
    REPO_BROWSER_QUERY_ROOT,
    'properties',
    url,
    revision,
    credentialQueryKey(credentials),
    showInherited,
  ] as const;
}

export function repoDiffQueryKey(planKey: readonly (string | number | null)[]) {
  return [REPO_BROWSER_QUERY_ROOT, 'diff', ...planKey] as const;
}

export function workingCopyInfoQueryKey(localPath: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'info', localPath] as const;
}

export function workingCopyHeadQueryKey(url: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'head', url] as const;
}

export function workingCopyStatusQueryKey(localPath: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'status', localPath] as const;
}

export function workingCopyExternalsQueryKey(localPath: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'externals', localPath] as const;
}

export function workingCopyMergeInfoQueryKey(source: string, target: string) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'mergeinfo', source, target] as const;
}

export function workingCopyIncomingQueryKey(url: string, base: number, head: number) {
  return [REPO_BROWSER_QUERY_ROOT, 'wc', 'incoming', url, base, head] as const;
}

/* ───────────────────────── unsupported capabilities ─────────────────────── */

/**
 * Something the UI asked for that the IPC surface genuinely cannot answer.
 *
 * The spec forbids inventing data, so a hook that cannot run a comparison says
 * so in a shape the detail pane can render: what was wanted, why it is not
 * available, and the `svn` command that would answer it by hand.
 */
export interface UnsupportedCapability {
  /** Stable identifier, e.g. `diff:wc-head`. */
  capability: string;
  /** One line, written for someone who has not met this limitation before. */
  reason: string;
  /** The command that answers the question at a terminal, when one exists. */
  command?: string;
}

/* ──────────────────────────────── errors ────────────────────────────────── */

/** Message for anything thrown, or null when there is no error. */
export function describeError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message || 'SVN operation failed';
  return String(error);
}

/**
 * Auth failure from either channel: a thrown error, or the `error` field on a
 * read that resolved rather than rejected (`svn status`, `svn blame`, `svn diff`
 * all do this). Both are the route's existing `isRepoBrowserAuthError` test.
 */
export function isAuthFailure(error: unknown, resolvedError?: string | null): boolean {
  if (error && isRepoBrowserAuthError(error)) return true;
  return Boolean(resolvedError) && isRepoBrowserAuthError({ message: resolvedError });
}

/**
 * `svn info` on a path outside a checkout is a normal answer, not a failure.
 * Subversion reports it as E155007 / E155010 / "is not a working copy".
 */
export function isNotAWorkingCopyError(error: unknown): boolean {
  const message = describeError(error) ?? '';
  return /E155007|E155010|W155010|is not a working copy|not a versioned resource/i.test(message);
}

/**
 * `svn status` refuses to run while the working copy holds its own lock. The
 * cause is an interrupted operation and the cure is `svn cleanup`, so this is
 * a problem to explain rather than an error to throw.
 */
export function isNeedsCleanupError(errorCode?: string, message?: string): boolean {
  if (errorCode === 'E155004') return true;
  return /E155004|previous operation has not finished|run 'svn cleanup'|working copy locked/i.test(
    message ?? ''
  );
}

/* ────────────────────────────── path handling ───────────────────────────── */

/** Trim trailing slashes without emptying a bare root. */
export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Join a repository base URL to a repository-relative path. */
export function joinRepoUrl(rootUrl: string, repoPath: string): string {
  const base = trimTrailingSlash(rootUrl);
  const relative = repoPath.replace(/^\/+/, '');
  return relative ? `${base}/${relative}` : base;
}

/** Join a repository-relative directory to a child name. */
export function joinRepoPath(repoPath: string, name: string): string {
  const parent = trimTrailingSlash(repoPath.replace(/^\/+/, ''));
  const child = name.replace(/^\/+/, '').replace(/\/+$/, '');
  return parent ? `${parent}/${child}` : child;
}

/**
 * Make `svn list` output joinable with `svn status` output.
 *
 * `parseSvnListXml` sets `SvnRepoEntry.path` to the entry's **full URL**, but
 * `RepoEntry.path` — and therefore every status/externals/presence lookup the
 * adapters do — is repository-relative. Rewriting the path here is the only
 * place that knows which directory was listed, so it cannot live in the pure
 * adapters. Without it every `statusByPath.get(entry.path)` silently misses and
 * a working copy renders with no status at all.
 */
export function toRepoRelativeEntries(
  entries: readonly SvnRepoEntry[],
  repoPath: string
): SvnRepoEntry[] {
  return entries.map((entry) => {
    const name = entry.name.replace(/\/+$/, '');
    return { ...entry, name, path: joinRepoPath(repoPath, name) };
  });
}

/** Normalise a local filesystem path for prefix comparison across platforms. */
export function normaliseLocalPath(value: string): string {
  return trimTrailingSlash(value.replace(/\\/g, '/'));
}

/**
 * Map absolute local paths reported by `svn status` back to repository-relative
 * paths, so `indexStatusByPath` can join them against the listing.
 */
export function createLocalToRepoPath(
  localRoot: string,
  repoRoot: string
): (localPath: string) => string | null {
  const root = normaliseLocalPath(localRoot);
  return (localPath: string): string | null => {
    const candidate = normaliseLocalPath(localPath);
    if (candidate === root) return repoRoot;
    if (!candidate.startsWith(`${root}/`)) return null;
    return joinRepoPath(repoRoot, candidate.slice(root.length + 1));
  };
}

/** Repository-relative path of a URL inside a repository, or null when outside. */
export function urlToRepoPath(url: string, repositoryRoot: string): string | null {
  const root = trimTrailingSlash(repositoryRoot);
  const target = trimTrailingSlash(url);
  if (!root) return null;
  if (target === root) return '';
  if (!target.startsWith(`${root}/`)) return null;
  return decodeURI(target.slice(root.length + 1));
}
