import { useEffect, useState } from 'react';
import { ArrowDownToLine, Layers, Loader2, X } from 'lucide-react';
import { describeMixedRevisions, type MixedRevisionSummary } from '@renderer/lib/workingCopyFreshness';

/**
 * Mixed-revision banner for the Files surface.
 *
 * A partial update leaves parts of a working copy at newer revisions than the
 * folder around them. That state is invisible in the file list — every row
 * looks fine — yet it is exactly the state a commit or a branch operation
 * trips over. When the derivation in `lib/workingCopyFreshness` proves the
 * tree is mixed, this strip says so in one line (which revisions, how many
 * items) and offers the one-click fix: an update of the folder to HEAD,
 * through the same update action the toolbar uses.
 *
 * Dismissal is per mixed state, not per session: the signature covers the
 * revision range and item count, so the strip comes back when the working
 * copy's state genuinely changes (including after an update that leaves it
 * mixed at new revisions).
 */

const VISIBLE_SAMPLE = 3;

interface MixedRevisionBannerProps {
  summary: MixedRevisionSummary | null;
  /** Runs the app's existing update action for the current folder. */
  onUpdateToHead: () => void;
  isUpdating?: boolean;
}

export function MixedRevisionBanner({
  summary,
  onUpdateToHead,
  isUpdating = false,
}: MixedRevisionBannerProps) {
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  // An update in flight means the mixed state is being resolved right now —
  // re-arm the dismissal so the outcome (still mixed, at new revisions) is
  // surfaced rather than silently swallowed by an old dismissal.
  useEffect(() => {
    if (isUpdating) setDismissedSignature(null);
  }, [isUpdating]);

  if (!summary || summary.itemCount === 0) return null;
  if (dismissedSignature === summary.signature) return null;

  const sample = summary.items.slice(0, VISIBLE_SAMPLE);
  const remaining = summary.itemCount - sample.length;

  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-accent/30 bg-accent/[0.07] px-4 py-2 text-sm"
      role="status"
      aria-live="polite"
      aria-label="Mixed-revision working copy"
    >
      <div className="grid h-7 w-7 flex-none place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
        <Layers className="h-4 w-4" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-13 font-medium text-text">
          Mixed-revision working copy · {describeMixedRevisions(summary)}
        </p>
        <p
          className="truncate text-xs text-text-muted"
          title={summary.items.join('\n')}
        >
          {sample.join(', ')}
          {remaining > 0 && ` +${remaining} more`}
          {' — parts of this checkout are at newer revisions than r'}
          {summary.baseRevision}
        </p>
      </div>

      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm text-xs"
          onClick={onUpdateToHead}
          disabled={isUpdating}
          aria-busy={isUpdating}
          title={`svn update to HEAD for this folder — brings every item below r${summary.maxRevision} up to date`}
        >
          {isUpdating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isUpdating ? 'Updating…' : 'Update to HEAD'}
        </button>
        <button
          type="button"
          className="btn-icon-sm"
          onClick={() => setDismissedSignature(summary.signature)}
          aria-label="Dismiss mixed-revision notice"
          title="Dismiss — the notice returns when the revision range changes"
          disabled={isUpdating}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
