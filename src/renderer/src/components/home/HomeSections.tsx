/**
 * The Home screen's sections.
 *
 * Everything here is presentational and prop-driven — no fetching, no
 * `window.api`, no router state beyond the links it is told to render — so the
 * route stays the only place that knows where a number came from.
 *
 * Layout language (docs/design-direction.md): flat rows on hairlines, one
 * quiet bordered surface for the working copy the page leads with, Archivo for
 * prose and JetBrains Mono only for paths, revisions and commands.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  BrainCircuit,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { ShellMark } from '@renderer/components/ShellMark';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { reopenOnboardingChecklist } from '@renderer/lib/onboardingStore';
import { formatShortcut } from '@renderer/lib/platformKeys';
import { shortenPath } from '@renderer/components/sidebar/sidebarData';
import type {
  RailProblems,
  RailShelf,
  RailUnsupportedShelving,
} from '@renderer/components/sidebar/sidebarData';

import type {
  HomeWorkingCopy,
  LocalStateDescription,
  LocalStateTone,
  OperationState,
} from './homeBriefing';

/* ── shells ──────────────────────────────────────────────────────────────── */

const ROW =
  'flex min-h-row items-center gap-2.5 border-b border-border-muted px-1 py-2 last:border-b-0';
const SUBLINE = 'block truncate text-12 text-text-muted';

export const LOCAL_TONE_CLASS: Record<LocalStateTone, string> = {
  muted: 'text-text-muted',
  clean: 'text-text-secondary',
  modified: 'text-svn-modified',
  conflict: 'text-svn-conflict',
};

interface BriefingSectionProps {
  id: string;
  title: string;
  /** Short muted text beside the heading — a count or a scope. */
  meta?: string;
  metaTitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

/**
 * One flat, list-first section: a sentence-case heading row with its meta and
 * action, then rows on hairlines. No card chrome — the page is a list.
 */
export function BriefingSection({
  id,
  title,
  meta,
  metaTitle,
  action,
  children,
}: BriefingSectionProps) {
  return (
    <section aria-labelledby={id} className="home-section min-w-0">
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-1 pb-1.5">
        <h2 id={id} className="flex-shrink-0 text-13 font-semibold text-text">
          {title}
        </h2>
        {meta && (
          <span className="min-w-0 truncate text-12 text-text-muted" title={metaTitle ?? meta}>
            {meta}
          </span>
        )}
        {action && <span className="ml-auto flex flex-shrink-0 items-center">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/* ── the working copy Home leads with ────────────────────────────────────── */

interface FocusWorkingCopyProps {
  row: HomeWorkingCopy;
  local: LocalStateDescription;
  /** `describeOperations(row)` — decides whether commit is offered and why not. */
  operations: readonly OperationState[];
  /** Server-side state from the batch pipeline: label, colour, BASE → HEAD. */
  remote: {
    label: string;
    className: string;
    revisions: string;
    detail?: string;
  } | null;
  /** The batch pipeline is busy with this working copy (or any run is active). */
  updateBusy: boolean;
  isChecking: boolean;
  /** More than one saved working copy — the heading says which one this is. */
  hasOthers: boolean;
  onOpenFiles: () => void;
  onUpdate: () => void;
  onCheck: () => void;
  onHistory: () => void;
  onReview: () => void;
  onOpenAnother: () => void;
  /** Remove a working copy that no longer exists from the saved list. */
  onForget: () => void;
  /** Batch run controls, when the list below is not carrying them. */
  footer?: ReactNode;
}

/**
 * The working copy you were last in, with the next useful actions for it.
 *
 * Every action here targets the working copy named in the heading and says so
 * in its accessible name, so "Update" can never mean a different checkout.
 */
export function FocusWorkingCopy({
  row,
  local,
  operations,
  remote,
  updateBusy,
  isChecking,
  hasOthers,
  onOpenFiles,
  onUpdate,
  onCheck,
  onHistory,
  onReview,
  onOpenAnother,
  onForget,
  footer,
}: FocusWorkingCopyProps) {
  const { name, path, info, status } = row;
  const missing = row.presence === 'none';
  const commit = operations.find((operation) => operation.kind === 'commit');
  const conflicts = status?.conflicts ?? 0;

  const primary = missing
    ? null
    : conflicts > 0
      ? {
          label: 'Resolve conflicts',
          title: `Open ${path} to resolve conflicted items`,
        }
      : commit?.enabled
        ? { label: 'Review and commit', title: commit.detail }
        : { label: 'Open files', title: `Open ${path}` };

  return (
    <section
      aria-labelledby="home-focus-title"
      className="min-w-0 rounded-10 border border-border bg-bg-secondary"
      data-testid="home-focus"
    >
      <div className="px-4 pb-3 pt-3.5">
        <p className="text-12 text-text-muted">
          {hasOthers ? 'Last opened working copy' : 'Your working copy'}
        </p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 id="home-focus-title" className="min-w-0 truncate text-15 font-semibold text-text">
            {name}
          </h2>
          {info && (
            <span className="flex-shrink-0 font-mono text-11 text-text-muted">
              {info.branch} · r{info.revision}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-11 text-text-muted" title={path}>
          {path}
        </p>
      </div>

      <dl className="grid border-t border-border-muted sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <Fact label="Local">
          <span className={LOCAL_TONE_CLASS[local.tone]}>{local.label}</span>
        </Fact>
        <Fact label="Incoming">
          {missing ? (
            <span className="text-text-muted">—</span>
          ) : remote ? (
            <span className={remote.className} title={remote.detail ?? remote.revisions}>
              {remote.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={onCheck}
              disabled={isChecking || updateBusy}
              className="inline-flex items-center gap-1 rounded-6 text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
              title="Ask the repository for HEAD — svn info, no files change"
            >
              {isChecking && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              {isChecking ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </Fact>
        <Fact label="Repository">
          {info ? (
            <span className="block truncate font-mono text-11 text-text-secondary" title={info.url}>
              {info.url}
            </span>
          ) : (
            <span className="text-text-muted">{missing ? '—' : 'Reading svn info…'}</span>
          )}
        </Fact>
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-muted px-4 py-3">
        {missing ? (
          <>
            <p className="mr-auto min-w-0 text-12 text-text-secondary">
              svn status found no checkout here. The folder may have moved or been deleted.
            </p>
            <button
              type="button"
              onClick={onForget}
              className="btn btn-ghost btn-sm"
              aria-label={`Remove ${name} from saved working copies`}
              title="Removes it from this list only — nothing on disk is touched"
            >
              Remove from list
            </button>
            <button
              type="button"
              onClick={onOpenAnother}
              className="btn btn-secondary btn-sm gap-1.5"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Open working copy…
            </button>
          </>
        ) : (
          <>
            {primary && (
              <button
                type="button"
                onClick={onOpenFiles}
                className="btn btn-primary btn-sm"
                aria-label={`${primary.label} in ${name}`}
                title={primary.title}
              >
                {primary.label}
              </button>
            )}
            <button
              type="button"
              onClick={onUpdate}
              disabled={updateBusy}
              className="btn btn-secondary btn-sm gap-1.5"
              aria-label={`Update ${name}`}
              title={
                updateBusy
                  ? 'An update is already running'
                  : `Bring ${path} up to HEAD — svn update`
              }
            >
              {updateBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Update
            </button>
            <button
              type="button"
              onClick={onHistory}
              className="btn btn-secondary btn-sm gap-1.5"
              aria-label={`History of ${name}`}
              title={`Revision log for ${path} — svn log`}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              History
            </button>
            <button
              type="button"
              onClick={onReview}
              className="btn btn-ghost btn-sm gap-1.5"
              title="AI review findings and commit plans"
            >
              <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
              Review Center
            </button>
          </>
        )}
      </div>

      {!missing && conflicts > 0 && commit && (
        <p className="flex items-center gap-1.5 border-t border-border-muted px-4 py-2 text-12 text-svn-conflict">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {commit.note} — svn resolve each item first.
        </p>
      )}

      {footer && <div className="px-3">{footer}</div>}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-border-muted px-4 py-2.5 sm:border-l sm:first:border-l-0 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0">
      <dt className="text-11 text-text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-13">{children}</dd>
    </div>
  );
}

/* ── needs attention ─────────────────────────────────────────────────────── */

interface AttentionSectionProps {
  problems: RailProblems;
  /** Name the owning checkout on every row once there is more than one. */
  attributeWorkingCopy: boolean;
}

/**
 * Problems `svn status` found, worst first, each row naming its own checkout.
 * Rendered only when there is something to say — a clean slate is reported in
 * the page summary instead of as an empty section.
 */
export function AttentionSection({ problems, attributeWorkingCopy }: AttentionSectionProps) {
  if (problems.rows.length === 0) return null;
  const blocking = problems.rows.reduce((total, row) => total + row.problems.blocking, 0);

  return (
    <BriefingSection
      id="home-attention"
      title="Needs attention"
      meta={`${problems.total}${blocking > 0 ? ` · ${blocking} blocking commit` : ''}`}
      metaTitle="Problems visible in svn status: conflicted items, missing items and stale locks."
    >
      <ul className="list-none">
        {problems.rows.map((row) => (
          <li key={row.path} className={ROW}>
            <AlertTriangle
              aria-hidden="true"
              className={`h-3.5 w-3.5 flex-shrink-0 ${
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
              <span className={SUBLINE} title={row.path}>
                {attributeWorkingCopy ? `${row.name} · ` : ''}
                <span className="font-mono text-11">{shortenPath(row.path, 2)}</span>
                {row.fromCache ? ' · cached' : ''}
              </span>
            </Link>
            {row.problems.blocking > 0 && (
              <span
                className="flex-shrink-0 rounded-md bg-svn-conflict/15 px-1.5 py-0.5 text-11 font-medium text-svn-conflict"
                title={`Subversion aborts a commit of ${row.path} until this is resolved — svn resolve`}
              >
                blocks commit
              </span>
            )}
          </li>
        ))}
      </ul>
    </BriefingSection>
  );
}

/* ── shelves ─────────────────────────────────────────────────────────────── */

interface ShelvesSectionProps {
  shelves: readonly RailShelf[];
  unsupported: readonly RailUnsupportedShelving[];
  attributeWorkingCopy: boolean;
  onOpenShelves: (workingCopyPath: string) => void;
}

/**
 * Shelved changes — local to one checkout, never on the server. `svn
 * shelf-list` reports name, message and date, not a file count, so none is
 * shown. Hidden entirely when there is nothing shelved.
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
            <Archive aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            <button
              type="button"
              onClick={() => onOpenShelves(shelf.workingCopyPath)}
              className="min-w-0 flex-1 rounded-6 text-left transition-fast hover:text-text"
              aria-label={`Shelf ${shelf.name} in ${shelf.workingCopyName}`}
              title={
                (shelf.message ? `${shelf.message}\n` : '') +
                `Shelved in ${shelf.workingCopyPath} — svn unshelve ${shelf.name}`
              }
            >
              <span className="block truncate text-13 font-medium text-text">{shelf.name}</span>
              <span className={SUBLINE}>
                {[attributeWorkingCopy ? shelf.workingCopyName : null, shelf.message, shelf.age]
                  .filter((part): part is string => Boolean(part))
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {unsupported.map((entry) => (
        <p key={entry.path} className="px-1 py-2 text-12 text-text-muted" title={entry.reason}>
          {attributeWorkingCopy ? `${entry.name}: ` : ''}this Subversion cannot shelve — svn shelf
          needs 1.14 or newer.
        </p>
      ))}
    </BriefingSection>
  );
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/** Settings have not arrived yet — hold the layout without claiming "empty". */
export function HomeLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading working copies"
      className="rounded-10 border border-border bg-bg-secondary px-4 py-4"
      data-testid="home-loading"
    >
      <div className="h-3 w-28 animate-pulse rounded-6 bg-bg-tertiary motion-reduce:animate-none" />
      <div className="mt-2.5 h-4 w-52 animate-pulse rounded-6 bg-bg-tertiary motion-reduce:animate-none" />
      <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded-6 bg-bg-tertiary motion-reduce:animate-none" />
      <span className="sr-only">Loading working copies…</span>
    </div>
  );
}

/* ── first run ───────────────────────────────────────────────────────────── */

interface EmptyBriefingProps {
  onOpen: () => void;
  onCheckout: () => void;
  /** The getting-started checklist was dismissed, so offer to bring it back. */
  showChecklistLink: boolean;
}

/**
 * First run: nothing checked out yet. Offers the two ways in — `svn checkout`
 * for a repository, or opening a folder that is already a working copy.
 */
export function EmptyBriefing({ onOpen, onCheckout, showChecklistLink }: EmptyBriefingProps) {
  return (
    <section
      aria-labelledby="home-first-run"
      className="rounded-10 border border-border bg-bg-secondary p-4"
    >
      <EmptyState
        illustration={<ShellMark className="h-7 w-7 text-text-muted" />}
        title="No working copies yet"
        titleId="home-first-run"
        variant="section"
        description={
          <>
            Check a repository out with <span className="code">svn checkout</span>, or open a folder
            that is already a working copy. Home then shows its local changes, incoming revisions
            and what to do next.
          </>
        }
        primaryAction={{
          label: 'Checkout…',
          onClick: onCheckout,
          icon: GitBranch,
        }}
        secondaryAction={{
          label: 'Open working copy…',
          onClick: onOpen,
          icon: FolderOpen,
        }}
        hint={
          <>
            Drop a working-copy folder anywhere on this screen · press {formatShortcut('Ctrl+K')}{' '}
            for commands
            {showChecklistLink && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={reopenOnboardingChecklist}
                  className="underline decoration-border-strong underline-offset-2 hover:text-text-secondary"
                >
                  show the getting-started checklist
                </button>
              </>
            )}
          </>
        }
      />
    </section>
  );
}
