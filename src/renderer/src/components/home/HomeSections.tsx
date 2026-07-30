/**
 * The Home briefing's sections, in `prototypes/12-browser.html`'s language:
 * `.eyebrow` section labels, hairline-bordered cards, 38px rows, mono for
 * paths, revisions and commands.
 *
 * Everything here is presentational and prop-driven — no fetching, no
 * `window.api`, no router state beyond the links it is told to render — so the
 * route stays the only place that knows where a number came from.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  Clock,
  Download,
  FileEdit,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Upload,
} from 'lucide-react';

import { ShellMark } from '@renderer/components/ShellMark';
// Read-only import: the presence dot and its spoken label are the rail's, so
// "checked out" means the same thing on both surfaces.
import { PresenceDot } from '@renderer/components/sidebar/RepoRow';
import { shortenPath } from '@renderer/components/sidebar/sidebarData';
import type {
  RailProblems,
  RailShelf,
  RailUnsupportedShelving,
} from '@renderer/components/sidebar/sidebarData';

import {
  describeLocalChanges,
  describeRepositoryFacts,
  type HomeWorkingCopy,
  type OperationKind,
  type OperationState,
} from './homeBriefing';
import type { IncomingState } from './useIncomingRevisions';

/* ── shells ──────────────────────────────────────────────────────────────── */

const ROW =
  'flex min-h-row items-center gap-2.5 border-b border-border-muted px-2.5 py-1.5 last:border-b-0';
const META = 'font-mono text-10 text-text-muted';
const SUBTLE_LINK =
  'rounded-6 px-1.5 py-0.5 text-11 text-text-secondary transition-fast hover:bg-bg-tertiary hover:text-text';

interface BriefingSectionProps {
  id: string;
  title: string;
  /** Mono line beside the label — a count, a scope, a caveat. */
  meta?: string;
  metaTitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** One card: eyebrow header on a hairline, rows beneath. */
export function BriefingSection({
  id,
  title,
  meta,
  metaTitle,
  action,
  children,
}: BriefingSectionProps) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-10 border border-border bg-bg-secondary shadow-card"
    >
      <div className="flex h-control-md items-center gap-2 border-b border-border px-2.5">
        <h2 id={id} className="eyebrow flex-shrink-0">
          {title}
        </h2>
        {meta && (
          <span className={`min-w-0 flex-1 truncate ${META}`} title={metaTitle ?? meta}>
            {meta}
          </span>
        )}
        {action && <span className="ml-auto flex flex-shrink-0 items-center">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A quiet line for what a section can and cannot say. */
function Note({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <p className="px-2.5 py-2 font-mono text-9.5 leading-relaxed text-text-faint" title={title}>
      {children}
    </p>
  );
}

/* ── needs attention ─────────────────────────────────────────────────────── */

interface AttentionSectionProps {
  problems: RailProblems;
  /** Working copies whose `svn status` came back with nothing wrong. */
  measuredClean: number;
  /** Name the owning checkout on every row once there is more than one. */
  attributeWorkingCopy: boolean;
}

/**
 * Problems `svn status` found, worst first, each row naming its own checkout.
 *
 * Conflicts lead because they stop a commit outright. The count is the status
 * subset the rail measures — floating externals and incoming revisions need the
 * server, and the note says so instead of implying the list is complete.
 */
export function AttentionSection({
  problems,
  measuredClean,
  attributeWorkingCopy,
}: AttentionSectionProps) {
  const blocking = problems.rows.reduce((total, row) => total + row.problems.blocking, 0);

  return (
    <BriefingSection
      id="home-attention"
      title="Needs attention"
      meta={
        problems.rows.length > 0
          ? `${problems.total} from svn status${blocking > 0 ? ` · ${blocking} blocks commit` : ''}`
          : undefined
      }
      metaTitle="Problems visible in svn status: conflicted items, missing items and stale locks. Floating externals and incoming revisions are counted in the repository browser."
    >
      {problems.rows.length > 0 && (
        <ul className="list-none">
          {problems.rows.map((row) => (
            <li key={row.path} className={ROW}>
              <AlertTriangle
                aria-hidden="true"
                className={`h-4 w-4 flex-shrink-0 ${
                  row.problems.blocking > 0 ? 'text-svn-conflict' : 'text-warning'
                }`}
              />
              <Link
                to="/files"
                search={{ path: row.path }}
                className="min-w-0 flex-1 rounded-6 text-left transition-fast hover:text-text"
                title={`Open ${row.path} — ${row.problems.summary}`}
              >
                <span className="block truncate text-13 font-medium text-text">
                  {row.problems.summary}
                </span>
                <span className={`block truncate ${META}`} title={row.path}>
                  {attributeWorkingCopy ? `${row.name} · ` : ''}
                  {shortenPath(row.path, 2)}
                  {row.fromCache ? ' · cached' : ''}
                </span>
              </Link>
              {row.problems.blocking > 0 && (
                <span
                  className="flex-shrink-0 rounded-pill border border-svn-conflict/40 bg-svn-conflict/15 px-1.5 font-mono text-9.5 text-svn-conflict"
                  title={`Subversion aborts a commit of ${row.path} until this is resolved — svn resolve`}
                >
                  blocks commit
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {problems.rows.length === 0 && measuredClean > 0 && (
        <Note title="Said only about the working copies whose svn status actually answered.">
          Nothing wrong in {measuredClean} measured working{' '}
          {measuredClean === 1 ? 'copy' : 'copies'}.
        </Note>
      )}

      {problems.unmeasured > 0 && (
        <Note title="svn status has not answered for these checkouts, so their problems are unknown rather than absent.">
          {problems.unmeasured} working {problems.unmeasured === 1 ? 'copy' : 'copies'} not measured
          yet — svn status has not answered.
        </Note>
      )}

      {problems.rows.length === 0 && measuredClean === 0 && problems.unmeasured === 0 && (
        <Note>No checkout has reported its local state yet.</Note>
      )}
    </BriefingSection>
  );
}

/* ── working copies ──────────────────────────────────────────────────────── */

interface WorkingCopiesSectionProps {
  rows: readonly HomeWorkingCopy[];
  /** Where the session left off — rendered first and marked. */
  lastPath?: string;
  /** Records the choice in recent repositories, exactly as the rail does. */
  onOpen: (path: string) => void;
  action?: ReactNode;
}

const TONE_CLASS = {
  conflict: 'text-svn-conflict',
  modified: 'text-svn-modified',
  clean: 'text-svn-normal',
  muted: 'text-text-muted',
} as const;

/**
 * The checkouts on this machine: local presence, the repository facts `svn info`
 * reported, and what `svn status` found — in that order, because the first two
 * are true of the server and the third is true only of your disk.
 */
export function WorkingCopiesSection({
  rows,
  lastPath,
  onOpen,
  action,
}: WorkingCopiesSectionProps) {
  return (
    <BriefingSection
      id="home-working-copies"
      title="Working copies"
      meta={`${rows.length} in this list`}
      action={action}
    >
      <ul className="list-none">
        {rows.map((row) => {
          const changes = describeLocalChanges(row);
          const facts = describeRepositoryFacts(row);
          return (
            <li key={row.path} className={ROW}>
              <PresenceDot presence={row.presence} />
              <Link
                to="/files"
                search={{ path: row.path }}
                onClick={() => onOpen(row.path)}
                className="min-w-0 flex-1 rounded-6 text-left transition-fast hover:text-accent"
                title={`Open ${row.path}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-13 font-medium text-text">{row.name}</span>
                  {row.path === lastPath && (
                    <span
                      className="flex-shrink-0 rounded-pill border border-accent/40 bg-accent/10 px-1.5 font-mono text-9.5 text-accent"
                      title="The last working copy this app opened."
                    >
                      last opened
                    </span>
                  )}
                </span>
                <span className={`block truncate ${META}`} title={row.path}>
                  {shortenPath(row.path, 3)}
                </span>
              </Link>

              {facts && (
                <span
                  className={`hidden flex-shrink-0 sm:block ${META}`}
                  title={row.info ? `${row.info.url} at BASE r${row.info.revision}` : undefined}
                >
                  {facts}
                </span>
              )}
              {changes && (
                <span
                  className={`flex-shrink-0 font-mono text-10 ${TONE_CLASS[changes.tone]}`}
                  title={changes.title}
                >
                  {changes.text}
                </span>
              )}

              <span className="flex flex-shrink-0 items-center gap-0.5">
                <Link
                  to="/history"
                  search={{ path: row.path }}
                  className={SUBTLE_LINK}
                  title={`Revision history of ${row.name} — svn log`}
                >
                  Log
                </Link>
                {row.info && (
                  <Link
                    to="/repo-browser"
                    search={{ url: row.info.repositoryRoot, localPath: row.path }}
                    className={SUBTLE_LINK}
                    title={`Browse ${row.info.repositoryRoot} — svn list`}
                  >
                    Browse
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </BriefingSection>
  );
}

/* ── incoming ────────────────────────────────────────────────────────────── */

interface IncomingSectionProps {
  rows: readonly HomeWorkingCopy[];
  incoming: ReadonlyMap<string, IncomingState>;
  /** Asks the server about one checkout: `svn info <URL>`, then `svn log`. */
  onCheck: (path: string) => void;
}

/**
 * What the server has that you do not.
 *
 * BASE comes from the `svn info` the rail already ran; HEAD and the revision
 * count are round trips, so they are never taken on load. Until one is made the
 * row shows `—` and the command that would answer it — an uncounted incoming
 * queue is unknown, not empty.
 */
export function IncomingSection({ rows, incoming, onCheck }: IncomingSectionProps) {
  const checkable = rows.filter((row) => row.info);

  return (
    <BriefingSection
      id="home-incoming"
      title="Incoming"
      meta="from the repository"
      metaTitle="Counting incoming revisions needs the server: svn info <URL> for HEAD, then svn log -r BASE+1:HEAD."
    >
      {checkable.length === 0 ? (
        <Note>
          No checkout has reported its repository URL, so there is nothing to compare against HEAD.
        </Note>
      ) : (
        <ul className="list-none">
          {checkable.map((row) => {
            const state = incoming.get(row.path);
            const view = describeIncoming(row, state);
            return (
              <li key={row.path} className={ROW}>
                <span
                  aria-hidden="true"
                  className={`w-9 flex-shrink-0 text-right font-mono text-15 font-semibold tabular-nums ${view.tone}`}
                >
                  {view.value}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-11.5 font-bold text-text">{view.label}</span>
                  <span className={`block truncate ${META}`} title={view.detailTitle}>
                    {view.detail}
                  </span>
                </span>
                {view.canUpdate ? (
                  <Link
                    to="/files"
                    search={{ path: row.path }}
                    className={SUBTLE_LINK}
                    title={`Open ${row.name} to bring it up to HEAD — svn update`}
                  >
                    Update
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCheck(row.path)}
                    disabled={state?.pending}
                    className="btn btn-secondary btn-sm flex-shrink-0 text-11"
                    title={`Ask the server about ${row.name} — ${state?.command ?? 'svn info <URL>'}`}
                    aria-label={`Check the server for incoming revisions in ${row.name}`}
                  >
                    {state?.pending ? 'Checking…' : 'Check server'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </BriefingSection>
  );
}

interface IncomingView {
  value: string;
  label: string;
  detail: string;
  detailTitle: string;
  tone: string;
  canUpdate: boolean;
}

/** Turn one working copy's incoming state into the row's four strings. */
function describeIncoming(row: HomeWorkingCopy, state: IncomingState | undefined): IncomingView {
  const base = state?.base ?? row.info?.revision;
  const baseLabel = typeof base === 'number' ? `BASE r${base}` : 'BASE unknown';
  const command = state?.command ?? 'svn info <URL>';

  if (!state || state.kind === 'unmeasured') {
    return {
      value: state?.pending ? '…' : '—',
      label: state?.pending ? 'Reading HEAD…' : 'Not counted',
      detail: `${row.name} · ${baseLabel} · needs the server`,
      detailTitle: `${row.path} — ${command}`,
      tone: 'text-text-faint',
      canUpdate: false,
    };
  }

  if (state.kind === 'error') {
    return {
      value: '—',
      label: 'Server not reached',
      detail: `${row.name} · ${state.error ?? 'the request failed'}`,
      detailTitle: state.error ?? command,
      tone: 'text-svn-conflict',
      canUpdate: false,
    };
  }

  if (state.kind === 'at-head') {
    return {
      value: '0',
      label: `At HEAD r${state.head}`,
      detail: `${row.name} · BASE and HEAD are both r${state.head}`,
      detailTitle: `${row.path} — measured with ${command}`,
      tone: 'text-svn-normal',
      canUpdate: false,
    };
  }

  if (state.pending || typeof state.count !== 'number') {
    return {
      value: '…',
      label: 'Counting revisions…',
      detail: `${row.name} · ${baseLabel} → HEAD r${state.head}`,
      detailTitle: `${row.path} — ${command}`,
      tone: 'text-text-muted',
      canUpdate: true,
    };
  }

  return {
    value: state.capped ? `${state.count}+` : String(state.count),
    label: `incoming ${state.count === 1 ? 'revision' : 'revisions'}`,
    detail: `${row.name} · r${(state.base ?? 0) + 1} → r${state.head}`,
    detailTitle: `${row.path} — ${command}`,
    tone: 'text-accent',
    canUpdate: true,
  };
}

/* ── shelves ─────────────────────────────────────────────────────────────── */

interface ShelvesSectionProps {
  shelves: readonly RailShelf[];
  unsupported: readonly RailUnsupportedShelving[];
  attributeWorkingCopy: boolean;
  onOpenShelves: (workingCopyPath: string) => void;
}

/**
 * Shelved changes — local to one checkout, never on the server.
 *
 * `svn shelf-list` reports a shelf's name, message and date, not how many files
 * it holds, so no file count is shown. A Subversion too old to shelve says so
 * in words rather than showing an empty list.
 */
export function HomeShelvesSection({
  shelves,
  unsupported,
  attributeWorkingCopy,
  onOpenShelves,
}: ShelvesSectionProps) {
  if (shelves.length === 0 && unsupported.length === 0) return null;

  return (
    <BriefingSection
      id="home-shelves"
      title="Shelves"
      meta={shelves.length > 0 ? `${shelves.length} set aside` : undefined}
    >
      <ul className="list-none">
        {shelves.map((shelf) => (
          <li key={`${shelf.workingCopyPath}::${shelf.name}`} className={ROW}>
            <Archive aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-muted" />
            <button
              type="button"
              onClick={() => onOpenShelves(shelf.workingCopyPath)}
              className="min-w-0 flex-1 rounded-6 text-left transition-fast hover:text-accent"
              aria-label={`Shelf ${shelf.name} in ${shelf.workingCopyName}`}
              title={
                (shelf.message ? `${shelf.message}\n` : '') +
                `Shelved in ${shelf.workingCopyPath} — svn unshelve ${shelf.name}`
              }
            >
              <span className="block truncate text-13 font-medium text-text">{shelf.name}</span>
              <span className={`block truncate ${META}`}>
                {[attributeWorkingCopy ? shelf.workingCopyName : null, shelf.age]
                  .filter((part): part is string => Boolean(part))
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {unsupported.map((entry) => (
        <Note key={entry.path} title={entry.reason}>
          {attributeWorkingCopy ? `${entry.name}: ` : ''}this Subversion cannot shelve — svn shelf
          needs 1.14 or newer.
        </Note>
      ))}
    </BriefingSection>
  );
}

/* ── where you were last ─────────────────────────────────────────────────── */

interface RecentLocationsSectionProps {
  paths: readonly string[];
}

/** Directories this app was last pointed at, newest first. */
export function RecentLocationsSection({ paths }: RecentLocationsSectionProps) {
  if (paths.length === 0) return null;

  return (
    <BriefingSection id="home-recent" title="Where you were last" meta={`${paths.length} locations`}>
      <ul className="list-none">
        {paths.map((path) => (
          <li key={path} className={ROW}>
            <Clock aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-muted" />
            <Link
              to="/files"
              search={{ path }}
              className="min-w-0 flex-1 truncate rounded-6 font-mono text-11 text-text-secondary transition-fast hover:text-accent"
              title={path}
            >
              {shortenPath(path, 3)}
            </Link>
          </li>
        ))}
      </ul>
    </BriefingSection>
  );
}

/* ── operations ──────────────────────────────────────────────────────────── */

const OPERATION_ICON: Record<OperationKind, typeof Download> = {
  update: Download,
  commit: Upload,
  revert: RefreshCw,
  diff: FileEdit,
};

interface OperationsSectionProps {
  operations: readonly OperationState[];
  /** Checkout the operations act on. Absent means every one is unavailable. */
  targetName?: string;
  /** Opens the working copy where the operation runs. */
  onRun: (kind: OperationKind) => void;
}

/**
 * Subversion's four everyday operations, each with its command beside it.
 *
 * The word is Subversion's — commit, not "push"; revert, not "discard"; update,
 * not "get latest" — and an operation that would fail is disabled with the
 * reason printed underneath, not hidden in a tooltip a keyboard user never sees.
 */
export function OperationsSection({ operations, targetName, onRun }: OperationsSectionProps) {
  return (
    <BriefingSection
      id="home-operations"
      title="Operations"
      meta={targetName ? `on ${targetName}` : 'no working copy open'}
      metaTitle={
        targetName
          ? `These open ${targetName} in the working-copy view, where the operation runs.`
          : 'Open a working copy or check one out to enable these.'
      }
    >
      <ul className="grid list-none grid-cols-2 lg:grid-cols-4">
        {operations.map((operation) => {
          const Icon = OPERATION_ICON[operation.kind];
          const noteId = `home-operation-${operation.kind}-note`;
          return (
            <li
              key={operation.kind}
              className="min-w-0 border-b border-r border-border-muted p-2 last:border-r-0 lg:border-b-0"
            >
              <button
                type="button"
                disabled={!operation.enabled}
                onClick={() => onRun(operation.kind)}
                aria-describedby={noteId}
                title={operation.detail}
                className="btn btn-secondary w-full justify-start gap-2 px-2.5 py-1.5 text-11.5"
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-semibold">{operation.word}</span>
                <span className="ml-auto truncate font-mono text-9.5 text-text-muted">
                  {operation.command}
                </span>
              </button>
              <p
                id={noteId}
                className="mt-1 truncate px-0.5 font-mono text-9.5 text-text-faint"
                title={operation.detail}
              >
                {operation.note}
              </p>
            </li>
          );
        })}
      </ul>
    </BriefingSection>
  );
}

/* ── first run ───────────────────────────────────────────────────────────── */

interface EmptyBriefingProps {
  onOpen: () => void;
  onCheckout: () => void;
}

/**
 * First run: nothing checked out, nothing bookmarked, no history.
 *
 * There is no briefing to give, so this offers the two ways in — `svn checkout`
 * for a repository, or opening a folder that is already a working copy — and
 * says how else the app can be driven.
 */
export function EmptyBriefing({ onOpen, onCheckout }: EmptyBriefingProps) {
  return (
    <section
      aria-labelledby="home-first-run"
      className="rounded-10 border border-border bg-bg-secondary p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <ShellMark className="mt-0.5 h-8 w-8 flex-shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 id="home-first-run" className="text-18 font-bold tracking-tight text-text">
            No working copies yet
          </h2>
          <p className="mt-1 max-w-prose text-12.5 text-text-secondary">
            Check a repository out with <span className="code">svn checkout</span>, or open a folder
            that is already a working copy. Everything else on this screen describes checkouts, so
            it stays empty until there is one.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCheckout}
              className="btn btn-primary gap-2 px-3 py-1.5 text-11.5"
            >
              <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
              Checkout…
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="btn btn-secondary gap-2 px-3 py-1.5 text-11.5"
            >
              <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
              Open working copy…
            </button>
          </div>
          <p className="mt-3 font-mono text-9.5 leading-relaxed text-text-faint">
            Drop a working-copy folder anywhere on this screen · press ⌘K for commands
          </p>
        </div>
      </div>
    </section>
  );
}
