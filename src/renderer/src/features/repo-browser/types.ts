/**
 * Shared contract for the repository-browser feature.
 *
 * The design comes from `prototypes/12-browser.html`. The single most
 * important idea it encodes: **`svn ls` and `svn status` are different
 * sources of truth.** The server knows what exists; only a working copy
 * knows what you have changed. They overlap solely inside a checkout, and
 * the UI must never imply otherwise — see `RepoScope`.
 */

/** Where the data on screen is coming from. Drives status columns, tints and the footer chip. */
export type RepoScope =
  /** Listing a server path with no working copy beneath it — no local status exists. */
  | 'repository'
  /** Inside a checkout — `svn status` applies and may be shown. */
  | 'working-copy';

/** How much of a subtree is on disk. Mirrors `svn info --depth`. */
export type LocalPresence = 'full' | 'sparse' | 'none';

/** Subversion status codes as reported by `svn status`. */
export type RepoStatusCode = 'M' | 'A' | 'D' | 'C' | 'R' | 'X' | '?' | 'I' | '!' | '~';

/** A single entry in a directory listing. Repository facts always; local facts only inside a checkout. */
export interface RepoEntry {
  name: string;
  /** Repository-relative path, no leading slash. */
  path: string;
  /** Full `svn://…` or `https://…` URL. */
  url: string;
  kind: 'file' | 'dir';

  /* ── repository facts (always available, from `svn list`) ── */
  revision: number;
  author: string;
  /** ISO date string. */
  date: string;
  /** Bytes; directories have none. */
  size?: number;

  /* ── local facts (only meaningful when scope is 'working-copy') ── */
  status?: RepoStatusCode;
  /** Aggregated status of descendants — only computed inside a checkout. */
  rollup?: RepoRollup;
  presence?: LocalPresence;
  lock?: { owner: string; comment?: string; created: string };
  /** True when this path is defined by an `svn:externals` property. */
  isExternal?: boolean;
  /** Externals pinned with `@rev` are reproducible; floating ones are a problem. */
  externalPegged?: boolean;
}

/** Counts of changed descendants. Never render this outside a working copy. */
export interface RepoRollup {
  modified: number;
  added: number;
  /**
   * Scheduled deletions (`D`) and items versioned but absent from disk (`!`).
   * Both are pending work `svn commit` or `svn revert` has to settle, so leaving
   * them out of the count makes a working copy read as clean when it is not.
   */
  deleted: number;
  conflicted: number;
}

/** State of a working copy that contains the current path. */
export interface WorkingCopyState {
  /** Absolute local path, e.g. `~/wc/acme-website`. */
  localPath: string;
  /** Repository-relative path this working copy is checked out from. */
  repoPath: string;
  url: string;
  /** `svn info` BASE revision of the working-copy root. */
  baseRevision: number;
  /** Latest revision on the server for this path. */
  headRevision: number;
  /**
   * A working copy is a *range*, not a point — subtrees updated separately sit
   * at different revisions. Surfacing this is a deliberate design goal.
   */
  mixedRevisions: { lowest: number; highest: number };
  rollup: RepoRollup;
  /** Revisions on the merge source not yet merged here, via `svn mergeinfo --show-revs eligible`. */
  eligibleRevisions: number;
  /** Revisions on the server not yet in this working copy. */
  incomingRevisions: number;
  depth: 'infinity' | 'immediates' | 'files' | 'empty' | 'unknown';
}

/**
 * What a diff is actually comparing. SVN can produce five materially different
 * answers and a client that doesn't say which is lying by omission.
 */
export type Comparand =
  | 'wc-base' // uncommitted local edits
  | 'wc-head' // local edits plus anything incoming
  | 'base-head' // incoming only, none of your work
  | 'branch-trunk' // divergence between two paths
  | 'rev-rev'; // any two revisions, server-side

export interface ComparandOption {
  value: Comparand;
  label: string;
  /** Plain statement of what this comparison does and does not include. */
  consequence: string;
  /** Only offered when a working copy exists. */
  requiresWorkingCopy: boolean;
}

/** The states that stop work and never explain themselves. */
export type ProblemKind =
  | 'tree-conflict'
  | 'text-conflict'
  | 'needs-cleanup'
  | 'stale-lock'
  | 'floating-external'
  | 'out-of-date';

export interface RepoProblem {
  kind: ProblemKind;
  severity: 'blocking' | 'warning' | 'advisory';
  /** Path the problem applies to; repo-relative or local depending on kind. */
  path: string;
  /** One line naming the problem. */
  title: string;
  /** What caused it and what it means — written for someone who has not met it before. */
  explanation: string;
  /** The command that clears it, shown verbatim. */
  command: string;
}

/** Tabs in the detail pane. */
export type DetailTab = 'diff' | 'blame' | 'log' | 'properties';

export interface BlameLine {
  revision: number | null; // null = uncommitted local edit
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

export interface LogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  changedPaths: number;
  /** Build outcome, when a CI integration is configured. */
  build?: 'passed' | 'failed' | 'running';
  /** Issue reference extracted via the repository's `bugtraq:logregex` property. */
  issue?: string;
}

/** A local `svn shelf` — the nearest thing SVN has to a pull request. */
export interface Shelf {
  name: string;
  fileCount: number;
  created: string;
}

/** Sort state for the contents list. */
export interface RepoSort {
  key: 'name' | 'revision' | 'author' | 'date' | 'size' | 'status';
  direction: 'asc' | 'desc';
}

/** Search scope for the contents list filter. */
export type SearchScope = 'folder' | 'repository';

/** A peg revision applied to the whole browser, or HEAD. */
export type PegRevision = { kind: 'head' } | { kind: 'revision'; revision: number } | { kind: 'date'; date: string };

/**
 * What `Copy to…` was asked for. The browser never copies anything itself —
 * `svn copy` writes to the repository and needs a log message — so it hands the
 * route the two things the user chose and nothing it had to guess.
 */
export interface RepoCopyToRequest {
  /**
   * Where the copy lands. `prompt` means the user picked no shape of
   * destination and the route should ask for a full URL.
   */
  destination: 'branch' | 'tag' | 'prompt';
  /**
   * Which revision of the source is copied. A number pins the copy to that
   * revision (`svn copy ^/src@N …`); `'HEAD'` copies whatever HEAD is when the
   * copy runs, which is *not* the same thing; `'prompt'` means ask.
   */
  fromRevision: number | 'HEAD' | 'prompt';
}
