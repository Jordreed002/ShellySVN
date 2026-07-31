/**
 * `svn blame` for one file: who last touched each line, in which revision.
 *
 * The distinction that matters: **uncommitted lines have no revision.**
 * `svn blame` on a modified working file attributes your unsaved work to
 * nobody — `BlameLine.revision === null`. Showing that as "r—" in the same grey
 * as everything else invites the reader to believe the line is committed. It is
 * marked, counted and explained instead.
 *
 * Presentational only: lines and handlers arrive via props.
 */

import { AlertTriangle, Loader2, PencilLine, Users } from 'lucide-react';
import type { BlameLine } from '../types';
import { DetailMessage } from './RepoDetailPane';
import { formatEntryDate } from './RepoContentsRow';

export interface BlameViewProps {
  lines: readonly BlameLine[];
  /** Path of the file, used in the empty state. */
  path?: string;
  /**
   * Jump to a revision's diff. Committed revisions in the gutter become
   * buttons when supplied; uncommitted lines never do — they have no revision.
   */
  onRevisionClick?: (revision: number) => void;
  /** Tint every line belonging to this revision, e.g. while hovering a log row. */
  highlightRevision?: number | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function BlameView({
  lines,
  path,
  onRevisionClick,
  highlightRevision = null,
  loading = false,
  error = null,
  className = '',
}: BlameViewProps): React.JSX.Element {
  if (loading) {
    return <DetailMessage icon={Loader2} title="Running svn blame…" busy />;
  }

  if (error) {
    return (
      <DetailMessage icon={AlertTriangle} tone="error" title="svn blame failed" detail={error} />
    );
  }

  if (lines.length === 0) {
    return (
      <DetailMessage
        icon={Users}
        title="No blame to show"
        detail={
          <>
            {path ? <b className="font-mono">{path}</b> : 'This entry'} has no line-by-line history
            — it is a directory, a binary file, or has never been committed. Blame only exists for
            versioned text.
          </>
        }
        command={path ? `svn blame "${path}"` : 'svn blame <file>'}
      />
    );
  }

  const uncommitted = lines.reduce(
    (total, line) => (line.revision === null ? total + 1 : total),
    0
  );

  return (
    <div className={`font-mono text-[11.5px] leading-[1.65] ${className}`}>
      {uncommitted > 0 ? (
        <div className="flex items-start gap-2 border-b border-border-muted bg-svn-modified/10 px-3 py-2 font-sans text-xs text-text">
          <PencilLine
            className="mt-0.5 h-3.5 w-3.5 flex-none text-svn-modified"
            aria-hidden="true"
          />
          <span>
            <b className="font-semibold">
              {uncommitted} uncommitted {uncommitted === 1 ? 'line' : 'lines'}
            </b>{' '}
            — marked <span className="text-svn-modified">local</span> because they have no revision.
            They exist only on your disk; nobody else can see them until you commit.
          </span>
        </div>
      ) : null}

      <ol className="list-none">
        {lines.map((line) => {
          const revision = line.revision;
          const local = revision === null;
          const highlighted = highlightRevision !== null && revision === highlightRevision;
          return (
            <li
              key={line.lineNumber}
              className={`grid grid-cols-[46px_74px_32px_minmax(0,1fr)] items-baseline border-l-2 ${
                local ? 'border-svn-modified bg-svn-modified/5' : 'border-transparent'
              } ${highlighted ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}`}
            >
              {revision === null ? (
                <span
                  className="pr-2 text-right text-2xs font-semibold text-svn-modified"
                  title="Uncommitted — this line has no revision"
                >
                  local
                </span>
              ) : onRevisionClick ? (
                <button
                  type="button"
                  onClick={() => onRevisionClick(revision)}
                  title={`Show what changed in r${revision}`}
                  className="pr-2 text-right text-2xs text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  r{revision}
                </button>
              ) : (
                <span className="pr-2 text-right text-2xs text-accent">r{revision}</span>
              )}

              {/* Relative age, like every other date in the app; the exact
                  timestamp stays in the tooltip where it does not cost width. */}
              <span
                className="truncate text-2xs text-text-secondary"
                title={`${line.author} · ${line.date}`}
              >
                {/* An uncommitted line has no date; do not leave the separator
                    dangling after the author. */}
                {[line.author, line.date ? formatEntryDate(line.date) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>

              <span className="select-none pr-2 text-right text-2xs text-text-faint">
                {line.lineNumber}
              </span>

              <code className="whitespace-pre-wrap break-words pr-3 text-text">
                {line.content === '' ? ' ' : line.content}
              </code>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
