/**
 * Unified diff for the repository browser.
 *
 * Two things this deliberately gets right:
 *
 * 1. **Conflict markers are not additions.** `<<<<<<< .mine`, `=======` and
 *    `>>>>>>> .rN` are Subversion's own text written into your file; a diff
 *    tool that tints them green is telling you someone added seven angle
 *    brackets. They get their own treatment and a one-line explanation.
 * 2. **Long lines wrap.** Minified CSS or a long string must not put the whole
 *    pane on a horizontal scrollbar; the code column wraps within its cell.
 *
 * Presentational only — the route supplies the hunks. The diff shapes are the
 * app's existing `SvnDiffHunk`/`SvnDiffLine` from `@shared/types`, so
 * `window.api.svn.diff()` output can be handed straight in.
 */

import { AlertTriangle, Binary, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import type { SvnDiffHunk, SvnDiffLine } from '@shared/types';
import { DetailMessage } from './RepoDetailPane';

/** How a single row is rendered. `conflict` is not an ordinary addition. */
export type DiffRowKind = 'context' | 'added' | 'removed' | 'conflict';

/**
 * True for the three markers Subversion writes into a conflicted file.
 * Pure, exported for tests and for any other view that renders file text.
 */
export function isConflictMarkerLine(content: string): boolean {
  return /^(<{7}|={7}|>{7})(\s|$)/.test(content);
}

/** Classify a parsed diff line for rendering. */
export function classifyDiffLine(line: SvnDiffLine): DiffRowKind {
  if (isConflictMarkerLine(line.content)) return 'conflict';
  if (line.type === 'added') return 'added';
  if (line.type === 'removed') return 'removed';
  return 'context';
}

/**
 * `@@ -142,7 +142,9 @@`. Prefers the header text SVN emitted (it often carries
 * the enclosing function name) and falls back to the hunk's own numbers.
 */
export function formatHunkHeader(hunk: SvnDiffHunk): string {
  const emitted = hunk.lines.find((line) => line.type === 'hunk');
  if (emitted && emitted.content.trim().length > 0) return emitted.content.trim();
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/** Added/removed counts, ignoring headers and conflict markers. */
export function countDiffChanges(hunks: readonly SvnDiffHunk[]): {
  added: number;
  removed: number;
  conflicts: number;
} {
  let added = 0;
  let removed = 0;
  let conflicts = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const kind = classifyDiffLine(line);
      if (kind === 'added') added += 1;
      else if (kind === 'removed') removed += 1;
      else if (kind === 'conflict') conflicts += 1;
    }
  }
  return { added, removed, conflicts };
}

/** Every row carries the left rule so conflict rows do not shift the gutters. */
const ROW_CLASS: Record<DiffRowKind, string> = {
  context: 'border-l-2 border-transparent',
  added: 'border-l-2 border-transparent bg-svn-added/10',
  removed: 'border-l-2 border-transparent bg-svn-deleted/10',
  conflict: 'border-l-2 border-svn-conflict bg-svn-conflict/15',
};

const MARKER_CLASS: Record<DiffRowKind, string> = {
  context: 'text-text-faint',
  added: 'text-svn-added',
  removed: 'text-svn-deleted',
  conflict: 'text-svn-conflict',
};

const MARKER_GLYPH: Record<DiffRowKind, string> = {
  context: ' ',
  added: '+',
  removed: '−',
  conflict: '!',
};

const CODE_CLASS: Record<DiffRowKind, string> = {
  context: 'text-text',
  added: 'text-text',
  removed: 'text-text',
  conflict: 'text-svn-conflict font-semibold',
};

export interface DiffViewProps {
  /** Hunks for the single file on screen. */
  hunks: readonly SvnDiffHunk[];
  /** Path of the file, used in the empty states. */
  path?: string;
  /** SVN reported the file as binary — there is no text diff to show. */
  isBinary?: boolean;
  /**
   * What this diff compares, already formatted (e.g. `working copy ↔ BASE r4821`).
   * Used so the empty states say what the file is unmodified *against*.
   */
  comparisonLabel?: string;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function DiffView({
  hunks,
  path,
  isBinary = false,
  comparisonLabel,
  loading = false,
  error = null,
  className = '',
}: DiffViewProps): React.JSX.Element {
  if (loading) {
    return <DetailMessage icon={Loader2} title="Running svn diff…" busy />;
  }

  if (error) {
    return (
      <DetailMessage icon={AlertTriangle} tone="error" title="svn diff failed" detail={error} />
    );
  }

  if (isBinary) {
    return (
      <DetailMessage
        icon={Binary}
        title="Binary file"
        detail={
          <>
            Subversion records that {path ? <b className="font-mono">{path}</b> : 'this file'}{' '}
            changed but has no line-based diff for it. Compare the revisions with an external tool,
            or check the size and checksum in Properties.
          </>
        }
        command={path ? `svn diff --diff-cmd=<tool> "${path}"` : 'svn diff --diff-cmd=<tool>'}
      />
    );
  }

  const rows = hunks.filter((hunk) => hunk.lines.length > 0);

  if (rows.length === 0) {
    return (
      <DetailMessage
        icon={CheckCircle2}
        title="No differences"
        detail={
          <>
            {path ? <b className="font-mono">{path}</b> : 'This file'} is identical across{' '}
            <span className="font-mono">{comparisonLabel ?? 'the selected comparison'}</span>.
            Another comparison may still show changes — a file unmodified against BASE can still be
            behind HEAD.
          </>
        }
      />
    );
  }

  const { conflicts } = countDiffChanges(rows);

  return (
    <div className={`font-mono text-[11.5px] leading-[1.65] ${className}`}>
      {conflicts > 0 ? (
        <div className="flex items-start gap-2 border-b border-svn-conflict/40 bg-svn-conflict/10 px-3 py-2 font-sans text-xs text-text">
          <ShieldAlert
            className="mt-0.5 h-3.5 w-3.5 flex-none text-svn-conflict"
            aria-hidden="true"
          />
          <span>
            <b className="font-semibold">Conflict markers in the file.</b> The{' '}
            <span className="font-mono">{'<<<<<<<'}</span>,{' '}
            <span className="font-mono">=======</span> and{' '}
            <span className="font-mono">{'>>>>>>>'}</span> lines were written by Subversion, not by
            anyone — both sides changed these lines. Edit the file, then{' '}
            <span className="font-mono">svn resolve --accept working</span>.
          </span>
        </div>
      ) : null}

      {rows.map((hunk, hunkIndex) => (
        <div key={`hunk-${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          <div className="my-1 border-y border-border-muted bg-accent/10 px-3 py-1 text-2xs text-accent">
            {formatHunkHeader(hunk)}
          </div>
          {hunk.lines
            .filter((line) => line.type !== 'hunk' && line.type !== 'header')
            .map((line, lineIndex) => {
              const kind = classifyDiffLine(line);
              return (
                <div
                  key={`line-${hunkIndex}-${lineIndex}`}
                  className={`grid grid-cols-[32px_32px_14px_minmax(0,1fr)] items-baseline ${ROW_CLASS[kind]}`}
                >
                  <span className="select-none pr-2 text-right text-2xs text-text-faint">
                    {kind === 'conflict' ? '' : (line.oldLineNumber ?? '')}
                  </span>
                  <span className="select-none pr-2 text-right text-2xs text-text-faint">
                    {kind === 'conflict' ? '' : (line.newLineNumber ?? '')}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`select-none text-center ${MARKER_CLASS[kind]}`}
                  >
                    {MARKER_GLYPH[kind]}
                  </span>
                  <code className={`whitespace-pre-wrap break-words pr-3 ${CODE_CLASS[kind]}`}>
                    {line.content === '' ? ' ' : line.content}
                  </code>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
