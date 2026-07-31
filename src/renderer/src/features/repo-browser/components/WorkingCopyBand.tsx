import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ExternalLink, GitMerge, HardDrive } from 'lucide-react';
import type { WorkingCopyState } from '../types';

/**
 * WorkingCopyBand — the seam between the server and your disk.
 *
 * Everything above this band is `svn list` talking: what exists in the
 * repository. Everything the band reports is `svn status` and `svn info`
 * talking: what is on this machine. It renders only when the current path is
 * inside a checkout, and it answers three questions in Subversion's own
 * vocabulary:
 *
 *   - **Incoming** — revisions on the server that are not here yet (`svn update`)
 *   - **Local changes** — what you have modified, and how much of it is
 *     conflicted, because conflicts block `svn commit` outright
 *   - **Eligible to merge** — revisions on the merge source that `svn:mergeinfo`
 *     says have never landed here
 *
 * It also draws the mixed-revision strip. A working copy is a **range**, not a
 * point: updating a subtree moves only that subtree, so files sit anywhere
 * between the lowest and highest revision on disk until a full update pulls
 * them level. No other client shows this, and it is the single largest source
 * of confusion when reading `svn status`.
 */

export interface WorkingCopyBandProps {
  /** `svn info` for the working copy containing the current path. */
  state: WorkingCopyState;
  /** Number of entries `ProblemsDialog` would list. */
  problemCount: number;
  /** How many of those are severity `blocking`; tints the problems button. */
  blockingProblemCount?: number;
  /** Human label for the merge source, e.g. `trunk`. Defaults to "the merge source". */
  mergeSourceLabel?: string;
  /**
   * Whether an eligible-revision count could be taken at all. Subversion counts
   * eligible revisions *against a named source* and cannot infer one, so with no
   * source there is no answer — which is not the same as an answer of zero. When
   * this is false the tile says so instead of claiming nothing is outstanding.
   */
  eligibleRevisionsAvailable?: boolean;
  /** Open the problems dialog. */
  onShowProblems: () => void;
  /** Run `svn update` — the incoming flow. */
  onUpdate: () => void;
  /** Open the commit flow — the outgoing flow. */
  onCommit: () => void;
  /** Open the merge dialog — the eligible flow. */
  onMerge: () => void;
  /** Reveal the working copy in the OS file manager. Omit to hide the button. */
  onReveal?: () => void;
  className?: string;
}

/** Long paths truncate from the left so the leaf survives. See SPEC "Paths must never break the layout". */
const leftTruncate = { direction: 'rtl', textAlign: 'left' } as const;

interface FlowProps {
  /** `null` means "not measured" — rendered as an em dash, never as zero. */
  count: number | null;
  tone: 'neutral' | 'incoming' | 'outgoing' | 'eligible';
  label: string;
  detail: string;
  icon: ReactNode;
  ariaLabel: string;
  onClick: () => void;
}

const toneClass: Record<FlowProps['tone'], string> = {
  neutral: 'text-text',
  incoming: 'text-svn-modified',
  outgoing: 'text-svn-conflict',
  eligible: 'text-svn-added',
};

function Flow({ count, tone, label, detail, icon, ariaLabel, onClick }: FlowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex flex-1 min-w-0 items-center gap-2.5 px-3 py-1.5 text-left border-r border-accent/25 last:border-r-0 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span className={`font-mono text-base font-semibold tabular-nums ${toneClass[tone]}`}>
        {count ?? '—'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[11.5px] font-bold leading-tight text-text">{label}</span>
        <span className="block truncate text-2xs text-text-muted">{detail}</span>
      </span>
      <span className="flex-none text-text-faint" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

/**
 * The mixed-revision strip: BASE marked inside the [lowest … highest] range
 * that actually exists on disk.
 */
function MixedRevisionStrip({ state }: { state: WorkingCopyState }) {
  const { lowest, highest } = state.mixedRevisions;
  const span = highest - lowest;
  const isMixed = span > 0;
  const clamped = Math.min(Math.max(state.baseRevision, lowest), highest);
  const basePercent = isMixed ? ((clamped - lowest) / span) * 100 : 100;

  return (
    <div className="flex items-center gap-2 border-t border-accent/25 px-3 py-1 font-mono text-[10px] text-text-muted">
      <span className="flex-none">{isMixed ? 'mixed revisions' : 'single revision'}</span>
      <span className="flex-none font-medium text-text-secondary">r{lowest}</span>
      <span
        className="relative h-1 min-w-[60px] flex-1 overflow-hidden rounded-full bg-bg-tertiary"
        role="img"
        aria-label={
          isMixed
            ? `Working copy spans revisions ${lowest} to ${highest}; BASE is ${state.baseRevision}`
            : `Whole working copy is at revision ${lowest}`
        }
      >
        <i className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: `${basePercent}%` }} />
        <i className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `calc(${basePercent}% - 1px)` }} />
      </span>
      <span className="flex-none font-medium text-text-secondary">r{highest}</span>
      {/* The numbers must never be clipped; the prose may be. */}
      <span className="flex-none">
        · BASE <b className="font-medium text-text-secondary">r{state.baseRevision}</b>
      </span>
      <span className="min-w-0 flex-1 truncate">
        {isMixed
          ? '· files sit anywhere in this range until you update'
          : '· nothing to reconcile'}
      </span>
      {/* Only when it is actually known: `svn info` does not report checkout
          depth through this app's parser, and a permanent "depth unknown"
          label is noise that costs the sentence beside it its space. */}
      {state.depth !== 'unknown' && (
        <span className="hidden flex-none text-text-faint lg:inline">· depth {state.depth}</span>
      )}
    </div>
  );
}

export function WorkingCopyBand({
  state,
  problemCount,
  blockingProblemCount = 0,
  mergeSourceLabel,
  eligibleRevisionsAvailable = true,
  onShowProblems,
  onUpdate,
  onCommit,
  onMerge,
  onReveal,
  className = '',
}: WorkingCopyBandProps) {
  const { modified, added, deleted, conflicted } = state.rollup;
  const localTotal = modified + added + deleted + conflicted;
  const source = mergeSourceLabel ?? 'the merge source';

  /*
   * The tiles are ~180px wide, so a detail line that does not fit is a detail
   * line nobody reads. The command belongs here only when there is room for it;
   * when conflicts exist, "blocks commit" is the more important half — it is the
   * reason the command would fail.
   */
  const localDetail =
    conflicted > 0
      ? `${conflicted} conflict${conflicted === 1 ? ' blocks' : 's block'} commit`
      : deleted > 0 && modified + added === 0
        ? `${deleted} deleted · svn commit`
        : `${modified + added} modified · svn commit`;

  return (
    <div className={`flex-none border-b border-accent/30 bg-accent/5 ${className}`}>
      {/* Which working copy, and where it came from */}
      <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-2">
        <HardDrive className="h-4 w-4 flex-none text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" style={leftTruncate}>
          <bdi>
            <b className="font-semibold text-text">{state.localPath}</b>{' '}
            <span className="font-mono text-[11px] text-text-muted">· ^/{state.repoPath}</span>
          </bdi>
        </span>

        <button
          type="button"
          onClick={onShowProblems}
          className="btn btn-sm btn-ghost flex-none"
          aria-label={`${problemCount} problem${problemCount === 1 ? '' : 's'} in this working copy — open details`}
        >
          <AlertTriangle
            className={`h-3.5 w-3.5 ${blockingProblemCount > 0 ? 'text-svn-conflict' : 'text-svn-modified'}`}
            aria-hidden="true"
          />
          {problemCount} {problemCount === 1 ? 'problem' : 'problems'}
        </button>

        {onReveal && (
          <button type="button" onClick={onReveal} className="btn btn-sm btn-ghost flex-none">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Reveal
          </button>
        )}
      </div>

      {/* The three flows out of a working copy */}
      <div className="flex items-stretch border-t border-accent/25">
        <Flow
          count={state.incomingRevisions}
          tone={state.incomingRevisions > 0 ? 'incoming' : 'neutral'}
          label="Incoming"
          /* The revision range is on the mixed-revision strip below; repeating
             it here only cost the command its space. */
          detail="since BASE · svn update"
          icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
          ariaLabel={`${state.incomingRevisions} incoming revisions on the server, not yet in this working copy. Run svn update.`}
          onClick={onUpdate}
        />
        <Flow
          count={localTotal}
          tone={conflicted > 0 ? 'outgoing' : 'neutral'}
          label="Local changes"
          detail={localDetail}
          icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
          ariaLabel={`${localTotal} locally changed paths: ${modified} modified, ${added} added, ${deleted} deleted or missing, ${conflicted} conflicted. Conflicts must be resolved before svn commit.`}
          onClick={onCommit}
        />
        <Flow
          count={eligibleRevisionsAvailable ? state.eligibleRevisions : null}
          tone={eligibleRevisionsAvailable && state.eligibleRevisions > 0 ? 'eligible' : 'neutral'}
          label="Eligible to merge"
          detail={
            eligibleRevisionsAvailable
              ? `on ${source}, not here yet`
              : 'pick a source to count'
          }
          icon={<GitMerge className="h-3.5 w-3.5" />}
          ariaLabel={
            eligibleRevisionsAvailable
              ? `${state.eligibleRevisions} revisions on ${source} have not been merged here yet, according to svn:mergeinfo.`
              : 'Eligible revisions are counted against a named merge source. Choose one to see the count.'
          }
          onClick={onMerge}
        />
      </div>

      <MixedRevisionStrip state={state} />
    </div>
  );
}

export default WorkingCopyBand;
