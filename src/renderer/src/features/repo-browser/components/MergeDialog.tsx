import { AlertTriangle, Copy, FlaskConical, GitMerge, Info } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { LogEntry } from '../types';

/**
 * MergeDialog — merge is not a verb here, it is a question.
 *
 * Subversion records what has already been merged in `svn:mergeinfo`, so it can
 * answer the only question that matters: **which revisions on the source have
 * not landed here yet**. Those revisions are the content of this dialog; the
 * modes below are just three different things you can do with them.
 *
 * A dry run is always offered first, because `svn merge` writes to the working
 * copy and `--dry-run` reports the same conflicts without touching a file.
 */

/** The three merges Subversion actually performs. They are not interchangeable. */
export type MergeMode = 'sync' | 'reintegrate' | 'record-only';

export interface MergeDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** Merge source, e.g. `^/clients/acme/website/trunk`. */
  sourceUrl: string;
  /** Working copy being merged into, e.g. `~/wc/acme-website`. */
  targetPath: string;
  /** Branch URL used for a reintegrate; defaults to the working copy's own URL text. */
  branchUrl?: string;

  /** `svn mergeinfo --show-revs eligible` plus `svn log` on the source. */
  eligible: LogEntry[];
  /** Revision → paths it touches that you have modified locally. A conflict risk. */
  conflictRisks?: Record<number, string[]>;

  mode: MergeMode;
  onModeChange: (mode: MergeMode) => void;

  /**
   * Revisions ticked for a record-only merge. When undefined every eligible
   * revision is included, which is what a sync merge does.
   */
  selectedRevisions?: number[];
  onToggleRevision?: (revision: number) => void;

  /** Reintegrate requires the branch to be fully synced with trunk first. */
  reintegrateReady?: boolean;
  /** Why reintegrate is unavailable, shown verbatim when `reintegrateReady` is false. */
  reintegrateBlockedReason?: string;

  /** `svn merge --dry-run …` — reports conflicts, changes nothing. */
  onDryRun: () => void;
  /** The real merge. Destructive: it writes to the working copy. */
  onMerge: () => void;
  onCopyCommand?: (command: string) => void;

  /** Output of the last dry run, if one has been performed. */
  dryRunOutput?: string | null;
  isRunning?: boolean;
}

interface ModeCopy {
  title: string;
  detail: string;
}

const MODE_COPY: Record<MergeMode, ModeCopy> = {
  sync: {
    title: 'Sync merge — bring the source’s changes in',
    detail:
      'The routine direction on a long-lived branch: source → this working copy. Merges every eligible revision below and leaves the result uncommitted so you can review it.',
  },
  reintegrate: {
    title: 'Reintegrate — put this branch back on trunk',
    detail:
      'Run once, from a trunk working copy, when the branch is finished. It requires the branch to be fully synced with trunk first, otherwise Subversion refuses.',
  },
  'record-only': {
    title: 'Record only — mark as merged without changing files',
    detail:
      'For revisions you deliberately do not want. It writes svn:mergeinfo and nothing else, so those revisions stop appearing as eligible.',
  },
};

function formatRevisionList(revisions: number[]): string {
  if (revisions.length === 0) return '<none selected>';
  return revisions.join(',');
}

/**
 * Stands in for the merge source until one is chosen.
 *
 * Subversion cannot infer a merge source, and a command built without one is
 * not a command you could run: `svn merge <wc> <wc>` reads as reintegrating a
 * branch into itself. Showing the gap is the honest option.
 */
export const MERGE_SOURCE_PLACEHOLDER = '<source>';

function buildCommand(
  mode: MergeMode,
  sourceUrl: string,
  targetPath: string,
  branchUrl: string,
  revisions: number[],
  dryRun: boolean
): string {
  const flag = dryRun ? ' --dry-run' : '';
  switch (mode) {
    case 'sync':
      return `svn merge${flag} ${sourceUrl} ${targetPath}`;
    case 'reintegrate':
      return `svn merge${flag} ${branchUrl} ${targetPath}`;
    case 'record-only':
      return `svn merge --record-only${flag} -c ${formatRevisionList(revisions)} ${sourceUrl} ${targetPath}`;
  }
}

function ModeOption({
  mode,
  selected,
  disabled,
  disabledReason,
  command,
  onSelect,
}: {
  mode: MergeMode;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  command: string;
  onSelect: () => void;
}) {
  const copy = MODE_COPY[mode];
  return (
    <label
      className={`mb-2 flex cursor-pointer items-start gap-3 rounded-xl border p-3 last:mb-0 ${
        selected
          ? 'border-accent bg-accent/10'
          : 'border-border bg-bg-tertiary/40 hover:border-border-focus'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="radio"
        name="merge-mode"
        className="mt-1 flex-none accent-accent"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] font-bold text-text">{copy.title}</b>
        <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
          {copy.detail}
        </small>
        {disabled && disabledReason && (
          <small className="mt-1 block text-xs text-svn-modified">{disabledReason}</small>
        )}
        <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          {command}
        </code>
      </span>
    </label>
  );
}

function EligibleRow({
  entry,
  risks,
  selectable,
  selected,
  onToggle,
}: {
  entry: LogEntry;
  risks: string[];
  selectable: boolean;
  selected: boolean;
  onToggle?: (revision: number) => void;
}) {
  const hasRisk = risks.length > 0;
  return (
    <li className="flex items-center gap-2.5 border-b border-border-muted px-3 py-2 last:border-b-0">
      {selectable && (
        <input
          type="checkbox"
          className="flex-none accent-accent"
          checked={selected}
          onChange={() => onToggle?.(entry.revision)}
          aria-label={`Include r${entry.revision} in the record-only merge`}
        />
      )}
      <span className="w-12 flex-none font-mono text-[11px] text-accent">r{entry.revision}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-xs font-semibold text-text" title={entry.message}>
          {entry.message}
        </b>
        <small className="block truncate text-[11px] text-text-muted">
          {entry.author} · {entry.date} · {entry.changedPaths}{' '}
          {entry.changedPaths === 1 ? 'file' : 'files'}
          {hasRisk && (
            <>
              {' — '}
              <b className="font-semibold text-svn-conflict">
                you have local edits in {risks.join(', ')}
              </b>
            </>
          )}
        </small>
      </span>
      {hasRisk && (
        <AlertTriangle
          className="h-3.5 w-3.5 flex-none text-svn-conflict"
          aria-label={`r${entry.revision} touches files you have modified locally — conflict risk`}
        />
      )}
    </li>
  );
}

export function MergeDialog({
  isOpen,
  onClose,
  sourceUrl,
  targetPath,
  branchUrl,
  eligible,
  conflictRisks = {},
  mode,
  onModeChange,
  selectedRevisions,
  onToggleRevision,
  reintegrateReady = true,
  reintegrateBlockedReason,
  onDryRun,
  onMerge,
  onCopyCommand,
  dryRunOutput = null,
  isRunning = false,
}: MergeDialogProps) {
  /*
   * With no source there is nothing to merge *from*, so every command below is
   * hypothetical and both actions are refused. Falling back to the target — as
   * this did — produced `svn merge <wc> <wc>`, which is a different operation
   * entirely and would have been run by the primary button.
   */
  const hasSource = sourceUrl.trim().length > 0;
  const effectiveSource = hasSource ? sourceUrl : MERGE_SOURCE_PLACEHOLDER;
  const resolvedBranchUrl = branchUrl ?? (hasSource ? sourceUrl : MERGE_SOURCE_PLACEHOLDER);
  const allRevisions = eligible.map((entry) => entry.revision);
  const chosen = selectedRevisions ?? allRevisions;
  const recordOnly = mode === 'record-only';
  const mergeRevisions = recordOnly ? chosen : allRevisions;
  const riskyCount = eligible.filter(
    (entry) => (conflictRisks[entry.revision] ?? []).length > 0
  ).length;

  const command = buildCommand(
    mode,
    effectiveSource,
    targetPath,
    resolvedBranchUrl,
    mergeRevisions,
    false
  );
  const dryRunCommand = buildCommand(
    mode,
    effectiveSource,
    targetPath,
    resolvedBranchUrl,
    mergeRevisions,
    true
  );

  const nothingToDo = mergeRevisions.length === 0 && mode !== 'reintegrate';
  const mergeDisabled =
    isRunning || !hasSource || nothingToDo || (mode === 'reintegrate' && !reintegrateReady);

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Merge into this working copy"
      size="lg"
      description="Eligible revisions from the merge source, and the three merge modes Subversion supports."
    >
      <AccessibleDialogBody>
        <p className="text-xs leading-relaxed text-text-secondary">
          Subversion records what has already been merged in{' '}
          <span className="font-mono text-[11px] text-text">svn:mergeinfo</span>, so it can answer
          the only question that matters:{' '}
          <b className="font-semibold text-text">
            which revisions on the source have not landed here yet
          </b>
          .
        </p>
        {hasSource ? (
          <p className="mb-4 mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
            from {sourceUrl} → {targetPath}
          </p>
        ) : (
          <p className="mb-4 mt-1.5 flex items-start gap-2 rounded-lg border border-svn-modified/40 bg-svn-modified/10 px-3 py-2 text-xs leading-relaxed text-text-secondary">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 flex-none text-svn-modified"
              aria-hidden="true"
            />
            <span>
              <b className="font-semibold text-text">No merge source chosen.</b> Subversion merges{' '}
              <i>from</i> a named branch, and cannot infer which one — so the commands below show{' '}
              <span className="font-mono text-[11px] text-text">{MERGE_SOURCE_PLACEHOLDER}</span>{' '}
              where the branch will go, and nothing can run yet. Open this from a branch to fill it
              in.
            </span>
          </p>
        )}

        <ModeOption
          mode="sync"
          selected={mode === 'sync'}
          disabled={false}
          command={buildCommand(
            'sync',
            effectiveSource,
            targetPath,
            resolvedBranchUrl,
            allRevisions,
            false
          )}
          onSelect={() => onModeChange('sync')}
        />
        <ModeOption
          mode="reintegrate"
          selected={mode === 'reintegrate'}
          disabled={!reintegrateReady}
          disabledReason={
            reintegrateBlockedReason ??
            'Unavailable: the branch is not fully synced with trunk. Run a sync merge and commit it first.'
          }
          command={buildCommand(
            'reintegrate',
            sourceUrl,
            targetPath,
            resolvedBranchUrl,
            allRevisions,
            false
          )}
          onSelect={() => onModeChange('reintegrate')}
        />
        <ModeOption
          mode="record-only"
          selected={recordOnly}
          disabled={false}
          command={buildCommand(
            'record-only',
            effectiveSource,
            targetPath,
            resolvedBranchUrl,
            chosen,
            false
          )}
          onSelect={() => onModeChange('record-only')}
        />

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-2xs font-bold uppercase tracking-wide text-text-faint">
              {eligible.length} eligible {eligible.length === 1 ? 'revision' : 'revisions'}
            </span>
            {riskyCount > 0 && (
              <span className="text-2xs text-svn-conflict">
                {riskyCount} {riskyCount === 1 ? 'touches a file' : 'touch files'} you have modified
                locally
              </span>
            )}
          </div>

          {eligible.length === 0 ? (
            <p className="rounded-xl border border-border bg-bg-tertiary/40 p-3 text-xs leading-relaxed text-text-secondary">
              <span className="font-mono text-[11px] text-text">
                svn mergeinfo --show-revs eligible
              </span>{' '}
              returns nothing: every revision on the source has already been merged here, or the
              source has no mergeinfo relationship with this path.
            </p>
          ) : (
            <ul className="list-none overflow-hidden rounded-xl border border-border">
              {eligible.map((entry) => (
                <EligibleRow
                  key={entry.revision}
                  entry={entry}
                  risks={conflictRisks[entry.revision] ?? []}
                  selectable={recordOnly && Boolean(onToggleRevision)}
                  selected={chosen.includes(entry.revision)}
                  onToggle={onToggleRevision}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {command}
              </code>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-muted">
                {dryRunCommand}
              </code>
            </div>
            {onCopyCommand && (
              <button
                type="button"
                onClick={() => onCopyCommand(command)}
                className="btn-icon-sm flex-none"
                aria-label="Copy the merge command"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {dryRunOutput !== null && (
            <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border-muted bg-bg p-2 font-mono text-[11px] text-text-secondary">
              {dryRunOutput}
            </pre>
          )}
        </div>
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          <b className="font-semibold text-text-secondary">Dry run first</b> — reports conflicts
          without touching your files.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isRunning}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onDryRun}
          className="btn btn-secondary"
          /* Nothing to dry-run against without a source, either. */
          disabled={isRunning || !hasSource}
          title={hasSource ? undefined : 'Choose a merge source first'}
        >
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          Dry run
        </button>
        <button
          type="button"
          onClick={onMerge}
          className="btn btn-primary"
          disabled={mergeDisabled}
          aria-busy={isRunning}
          title={hasSource ? undefined : 'Choose a merge source first'}
        >
          <GitMerge className="h-4 w-4" aria-hidden="true" />
          {isRunning
            ? 'Merging…'
            : mode === 'reintegrate'
              ? 'Reintegrate branch'
              : recordOnly
                ? `Record ${mergeRevisions.length} as merged`
                : `Merge ${mergeRevisions.length} ${mergeRevisions.length === 1 ? 'revision' : 'revisions'}`}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default MergeDialog;
