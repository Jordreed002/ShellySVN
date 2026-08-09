import type { ReactNode } from 'react';
import { AlignLeft, ArrowRight, Copy, GitCompare, Info, ListTree } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { Comparand } from '../types';

/**
 * CompareDialog — diff any two locations or revisions in the repository.
 *
 * Two things have to be said out loud, and both are said on screen.
 *
 *  1. **What is being compared.** A branch against trunk, a tag against a
 *     branch, or one path at two revisions are materially different questions;
 *     the dialog names the `Comparand` and states what the answer does and does
 *     not include.
 *  2. **What the comparison costs.** `svn diff --summarize` asks the server for
 *     the list of paths that differ and is fast even on a large tree.
 *     `svn diff` transfers every changed line; across a monorepo subtree that
 *     is genuinely expensive, and the estimate is shown before you start it.
 *
 * Both are server-side comparisons. Neither reads or writes a working copy.
 */

/** Summary of changed paths, or the full unified diff. Not the same cost. */
export type CompareMode = 'summary' | 'full';

/** What the primary button hands back to the route. */
export interface CompareRequest {
  /** Left side, normalised to `path@REV`. */
  from: string;
  /** Right side, normalised to `path@REV`. */
  to: string;
  mode: CompareMode;
  comparand: Comparand;
}

export interface CompareDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** Left side as typed, e.g. `^/clients/acme-corp/website/trunk @ HEAD`. */
  fromValue: string;
  onFromChange: (value: string) => void;

  /** Right side as typed, e.g. `^/…/branches/feature/payments-v2 @ HEAD`. */
  toValue: string;
  onToChange: (value: string) => void;

  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;

  /**
   * What the comparison amounts to. Defaults to `branch-trunk` when the two
   * paths differ and `rev-rev` when only the revisions do.
   */
  comparand?: Comparand;

  /** Files under the subtree, used to say what a full diff will cost. From `svn list --depth infinity`. */
  estimatedFileCount?: number;

  onCompare: (request: CompareRequest) => void;
  onCopyCommand?: (command: string) => void;
  isBusy?: boolean;
}

interface ComparandCopy {
  label: string;
  consequence: string;
}

/** Only the two server-side comparands this dialog can produce. */
const COMPARAND_COPY: Record<'branch-trunk' | 'rev-rev', ComparandCopy> = {
  'branch-trunk': {
    label: 'Two paths — divergence between them',
    consequence:
      'Everything that differs between the two locations, in both directions. It is not a merge preview: revisions already merged one way still show up as differences until both sides match.',
  },
  'rev-rev': {
    label: 'One path at two revisions',
    consequence:
      'Only what changed on the server between those revisions. No working copy is read, so nothing you have edited locally appears in this diff.',
  },
};

/** `^/trunk @ HEAD` → `^/trunk@HEAD`; the space is ours, the `@` is Subversion's. */
function normalizeComparand(value: string): string {
  return value.trim().replace(/\s*@\s*/, '@');
}

function pathOf(value: string): string {
  const normalized = normalizeComparand(value);
  const at = normalized.lastIndexOf('@');
  return at <= 0 ? normalized : normalized.slice(0, at);
}

function deriveComparand(fromValue: string, toValue: string): 'branch-trunk' | 'rev-rev' {
  return pathOf(fromValue) === pathOf(toValue) ? 'rev-rev' : 'branch-trunk';
}

function buildCommand(fromValue: string, toValue: string, mode: CompareMode): string {
  const from = normalizeComparand(fromValue) || '<from>';
  const to = normalizeComparand(toValue) || '<to>';
  const flag = mode === 'summary' ? ' --summarize' : '';
  return `svn diff${flag} --old=${from} --new=${to}`;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

function ModeOption({
  selected,
  icon,
  title,
  detail,
  command,
  onSelect,
}: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  command: string;
  onSelect: () => void;
}) {
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
        name="compare-mode"
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
  );
}

export function CompareDialog({
  isOpen,
  onClose,
  fromValue,
  onFromChange,
  toValue,
  onToChange,
  mode,
  onModeChange,
  comparand,
  estimatedFileCount,
  onCompare,
  onCopyCommand,
  isBusy = false,
}: CompareDialogProps) {
  const derived = deriveComparand(fromValue, toValue);
  const effectiveComparand: Comparand = comparand ?? derived;
  const copy = COMPARAND_COPY[derived];

  const from = normalizeComparand(fromValue);
  const to = normalizeComparand(toValue);
  const command = buildCommand(fromValue, toValue, mode);
  const identical = from !== '' && from === to;
  const canCompare = !isBusy && from !== '' && to !== '' && !identical;

  const scale =
    estimatedFileCount === undefined
      ? ''
      : ` This subtree holds ${formatCount(estimatedFileCount)} files.`;

  return (
    <AccessibleDialog isOpen={isOpen} onClose={onClose} title="Compare two paths" size="md">
      <AccessibleDialogBody>
        <div className="flex items-start gap-2.5">
          <GitCompare className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-text-secondary">
            Diff any two locations or revisions in the repository — a branch against trunk, a tag
            against a branch, or one path at two revisions. Both sides are read from the server:{' '}
            <b className="font-semibold text-text">no working copy is read or written</b>.
          </p>
        </div>
        <p className="mb-4 mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          {from || '<from>'} → {to || '<to>'}
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-2xs font-bold uppercase tracking-wide text-text-faint">
            From
          </span>
          <input
            type="text"
            className="input font-mono text-xs"
            placeholder="^/clients/acme-corp/website/trunk @ HEAD"
            value={fromValue}
            onChange={(event) => onFromChange(event.target.value)}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-text-faint">
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            To
          </span>
          <input
            type="text"
            className="input font-mono text-xs"
            placeholder="^/clients/acme-corp/website/branches/feature/payments-v2 @ HEAD"
            value={toValue}
            onChange={(event) => onToChange(event.target.value)}
          />
        </label>

        <div className="mb-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <b className="block text-xs font-bold text-text">What this diff compares</b>
          <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
            <span className="font-semibold text-text">{copy.label}.</span> {copy.consequence}
          </small>
        </div>

        <ModeOption
          selected={mode === 'summary'}
          icon={<ListTree className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />}
          title="Summary of changed paths"
          detail={`Which files differ, and whether each was modified, added or deleted. One request to the server, no file contents transferred — fast on a large tree.${scale}`}
          command="svn diff --summarize"
          onSelect={() => onModeChange('summary')}
        />

        <ModeOption
          selected={mode === 'full'}
          icon={<AlignLeft className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />}
          title="Full unified diff"
          detail={`Every changed line of every changed file. Across a whole subtree this is slow and can run to hundreds of megabytes${
            estimatedFileCount === undefined ? '' : ` over ${formatCount(estimatedFileCount)} files`
          } — take the summary first and diff single files from it.`}
          command="svn diff"
          onSelect={() => onModeChange('full')}
        />

        {identical && (
          <p className="mt-1 text-xs text-text-secondary">
            Both sides name the same path at the same revision — there is nothing to compare.
          </p>
        )}

        <div className="mt-4 rounded-xl border border-border bg-bg-tertiary/40 p-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {command}
              </code>
            </div>
            {onCopyCommand && (
              <button
                type="button"
                onClick={() => onCopyCommand(command)}
                className="btn-icon-sm flex-none"
                aria-label="Copy the diff command"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">Result opens in the detail pane.</span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isBusy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (canCompare) onCompare({ from, to, mode, comparand: effectiveComparand });
          }}
          className="btn btn-primary"
          disabled={!canCompare}
          aria-busy={isBusy}
        >
          <GitCompare className="h-4 w-4" aria-hidden="true" />
          {isBusy ? 'Comparing…' : mode === 'summary' ? 'Compare — summary' : 'Compare — full diff'}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default CompareDialog;
