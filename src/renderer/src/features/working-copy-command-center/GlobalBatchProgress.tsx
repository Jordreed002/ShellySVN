import { Link, useRouterState } from '@tanstack/react-router';
import { Loader2, XCircle } from 'lucide-react';
import { useBatchUpdate } from './BatchUpdateProvider';

export function GlobalBatchProgress() {
  const { summary, cancelAll } = useBatchUpdate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = summary.queued + summary.running;
  const terminal = summary.completed + summary.cancelled + summary.failed;
  if (pathname === '/' || active + terminal === 0) return null;

  const text = [
    summary.running ? `${summary.running} running` : '',
    summary.queued ? `${summary.queued} queued` : '',
    summary.completed ? `${summary.completed} complete` : '',
    summary.failed ? `${summary.failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 font-mono text-10.5"
      role="status"
      aria-live="polite"
    >
      {active > 0 ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-svn-normal" aria-hidden="true" />
      )}
      <span className="font-semibold text-text">Working-copy updates</span>
      <span className="text-text-muted">{text}</span>
      <Link to="/" className="ml-auto rounded-6 px-1.5 py-0.5 text-accent hover:bg-accent/10">
        View command center
      </Link>
      {active > 0 && (
        <button
          type="button"
          onClick={() => void cancelAll()}
          className="btn btn-secondary btn-sm gap-1"
          aria-label="Cancel all working-copy updates"
        >
          <XCircle className="h-3 w-3" aria-hidden="true" /> Cancel all
        </button>
      )}
    </div>
  );
}
