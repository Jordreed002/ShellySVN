/**
 * Sidebar-facing affordances for the batch update pipeline (#58).
 *
 * `UpdateAllButton` is the prominent entry point — global, or scoped to one
 * group's paths — that enqueues into the one `BatchUpdateProvider` pipeline.
 * `BatchCompletionNotice` is the aggregate "toast": an inline, aria-live panel
 * that appears when a run finishes, summarising per-working-copy results with
 * retry and dismiss actions. Nothing here runs updates of its own.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, X, XCircle } from 'lucide-react';

import { workingCopyName } from './model';
import { useBatchUpdate } from './BatchUpdateProvider';
import type { BatchUpdateItem } from './types';

interface UpdateAllButtonProps {
  /** Restrict the run to these working copies (a group). Omit for everything. */
  paths?: readonly string[];
  label?: string;
  title?: string;
  ariaLabel?: string;
  /** Classes for the button itself; defaults suit the variant (`rail-item` vs `btn`). */
  className?: string;
  /** Leading icon sizing, e.g. `h-3 w-3` when the button uses `btn-icon-sm`. */
  iconClassName?: string;
  iconOnly?: boolean;
}

export function UpdateAllButton({
  paths,
  label = 'Update all',
  title,
  ariaLabel,
  className,
  iconClassName = 'h-5 w-5',
  iconOnly = false,
}: UpdateAllButtonProps) {
  const { updatePaths, updateAll, summary, isChecking } = useBatchUpdate();
  const active = summary.running + summary.queued;
  const busy = isChecking || active > 0;

  const run = () => (paths ? updatePaths(paths) : updateAll());
  const scopedTitle =
    title ??
    (paths
      ? `Update every working copy in this group through the batch pipeline`
      : `Update every working copy through the batch pipeline`);

  // The failure/blocked dot scales with its host button so the same classes
  // fit both the 40px `rail-item` and the 24px `btn-icon-sm` variants.
  const failureDot =
    (summary.failed > 0 || summary.blocked > 0) && (
      <span
        className={`absolute top-[12%] right-[12%] h-[22%] w-[22%] rounded-full ring-2 ring-bg-secondary ${
          summary.failed > 0 ? 'bg-svn-conflict' : 'bg-svn-modified'
        }`}
        aria-hidden="true"
      />
    );

  if (iconOnly) {
    return (
      <button
        type="button"
        className={`${className ?? 'rail-item'} relative`}
        onClick={() => void run()}
        disabled={busy}
        aria-label={ariaLabel ?? label}
        title={busy ? 'Working-copy updates in progress' : scopedTitle}
        data-testid="update-all-button"
      >
        {busy ? (
          <Loader2 className={`${iconClassName} animate-spin`} aria-hidden="true" />
        ) : (
          <RefreshCw className={iconClassName} aria-hidden="true" />
        )}
        {failureDot}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
        className ?? 'btn btn-secondary btn-sm gap-1'
      }`}
      onClick={() => void run()}
      disabled={busy}
      aria-label={ariaLabel ?? label}
      title={scopedTitle}
      data-testid="update-all-button"
    >
      {isChecking ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
      )}
      <span>
        {label}
        {active > 0 ? ` (${active})` : ''}
      </span>
    </button>
  );
}

function resultLabel(item: BatchUpdateItem): string {
  if (item.status === 'completed') {
    if (item.verificationError) return 'updated · verification unavailable';
    return item.revision == null ? 'updated' : `updated to r${item.revision}`;
  }
  if (item.status === 'failed') return item.error ?? 'failed';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'blocked') return item.blockedReason ?? 'blocked';
  return item.status;
}

/**
 * Aggregate completion summary for the sidebar. Appears the moment a run's last
 * active item settles, lists per-working-copy results, and offers the
 * pipeline's own retry/cancel. Dismissed manually or by the next run.
 */
export function BatchCompletionNotice() {
  const { summary, items, retryFailed, cancelAll } = useBatchUpdate();
  const active = summary.running + summary.queued;
  const prevActiveRef = useRef(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [seenCompletion, setSeenCompletion] = useState(0);

  useEffect(() => {
    if (prevActiveRef.current > 0 && active === 0) {
      setSeenCompletion((count) => count + 1);
    }
    prevActiveRef.current = active;
  }, [active]);

  if (active === 0 && seenCompletion === 0) return null;

  const settled = items.filter(
    (item) =>
      item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled'
  );
  if (active === 0 && settled.length === 0) return null;
  if (dismissedAt === seenCompletion && active === 0) return null;

  const headline = [
    summary.completed > 0 ? `${summary.completed} updated` : '',
    summary.failed > 0 ? `${summary.failed} failed` : '',
    summary.cancelled > 0 ? `${summary.cancelled} cancelled` : '',
    summary.blocked > 0 ? `${summary.blocked} blocked` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="mx-1.5 mb-1 rounded-lg border border-border bg-bg-tertiary/60 p-2"
      role="status"
      aria-live="polite"
      aria-label="Working-copy update summary"
      data-testid="batch-completion-notice"
    >
      <div className="flex items-center gap-1.5">
        {active > 0 ? (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-accent" aria-hidden="true" />
        ) : summary.failed > 0 ? (
          <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-svn-normal" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-10.5 text-text">
          {active > 0 ? `${headline || 'starting…'}` : headline || 'nothing to update'}
        </span>
        {active > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void cancelAll()}
          >
            Cancel all
          </button>
        )}
        {active === 0 && summary.failed > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1"
            onClick={() => void retryFailed()}
            data-testid="batch-notice-retry"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry failed
          </button>
        )}
        {active === 0 && (
          <button
            type="button"
            className="btn-icon-sm flex-shrink-0"
            aria-label="Dismiss update summary"
            onClick={() => setDismissedAt(seenCompletion)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {settled.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto scrollbar-overlay">
          {settled.slice(0, 8).map((item) => (
            <li key={item.path} className="flex items-baseline gap-2" title={item.path}>
              <span className="min-w-0 flex-1 truncate text-11 text-text-secondary">
                {workingCopyName(item.path)}
              </span>
              <span
                className={`max-w-[55%] flex-shrink-0 truncate font-mono text-10 ${
                  item.status === 'failed'
                    ? 'text-svn-conflict'
                    : item.status === 'completed' && !item.verificationError
                      ? 'text-svn-normal'
                      : 'text-text-muted'
                }`}
                title={item.verificationError ?? item.error ?? undefined}
              >
                {resultLabel(item)}
              </span>
            </li>
          ))}
          {settled.length > 8 && (
            <li className="pl-1 text-10 text-text-faint">and {settled.length - 8} more…</li>
          )}
        </ul>
      )}
    </div>
  );
}
