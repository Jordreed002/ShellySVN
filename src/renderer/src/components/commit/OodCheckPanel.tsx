import { CloudDownload, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { OodGatePhase } from '@renderer/hooks/useWorkingCopyFreshness';
import type { IncomingChange } from '@renderer/lib/workingCopyFreshness';

/**
 * The out-of-date panel inside the commit dialog.
 *
 * Pure presentation: the state machine lives in
 * `useOutOfDateCommitGate` (what runs when, what fails open), while this
 * component says what the state *means* — which incoming paths would race the
 * commit, at which revisions, and what the choices are. It never blocks on its
 * own: every phase has an explicit way out, and "Commit anyway" is always the
 * escape hatch back to the untouched commit path.
 */

interface OodCheckPanelProps {
  phase: OodGatePhase;
  incoming: readonly IncomingChange[];
  error?: string;
  /** Visible only while a commit attempt is being held or checked. */
  selectedCount: number;
  onUpdateAndRetry: () => void;
  onCommitAnyway: () => void;
  onCancel: () => void;
  onSkipCheck: () => void;
}

function RevisionPair({ change }: { change: IncomingChange }) {
  return (
    <span className="flex-none font-mono text-10.5 text-text-muted">
      {`r${change.baseRevision ?? '?'} → r${change.headRevision ?? '?'}`}
    </span>
  );
}

export function OodCheckPanel({
  phase,
  incoming,
  error,
  selectedCount,
  onUpdateAndRetry,
  onCommitAnyway,
  onCancel,
  onSkipCheck,
}: OodCheckPanelProps) {
  if (phase === 'idle') return null;

  if (phase === 'checking') {
    return (
      <div
        className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-border bg-bg-secondary/60 px-3 py-2 text-xs text-text-secondary"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Checking the repository for incoming changes before committing…
        </span>
        <button type="button" className="btn btn-secondary btn-sm text-10.5" onClick={onSkipCheck}>
          Skip check
        </button>
      </div>
    );
  }

  const blocked = phase === 'blocked';

  return (
    <div
      className="mx-4 my-2 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2.5 text-xs"
      role="alert"
      aria-labelledby="ood-check-title"
      aria-describedby="ood-check-description"
    >
      <div className="flex items-start gap-2.5">
        {phase === 'updating' ? (
          <Loader2 className="mt-0.5 h-4 w-4 flex-none animate-spin text-accent" aria-hidden="true" />
        ) : (
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h3 id="ood-check-title" className="text-12.5 font-semibold text-text">
            {phase === 'updating'
              ? 'Updating working copy…'
              : blocked
                ? `Out of date — incoming changes affect ${selectedCount === 1 ? 'this commit' : `these ${selectedCount} files`}`
                : 'Could not update the working copy'}
          </h3>
          <p id="ood-check-description" className="mt-0.5 text-11 text-text-secondary">
            {phase === 'updating' ? (
              <>Committing {selectedCount === 1 ? 'it' : 'them'} again as soon as the update finishes.</>
            ) : blocked ? (
              <>
                The repository has newer revisions of{' '}
                {incoming.length === 1 ? 'one path' : `${incoming.length} paths`} in this commit.
                Committing now risks{' '}
                {incoming.length === 1 ? 'an out-of-date rejection' : 'out-of-date rejections'};
                updating brings{' '}
                {incoming.length === 1 ? 'it' : 'them'} in first.
              </>
            ) : (
              <span className="text-error">{error || 'The update did not complete.'}</span>
            )}
          </p>

          {blocked && (
            <ul
              className="mt-2 max-h-32 overflow-auto rounded-md border border-border-muted bg-bg-secondary/70"
              aria-label="Incoming changes"
            >
              {incoming.map((change) => (
                <li
                  key={change.path}
                  className="flex items-center justify-between gap-3 border-b border-border-muted px-2.5 py-1.5 last:border-b-0"
                >
                  <span className="min-w-0 truncate font-mono text-10.5 text-text" title={change.path}>
                    {change.path}
                  </span>
                  <RevisionPair change={change} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm text-11"
          onClick={onCancel}
          disabled={phase === 'updating'}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm text-11"
          onClick={onCommitAnyway}
          disabled={phase === 'updating'}
          title="Commit without updating — Subversion may reject out-of-date paths"
        >
          Commit anyway
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm text-11"
          onClick={onUpdateAndRetry}
          disabled={phase === 'updating'}
          aria-busy={phase === 'updating'}
        >
          {phase === 'updating' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : blocked ? (
            <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {phase === 'failed' ? 'Retry update' : 'Update and retry'}
        </button>
      </div>
    </div>
  );
}
