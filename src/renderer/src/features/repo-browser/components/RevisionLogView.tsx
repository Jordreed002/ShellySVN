/**
 * `svn log` for the selected path, newest first.
 *
 * A commit is rarely the whole story: teams already keep the build outcome and
 * the issue key alongside it — SVN even stores the latter via `bugtraq:logregex`
 * — so both are shown when the route can supply them, rather than making the
 * reader alt-tab to a CI dashboard.
 *
 * Presentational only: entries, paging state and handlers arrive via props.
 */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitCompare,
  Loader2,
  PencilLine,
  ScrollText,
  Tag,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { LogEntry } from '../types';
import { DetailMessage, useRepoBrowserRetry } from './RepoDetailPane';
import { formatEntryDate } from './RepoContentsRow';

type BuildStatus = NonNullable<LogEntry['build']>;

const BUILD_PILL: Record<BuildStatus, { label: string; icon: LucideIcon; className: string }> = {
  passed: {
    label: 'build passed',
    icon: CheckCircle2,
    className: 'border-svn-added/50 bg-svn-added/10 text-svn-added',
  },
  failed: {
    label: 'build failed',
    icon: XCircle,
    className: 'border-svn-deleted/50 bg-svn-deleted/10 text-svn-deleted',
  },
  running: {
    label: 'building…',
    icon: Loader2,
    className: 'border-svn-modified/50 bg-svn-modified/10 text-svn-modified',
  },
};

export interface RevisionLogViewProps {
  entries: readonly LogEntry[];
  /** Path the log belongs to, used in the empty state. */
  path?: string;
  /** Revision currently shown elsewhere in the pane. */
  selectedRevision?: number | null;
  onSelectRevision?: (revision: number) => void;
  /** Open the issue tracker for a `bugtraq:` reference. Chip is inert without it. */
  onIssueClick?: (issue: string) => void;
  /** Fetch the next page of revisions. The affordance only renders when supplied. */
  onLoadMore?: () => void;
  /** False once the log has reached r1 for this path. */
  hasMore?: boolean;
  /** A page is in flight. */
  loadingMore?: boolean;
  loading?: boolean;
  error?: string | null;
  /**
   * Retry the failed read. Defaults to invalidating the feature's query family,
   * which refetches every view mounted in the pane — callers with a narrower
   * refetcher (e.g. `refetch`) should pass it.
   */
  onRetry?: () => void;
  /**
   * Open the revprop editor (#70) for one revision — `svn:log`, `svn:author`,
   * `svn:date`. The chip is inert without it: revprop writes are permanent and
   * server-logged, so the affordance only exists where the editor is wired.
   */
  onEditRevprops?: (entry: LogEntry) => void;
  /**
   * Show that revision's diff against its predecessor (#72). The button is
   * inert without it — the dialog only exists where the pane wired it.
   */
  onShowChanges?: (revision: number) => void;
  className?: string;
}

export function RevisionLogView({
  entries,
  path,
  selectedRevision = null,
  onSelectRevision,
  onIssueClick,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  loading = false,
  error = null,
  onRetry,
  onEditRevprops,
  onShowChanges,
  className = '',
}: RevisionLogViewProps): React.JSX.Element {
  const retryDefault = useRepoBrowserRetry();

  if (loading) {
    return <DetailMessage icon={Loader2} title="Running svn log…" busy />;
  }

  if (error) {
    return (
      <DetailMessage
        icon={AlertTriangle}
        tone="error"
        title="svn log failed"
        detail={error}
        onRetry={onRetry ?? retryDefault}
      />
    );
  }

  if (entries.length === 0) {
    return (
      <DetailMessage
        icon={ScrollText}
        title="No revisions"
        detail={
          <>
            {path ? <b className="font-mono">{path}</b> : 'This path'} has no history at the
            revision you are browsing. A path added later, or one that only exists on your disk, has
            nothing to log.
          </>
        }
        command={path ? `svn log -v "${path}"` : 'svn log -v'}
      />
    );
  }

  return (
    <div className={`font-sans ${className}`}>
      <ul className="list-none">
        {entries.map((entry) => {
          const selected = entry.revision === selectedRevision;
          const build = entry.build ? BUILD_PILL[entry.build] : null;
          const BuildIcon = build?.icon;
          return (
            <li key={entry.revision}>
              <div
                role={onSelectRevision ? 'button' : undefined}
                tabIndex={onSelectRevision ? 0 : undefined}
                onClick={onSelectRevision ? () => onSelectRevision(entry.revision) : undefined}
                onKeyDown={
                  onSelectRevision
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectRevision(entry.revision);
                        }
                      }
                    : undefined
                }
                aria-current={selected ? 'true' : undefined}
                className={`flex w-full gap-2.5 border-b border-border-muted px-3 py-2 text-left ${
                  selected ? 'bg-accent/10' : ''
                } ${onSelectRevision ? 'cursor-pointer hover:bg-bg-tertiary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent' : ''}`}
              >
                <span className="flex-none pt-0.5 font-mono text-2xs text-accent">
                  r{entry.revision}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold leading-snug text-text">
                    {entry.message.trim() === '' ? (
                      <span className="italic text-text-muted">(no log message)</span>
                    ) : (
                      entry.message
                    )}
                  </span>

                  {/* Same relative format as the contents list — one product,
                      one way of saying when. The exact timestamp stays on hover. */}
                  <span className="mt-0.5 block text-2xs text-text-secondary">
                    {entry.author} ·{' '}
                    <time dateTime={entry.date} title={entry.date}>
                      {formatEntryDate(entry.date)}
                    </time>{' '}
                    · {entry.changedPaths === 1 ? '1 path' : `${entry.changedPaths} paths`} changed
                  </span>

                  {build || entry.issue ? (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {build && BuildIcon ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-2xs font-bold ${build.className}`}
                        >
                          <BuildIcon
                            className={`h-2.5 w-2.5 ${entry.build === 'running' ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          {build.label}
                        </span>
                      ) : null}

                      {entry.issue ? (
                        onIssueClick ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (entry.issue) onIssueClick(entry.issue);
                            }}
                            title={`Open ${entry.issue}`}
                            className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-1.5 py-px font-mono text-2xs text-accent hover:bg-accent/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          >
                            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                            {entry.issue}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-1.5 py-px font-mono text-2xs text-accent">
                            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                            {entry.issue}
                          </span>
                        )
                      ) : null}
                    </span>
                  ) : null}
                </span>

                {/* #72: show this revision's diff against its predecessor. */}
                {onShowChanges ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onShowChanges(entry.revision);
                    }}
                    className="flex-none self-start rounded-md p-1 text-text-faint transition-colors hover:bg-bg-tertiary hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    title={`Diff r${entry.revision} against r${entry.revision - 1}`}
                    aria-label={`Show changes for r${entry.revision}`}
                  >
                    <GitCompare className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}

                {/* #70: edit svn:log / svn:author / svn:date on this revision.
                    Visible-but-faint by design — keyboard users must reach it
                    without hovering, but it must not compete with the message. */}
                {onEditRevprops ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditRevprops(entry);
                    }}
                    className="flex-none self-start rounded-md p-1 text-text-faint transition-colors hover:bg-bg-tertiary hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    title="Edit revision properties — svn:log, svn:author, svn:date"
                    aria-label={`Edit revision properties for r${entry.revision}`}
                  >
                    <PencilLine className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {onLoadMore ? (
        hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-2xs font-semibold text-text-secondary hover:bg-bg-tertiary hover:text-text disabled:cursor-progress disabled:text-text-muted"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Fetching older revisions…
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                Load older revisions
              </>
            )}
          </button>
        ) : (
          <p className="px-3 py-2 text-center text-2xs text-text-muted">
            Beginning of history for this path.
          </p>
        )
      ) : null}
    </div>
  );
}
