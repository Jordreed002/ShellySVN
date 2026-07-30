import type { ReactNode } from 'react';
import { CalendarDays, Clock, Copy, Hash, History, Info } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { LogEntry, PegRevision } from '../types';

/**
 * RevisionPickerDialog — pegs the whole browser to a revision.
 *
 * A peg revision answers "which repository am I looking at?", not "what is on
 * my disk?". The tree, the listings and the properties all show the repository
 * as it was; **no working copy is touched** — nothing is updated, reverted or
 * written to disk. The peg stays applied until it is set back to HEAD, and the
 * address bar keeps saying so until you do.
 *
 * Subversion accepts three forms and this dialog offers exactly those three:
 * `HEAD`, a revision number, and a date in braces — `{2026-06-30}` — which the
 * server resolves to the last revision committed on or before that date.
 */

/** The three peg forms Subversion accepts. Mirrors `PegRevision.kind`. */
export type RevisionPickerMode = 'head' | 'revision' | 'date';

export interface RevisionPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** Path the browser is showing, e.g. `^/clients/acme-corp/website/trunk`. Used in the command hints. */
  path: string;
  /**
   * Latest revision on the server for this path, from `svn info`, when it has
   * been read. `0` or omitted means nobody has measured it — which is not the
   * same as the repository being at r0, so it is reported as unknown rather
   * than printed.
   */
  headRevision?: number;
  /** Author of the head revision, when `svn log -l 1` has been read. */
  headAuthor?: string;
  /** Date of the head revision, shown verbatim. */
  headDate?: string;

  /** Peg currently applied to the browser, so "back to HEAD" is visibly a change. */
  currentPeg: PegRevision;

  /** Which form is selected in the dialog. */
  mode: RevisionPickerMode;
  onModeChange: (mode: RevisionPickerMode) => void;

  /** Revision number as typed, e.g. `4712`. Kept as text so a half-typed number is not lost. */
  revisionValue: string;
  onRevisionValueChange: (value: string) => void;

  /** Date as typed, without braces, e.g. `2026-06-30`. The braces are Subversion's, and are added for you. */
  dateValue: string;
  onDateValueChange: (value: string) => void;

  /** Recent revisions from `svn log` on this path, newest first. Clicking one fills the revision field. */
  recent?: LogEntry[];

  /** Applies the peg to the whole browser. */
  onApply: (peg: PegRevision) => void;
  onCopyCommand?: (command: string) => void;
  isBusy?: boolean;
}

function pegLabel(peg: PegRevision): string {
  switch (peg.kind) {
    case 'revision':
      return `r${peg.revision}`;
    case 'date':
      return `{${peg.date}}`;
    default:
      return 'HEAD';
  }
}

/** The revision argument as `svn` spells it. */
function pegArgument(peg: PegRevision): string {
  switch (peg.kind) {
    case 'revision':
      return String(peg.revision);
    case 'date':
      return `{${peg.date}}`;
    default:
      return 'HEAD';
  }
}

function parseRevision(value: string): number | null {
  const trimmed = value.trim().replace(/^r/i, '');
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

/** `{2026-06-30}` is Subversion's date syntax. The braces are added here, not typed. */
function normalizeDate(value: string): string {
  return value.trim().replace(/^\{/, '').replace(/\}$/, '');
}

function resolvePeg(
  mode: RevisionPickerMode,
  revisionValue: string,
  dateValue: string
): PegRevision | null {
  if (mode === 'head') return { kind: 'head' };
  if (mode === 'revision') {
    const revision = parseRevision(revisionValue);
    return revision === null ? null : { kind: 'revision', revision };
  }
  const date = normalizeDate(dateValue);
  return date.length === 0 ? null : { kind: 'date', date };
}

function ModeOption({
  selected,
  icon,
  title,
  detail,
  command,
  onSelect,
  children,
}: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  command: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={`mb-2 rounded-xl border p-3 last:mb-0 ${
        selected ? 'border-accent bg-accent/10' : 'border-border bg-bg-tertiary/40'
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="peg-revision-mode"
          className="mt-1 flex-none accent-accent"
          checked={selected}
          onChange={onSelect}
        />
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 text-[13px] font-bold text-text">
            {icon}
            {title}
          </b>
          <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">{detail}</small>
          <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
            {command}
          </code>
        </span>
      </label>
      {children && <div className="mt-2.5 pl-7">{children}</div>}
    </div>
  );
}

export function RevisionPickerDialog({
  isOpen,
  onClose,
  path,
  headRevision,
  headAuthor,
  headDate,
  currentPeg,
  mode,
  onModeChange,
  revisionValue,
  onRevisionValueChange,
  dateValue,
  onDateValueChange,
  recent = [],
  onApply,
  onCopyCommand,
  isBusy = false,
}: RevisionPickerDialogProps) {
  const peg = resolvePeg(mode, revisionValue, dateValue);
  const command = `svn ls ${path}@${peg === null ? '…' : pegArgument(peg)}`;
  const unchanged = peg !== null && pegLabel(peg) === pegLabel(currentPeg);
  const badRevision =
    mode === 'revision' && revisionValue.trim() !== '' && parseRevision(revisionValue) === null;

  const knownHead = typeof headRevision === 'number' && headRevision > 0 ? headRevision : null;
  const headSummary =
    knownHead === null
      ? 'Re-read from the server every time you navigate; its number is not known until then.'
      : headAuthor && headDate
        ? `Currently r${knownHead}, committed ${headDate} by ${headAuthor}.`
        : `Currently r${knownHead}.`;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Browse the repository at a revision"
      size="md"
      description="Choose a peg revision for the whole browser — HEAD, a revision number, or a date. No working copy is affected."
    >
      <AccessibleDialogBody>
        <div className="flex items-start gap-2.5">
          <History className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-text-secondary">
            The tree, the listings and the properties all show the repository as it was.{' '}
            <b className="font-semibold text-text">Your working copies are untouched</b> — nothing is
            updated, reverted or written to disk.
          </p>
        </div>
        <p className="mb-4 mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          {path} · now browsing at {pegLabel(currentPeg)}
        </p>

        <ModeOption
          selected={mode === 'head'}
          icon={<Clock className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />}
          title="HEAD — latest"
          detail={`The newest revision on the server, re-read every time you navigate. ${headSummary}`}
          command={`svn ls ${path}@HEAD`}
          onSelect={() => onModeChange('head')}
        />

        <ModeOption
          selected={mode === 'revision'}
          icon={<Hash className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />}
          title="A specific revision"
          detail="One revision number, applied to every path in the browser. Paths that did not exist at that revision simply do not appear."
          command={`svn ls ${path}@${parseRevision(revisionValue) ?? '4712'}`}
          onSelect={() => onModeChange('revision')}
        >
          <label className="block">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wide text-text-faint">
              Revision number
            </span>
            <input
              type="text"
              inputMode="numeric"
              className="input font-mono text-xs"
              placeholder="4712"
              value={revisionValue}
              onChange={(event) => onRevisionValueChange(event.target.value)}
              onFocus={() => onModeChange('revision')}
            />
          </label>
          {badRevision && (
            <p className="mt-1 text-[11px] text-svn-modified">
              Not a revision number — Subversion wants a positive integer, such as{' '}
              <span className="font-mono">4712</span>.
            </p>
          )}
          {recent.length > 0 && (
            <ul className="mt-2 list-none overflow-hidden rounded-lg border border-border">
              {recent.map((entry) => (
                <li key={entry.revision} className="border-b border-border-muted last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-bg-elevated"
                    onClick={() => {
                      onModeChange('revision');
                      onRevisionValueChange(String(entry.revision));
                    }}
                  >
                    <span className="w-12 flex-none font-mono text-[11px] text-accent">
                      r{entry.revision}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b
                        className="block truncate text-xs font-semibold text-text"
                        title={entry.message}
                      >
                        {entry.message}
                      </b>
                      <small className="block truncate text-[11px] text-text-muted">
                        {entry.author} · {entry.date}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ModeOption>

        <ModeOption
          selected={mode === 'date'}
          icon={<CalendarDays className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />}
          title="A date"
          detail="Subversion resolves a date to the last revision committed on or before it. Useful when you know when something broke, but not which revision did it."
          command={`svn ls ${path}@{${normalizeDate(dateValue) || '2026-06-30'}}`}
          onSelect={() => onModeChange('date')}
        >
          <label className="block">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wide text-text-faint">
              Date — the braces are Subversion&rsquo;s, and are added for you
            </span>
            <input
              type="text"
              className="input font-mono text-xs"
              placeholder="2026-06-30"
              value={dateValue}
              onChange={(event) => onDateValueChange(event.target.value)}
              onFocus={() => onModeChange('date')}
            />
          </label>
        </ModeOption>

        <div className="mt-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block overflow-x-auto whitespace-pre font-mono text-[11px] text-text-secondary">
                {command}
              </code>
            </div>
            {onCopyCommand && (
              <button
                type="button"
                onClick={() => onCopyCommand(command)}
                className="btn-icon-sm flex-none"
                aria-label="Copy the listing command"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          Peg revisions apply to the whole browser until you set it back to HEAD.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isBusy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (peg !== null) onApply(peg);
          }}
          className="btn btn-primary"
          disabled={isBusy || peg === null || unchanged}
          aria-busy={isBusy}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          {isBusy
            ? 'Loading…'
            : unchanged
              ? `Already at ${pegLabel(currentPeg)}`
              : `Browse at ${peg === null ? '…' : pegLabel(peg)}`}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default RevisionPickerDialog;
