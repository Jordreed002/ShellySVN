/**
 * `svn blame` for one file: who last touched each line, in which revision.
 *
 * The distinction that matters: **uncommitted lines have no revision.**
 * `svn blame` on a modified working file attributes your unsaved work to
 * nobody — `BlameLine.revision === null`. Showing that as "r—" in the same grey
 * as everything else invites the reader to believe the line is committed. It is
 * marked, counted and explained instead.
 *
 * The annotation list arrives via props; the one thing this view fetches for
 * itself is the *range comparison* (#71): `svn blame` re-run at two revisions
 * (`rX` and `rY`), so the line-level delta between them can be shown. That
 * needs a target SVN understands — a working-copy path or a full URL — which
 * the `blameUrl` prop supplies; `path` is only a label.
 */

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, GitCompare, Loader2, PencilLine, Users } from 'lucide-react';
import type { SvnBlameLine } from '@shared/types';
import type { BlameLine } from '../types';
import { DetailMessage } from './RepoDetailPane';
import { formatEntryDate } from './RepoContentsRow';
import { compareBlameRanges, type BlameRangeDelta } from '@renderer/lib/blameRange';

export interface BlameViewProps {
  lines: readonly BlameLine[];
  /** Path of the file, used in the empty state. */
  path?: string;
  /**
   * Target the range comparison runs `svn blame` against: a working-copy path
   * or a full repository URL. Falls back to `path`, which only works when the
   * caller passes something SVN itself accepts.
   */
  blameUrl?: string;
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

/** `svn blame` marks uncommitted lines r0/'unknown'; they carry no revision here. */
function toAnnotation(line: SvnBlameLine): BlameLine {
  const committed = typeof line.revision === 'number' && line.revision > 0;
  return {
    revision: committed ? line.revision : null,
    author: committed ? line.author : '',
    date: committed ? line.date : '',
    lineNumber: line.lineNumber,
    content: line.content,
  };
}

function parseRevisionInput(value: string): number | null {
  const trimmed = value.trim().replace(/^r/i, '');
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

export function BlameView({
  lines,
  path,
  blameUrl,
  onRevisionClick,
  highlightRevision = null,
  loading = false,
  error = null,
  className = '',
}: BlameViewProps): React.JSX.Element {
  // ── range comparison state (#71) ──
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [rangeDelta, setRangeDelta] = useState<BlameRangeDelta | null>(null);

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

  // Default the range to the span of revisions actually on screen.
  const revisions = lines
    .map((line) => line.revision)
    .filter((revision): revision is number => revision !== null);
  const oldest = revisions.length > 0 ? Math.min(...revisions) : null;
  const newest = revisions.length > 0 ? Math.max(...revisions) : null;

  const openRange = () => {
    if (!rangeOpen) {
      setRangeOpen(true);
      setRangeError(null);
      if (rangeStart === '' && oldest !== null) setRangeStart(String(oldest));
      if (rangeEnd === '' && newest !== null) setRangeEnd(String(newest));
    }
  };

  const closeRange = () => {
    setRangeOpen(false);
    setRangeDelta(null);
    setRangeError(null);
  };

  const runRangeCompare = async () => {
    const start = parseRevisionInput(rangeStart);
    const end = parseRevisionInput(rangeEnd);
    const target = blameUrl ?? path ?? '';
    if (start === null || end === null || target === '') return;

    if (start >= end) {
      setRangeError('The older revision must be smaller than the newer one — rX before rY.');
      return;
    }

    setRangeLoading(true);
    setRangeError(null);
    setRangeDelta(null);

    try {
      // Annotate the same file as it stood at each revision; the delta
      // between the two annotations is what rX..rY did to it.
      const [atStart, atEnd] = await Promise.all([
        window.api.svn.blame(target, undefined, start),
        window.api.svn.blame(target, undefined, end),
      ]);
      if (atStart.error) throw new Error(atStart.error);
      if (atEnd.error) throw new Error(atEnd.error);

      setRangeDelta(compareBlameRanges(atStart.lines.map(toAnnotation), atEnd.lines.map(toAnnotation)));
    } catch (err) {
      setRangeError(
        (err as Error).message ||
          'svn blame failed for the chosen range. If the target is a repository-relative path, pass the full URL via blameUrl.'
      );
    } finally {
      setRangeLoading(false);
    }
  };

  const canRunRange =
    parseRevisionInput(rangeStart) !== null &&
    parseRevisionInput(rangeEnd) !== null &&
    (blameUrl ?? path ?? '') !== '';

  // ── range comparison result view (#71) ──
  if (rangeDelta) {
    return (
      <div className={`font-mono text-[11.5px] leading-[1.65] ${className}`}>
        <div className="flex items-center justify-between border-b border-border-muted bg-bg-tertiary/60 px-3 py-2 font-sans text-xs">
          <button
            type="button"
            onClick={closeRange}
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to blame
          </button>
          <span className="text-text-secondary">
            r{parseRevisionInput(rangeStart)} → r{parseRevisionInput(rangeEnd)} ·{' '}
            {path ? <span className="font-mono">{path}</span> : 'this file'}
          </span>
        </div>

        <BlameRangeLegend delta={rangeDelta} />

        <ol className="list-none">
          {rangeDelta.rows.map((row) => (
            <BlameRangeRowView
              key={`${row.kind}-${row.lineNumber}`}
              row={row}
              onRevisionClick={onRevisionClick}
            />
          ))}
        </ol>
      </div>
    );
  }

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

      {/* Range comparison bar (#71) */}
      {rangeOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-muted bg-bg-tertiary/40 px-3 py-2 font-sans text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-2xs font-bold uppercase tracking-wide text-text-faint">From</span>
            <input
              type="text"
              inputMode="numeric"
              className="input w-20 py-0.5 font-mono text-xs"
              placeholder={oldest !== null ? String(oldest) : 'r100'}
              value={rangeStart}
              onChange={(event) => setRangeStart(event.target.value)}
              aria-label="Older revision of the blame range"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-2xs font-bold uppercase tracking-wide text-text-faint">To</span>
            <input
              type="text"
              inputMode="numeric"
              className="input w-20 py-0.5 font-mono text-xs"
              placeholder={newest !== null ? String(newest) : 'r200'}
              value={rangeEnd}
              onChange={(event) => setRangeEnd(event.target.value)}
              aria-label="Newer revision of the blame range"
            />
          </label>
          <button
            type="button"
            onClick={() => void runRangeCompare()}
            disabled={!canRunRange || rangeLoading}
            className="btn btn-primary btn-sm text-xs"
            aria-busy={rangeLoading}
          >
            {rangeLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Compare range
          </button>
          <button type="button" onClick={closeRange} className="btn btn-secondary btn-sm text-xs">
            Cancel
          </button>
          {rangeError ? <p className="w-full text-svn-modified">{rangeError}</p> : null}
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-border-muted bg-bg-tertiary/40 px-3 py-1.5 font-sans text-xs">
          <button
            type="button"
            onClick={openRange}
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            Compare blame range
          </button>
          <span className="text-text-muted">
            Which lines changed between two revisions — annotate at rX and rY and diff the two.
          </span>
        </div>
      )}

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

/** Row tint + left rule per delta kind. */
const RANGE_ROW_CLASS: Record<BlameRangeDelta['rows'][number]['kind'], string> = {
  unchanged: 'border-l-2 border-transparent',
  changed: 'border-l-2 border-accent bg-accent/10',
  added: 'border-l-2 border-svn-added bg-svn-added/10',
  removed: 'border-l-2 border-svn-deleted bg-svn-deleted/10',
};

function BlameRangeLegend({ delta }: { delta: BlameRangeDelta }) {
  const items: Array<{ label: string; dot: string; count: number }> = [
    { label: 'changed in range', dot: 'bg-accent', count: delta.counts.changed },
    { label: 'added', dot: 'bg-svn-added', count: delta.counts.added },
    { label: 'removed', dot: 'bg-svn-deleted', count: delta.counts.removed },
    { label: 'unchanged', dot: 'bg-text-faint', count: delta.counts.unchanged },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-muted px-3 py-1.5 font-sans text-2xs text-text-secondary">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-sm ${item.dot}`} aria-hidden="true" />
          {item.count} {item.label}
        </span>
      ))}
    </div>
  );
}

function BlameRangeRowView({
  row,
  onRevisionClick,
}: {
  row: BlameRangeDelta['rows'][number];
  onRevisionClick?: (revision: number) => void;
}) {
  const newest = row.new ?? row.old;
  const previous = row.old;

  const revisionButton = (revision: number | null, key: string) => {
    if (revision === null) return <span key={key} className="pr-2 text-right text-2xs" />;
    return onRevisionClick ? (
      <button
        key={key}
        type="button"
        onClick={() => onRevisionClick(revision)}
        title={`Show what changed in r${revision}`}
        className="pr-2 text-right text-2xs text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        r{revision}
      </button>
    ) : (
      <span key={key} className="pr-2 text-right text-2xs text-accent">
        r{revision}
      </span>
    );
  };

  return (
    <li
      className={`grid grid-cols-[46px_46px_74px_32px_minmax(0,1fr)] items-baseline ${RANGE_ROW_CLASS[row.kind]}`}
    >
      <span className="select-none pr-2 text-right text-2xs text-text-faint">
        {row.lineNumber}
      </span>
      {previous ? (
        revisionButton(previous.revision, 'old')
      ) : (
        <span className="select-none pr-2 text-right text-2xs text-svn-added">new</span>
      )}
      <span className="truncate text-2xs text-text-secondary" title={newest?.author ?? ''}>
        {row.kind === 'removed' ? '(removed)' : (newest?.author ?? '')}
      </span>
      <span className="select-none pr-2 text-right text-2xs text-text-faint">
        {row.kind === 'removed' ? '' : (newest?.lineNumber ?? '')}
      </span>
      <code className="whitespace-pre-wrap break-words pr-3 text-text">
        {(row.new ?? row.old)?.content === '' ? ' ' : ((row.new ?? row.old)?.content ?? '')}
      </code>
    </li>
  );
}
