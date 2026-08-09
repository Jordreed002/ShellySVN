import { AlertTriangle, Copy, GitBranch, Info, Link2, Tag } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { WorkingCopyState } from '../types';

/**
 * SwitchDialog — `svn switch` points an existing working copy at a different
 * URL in the same repository.
 *
 * It is not a checkout: no second copy appears on disk, and the two things that
 * surprise people are stated on screen rather than discovered afterwards.
 *
 *  1. **Local modifications are carried across.** Uncommitted edits are not
 *     stashed, discarded or committed — Subversion re-applies them against the
 *     new target, and where the new target has moved underneath them you get a
 *     conflict, exactly as an update would.
 *  2. **A tag is a directory.** Nothing in Subversion stops you switching to
 *     one or committing to it; tags are read-only by convention only, and this
 *     dialog says so at the point where it matters.
 */

/** Where a candidate target sits in the repository's conventional layout. */
export type SwitchTargetKind = 'trunk' | 'branch' | 'tag';

/** A candidate `svn switch` target, supplied by the route from `svn list`. */
export interface SwitchTarget {
  /** Full URL, or `^/…` repository-relative. Passed verbatim to `svn switch`. */
  url: string;
  /** How the path is shown, usually the tail: `…/website/branches/feature/payments-v2`. */
  label: string;
  kind: SwitchTargetKind;
  /** Last changed revision on that path. */
  revision?: number;
  /** Last committer on that path. */
  author?: string;
  /** Last commit date, shown verbatim. */
  date?: string;
}

/** Either one of the candidates, or the free-text URL field. */
export type SwitchSelection = { kind: 'target'; url: string } | { kind: 'url' };

export interface SwitchDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** The working copy being switched — supplies the local path, current URL and rollup. */
  workingCopy: WorkingCopyState;
  /** Current target, shown before anything is chosen. Defaults to `workingCopy.url`. */
  currentUrl?: string;

  /** Candidate targets — trunk, branches and tags under this path. */
  targets: SwitchTarget[];
  /** Total branches in the repository, when more exist than are listed. */
  branchCount?: number;
  /** Total tags in the repository, when more exist than are listed. */
  tagCount?: number;

  selection: SwitchSelection;
  onSelectionChange: (selection: SwitchSelection) => void;

  /** Free-text URL, used when `selection.kind === 'url'`. */
  customUrl: string;
  onCustomUrlChange: (value: string) => void;

  /** `svn switch <url> <localPath>`. Rewrites the working copy in place. */
  onSwitch: (url: string) => void;
  onCopyCommand?: (command: string) => void;
  isBusy?: boolean;
}

function kindIcon(kind: SwitchTargetKind) {
  return kind === 'tag' ? (
    <Tag className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
  ) : (
    <GitBranch className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
  );
}

function targetMeta(target: SwitchTarget): string {
  const parts: string[] = [];
  if (target.author) parts.push(target.author);
  if (target.revision !== undefined) parts.push(`r${target.revision}`);
  if (target.date) parts.push(target.date);
  return parts.join(' · ');
}

/** Reads "12 modified, 1 conflicted" out of the rollup, in Subversion's words. */
function describeLocalChanges(workingCopy: WorkingCopyState): string {
  const { modified, added, conflicted } = workingCopy.rollup;
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (added > 0) parts.push(`${added} added`);
  if (conflicted > 0) parts.push(`${conflicted} conflicted`);
  return parts.join(', ');
}

function TargetRow({
  target,
  selected,
  onSelect,
  command,
}: {
  target: SwitchTarget;
  selected: boolean;
  onSelect: () => void;
  command: string;
}) {
  const isTag = target.kind === 'tag';
  const meta = targetMeta(target);
  return (
    <label
      className={`mb-2 flex cursor-pointer items-start gap-3 rounded-xl border p-3 last:mb-0 ${
        selected
          ? 'border-accent bg-accent/10'
          : 'border-border bg-bg-tertiary/40 hover:border-border-focus'
      }`}
    >
      <input
        type="radio"
        name="switch-target"
        className="mt-1 flex-none accent-accent"
        checked={selected}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <b className="flex items-center gap-1.5 text-[13px] font-bold text-text">
          {kindIcon(target.kind)}
          <span
            className="min-w-0 flex-1 truncate"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={target.url}
          >
            <bdi>{target.label}</bdi>
          </span>
        </b>
        <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
          {meta}
          {isTag && (
            <>
              {meta && ' · '}
              <span className="text-svn-modified">tags are conventionally read-only</span>
            </>
          )}
        </small>
        <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          {command}
        </code>
      </span>
    </label>
  );
}

export function SwitchDialog({
  isOpen,
  onClose,
  workingCopy,
  currentUrl,
  targets,
  branchCount,
  tagCount,
  selection,
  onSelectionChange,
  customUrl,
  onCustomUrlChange,
  onSwitch,
  onCopyCommand,
  isBusy = false,
}: SwitchDialogProps) {
  const from = currentUrl ?? workingCopy.url;
  const usingUrlField = selection.kind === 'url';
  const chosenUrl = (usingUrlField ? customUrl.trim() : selection.url).trim();
  const selectedTarget = targets.find((target) => target.url === chosenUrl);
  const switchingToTag = selectedTarget?.kind === 'tag';
  const isCurrent = chosenUrl !== '' && chosenUrl === from;
  const localChanges = describeLocalChanges(workingCopy);
  const changedCount =
    workingCopy.rollup.modified + workingCopy.rollup.added + workingCopy.rollup.conflicted;

  const command = `svn switch ${chosenUrl === '' ? '<url>' : chosenUrl} ${workingCopy.localPath}`;
  const canSwitch = !isBusy && chosenUrl !== '' && !isCurrent;

  const footerCounts = [
    branchCount === undefined
      ? null
      : `${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}`,
    tagCount === undefined ? null : `${tagCount} ${tagCount === 1 ? 'tag' : 'tags'}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <AccessibleDialog isOpen={isOpen} onClose={onClose} title="Switch working copy" size="md">
      <AccessibleDialogBody>
        <div className="flex items-start gap-2.5">
          <GitBranch className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-text-secondary">
            Points <span className="font-mono text-[11px] text-text">{workingCopy.localPath}</span>{' '}
            at a different URL in the same repository. No second copy appears on disk, and{' '}
            <b className="font-semibold text-text">
              your {changedCount > 0 ? `${changedCount} ` : ''}local{' '}
              {changedCount === 1 ? 'modification is' : 'modifications are'} carried across
            </b>{' '}
            — they are re-applied against the new target, and can conflict there exactly as an
            update would.
          </p>
        </div>
        <p className="mb-4 mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          {workingCopy.localPath} → {from} @ r{workingCopy.baseRevision}
          {localChanges && ` · ${localChanges}`}
        </p>

        <div className="mb-2 text-2xs font-bold uppercase tracking-wide text-text-faint">
          Current target
        </div>
        <div className="mb-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <b
            className="block truncate font-mono text-xs text-text"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={from}
          >
            <bdi>{from}</bdi>
          </b>
          <small className="mt-0.5 block text-xs text-text-secondary">
            BASE r{workingCopy.baseRevision} · HEAD r{workingCopy.headRevision} · depth{' '}
            {workingCopy.depth}
            {localChanges && ` · ${localChanges}`}
          </small>
        </div>

        <div className="mb-2 text-2xs font-bold uppercase tracking-wide text-text-faint">
          Switch to
        </div>

        {targets.length === 0 ? (
          <p className="rounded-xl border border-border bg-bg-tertiary/40 p-3 text-xs leading-relaxed text-text-secondary">
            No branches or tags were listed for this path. Type a URL below, or run{' '}
            <span className="font-mono text-[11px] text-text">svn ls ^/…/branches</span> to see what
            exists.
          </p>
        ) : (
          targets.map((target) => (
            <TargetRow
              key={target.url}
              target={target}
              selected={!usingUrlField && selection.url === target.url}
              onSelect={() => onSelectionChange({ kind: 'target', url: target.url })}
              command={`svn switch ${target.url} ${workingCopy.localPath}`}
            />
          ))
        )}

        <div
          className={`mt-2 rounded-xl border p-3 ${
            usingUrlField
              ? 'border-accent bg-accent/10'
              : 'border-border bg-bg-tertiary/40 hover:border-border-focus'
          }`}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="switch-target"
              className="mt-1 flex-none accent-accent"
              checked={usingUrlField}
              onChange={() => onSelectionChange({ kind: 'url' })}
            />
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-1.5 text-[13px] font-bold text-text">
                <Link2 className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
                {/* "Or" only makes sense when there was something to choose
                    before it; with no branches listed this is the only option. */}
                {targets.length > 0 ? 'Or a URL' : 'A URL in this repository'}
              </b>
              <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                Any path in this repository. Switching across repositories is not possible — for
                that, take a fresh checkout.
              </small>
            </span>
          </label>
          <input
            type="text"
            className="input mt-2 font-mono text-xs"
            placeholder="^/clients/acme-corp/website/branches/…"
            value={customUrl}
            onChange={(event) => onCustomUrlChange(event.target.value)}
            onFocus={() => onSelectionChange({ kind: 'url' })}
            aria-label="Switch target URL"
          />
        </div>

        {switchingToTag && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-bg-tertiary/40 p-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-none text-svn-modified"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-text-secondary">
              <b className="font-semibold text-text">That target is a tag.</b> Subversion will not
              stop you switching to it, or committing to it afterwards — a tag is an ordinary
              directory and is read-only by convention only. If you intend to keep working, switch
              to a branch instead.
            </p>
          </div>
        )}

        {isCurrent && (
          <p className="mt-3 text-xs text-text-secondary">
            That is the URL this working copy already points at — nothing to switch.
          </p>
        )}

        <div className="mt-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              {/* Wraps rather than scrolls: two absolute paths do not fit on one
                  line, and a command clipped mid-path cannot be checked or
                  trusted — which is the only reason to show it. */}
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {command}
              </code>
            </div>
            {onCopyCommand && (
              <button
                type="button"
                onClick={() => onCopyCommand(command)}
                className="btn-icon-sm flex-none"
                aria-label="Copy the switch command"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          {footerCounts ? `${footerCounts} under this path. ` : ''}
          Local modifications are carried across, not discarded.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isBusy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (chosenUrl !== '') onSwitch(chosenUrl);
          }}
          className="btn btn-primary"
          disabled={!canSwitch}
          aria-busy={isBusy}
        >
          <GitBranch className="h-4 w-4" aria-hidden="true" />
          {isBusy ? 'Switching…' : 'Switch'}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default SwitchDialog;
