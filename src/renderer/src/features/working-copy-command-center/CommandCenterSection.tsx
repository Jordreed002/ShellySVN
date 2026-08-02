import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { BriefingSection } from '@renderer/components/home/HomeSections';
import { shortenPath } from '@renderer/components/sidebar/sidebarData';
import { useBatchUpdate } from './BatchUpdateProvider';
import type { BatchUpdateItem } from './types';

function stateLabel(item: BatchUpdateItem): string {
  if (item.status === 'checking') return 'checking…';
  if (item.status === 'queued') return 'queued';
  if (item.status === 'running')
    return item.cancellationRequested ? 'cancelling…' : `${item.filesProcessed} files`;
  if (item.status === 'completed')
    return item.verificationError
      ? 'complete · verification unavailable'
      : item.revision == null
        ? 'complete'
        : `updated to r${item.revision}`;
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'failed') return 'failed';
  if (item.blockedReason) return item.blockedReason;
  if (item.headRevision !== undefined && item.baseRevision !== undefined) {
    if (item.headRevision <= item.baseRevision) return 'at HEAD';
    const count = item.incomingCount ?? item.headRevision - item.baseRevision;
    return `${count}${item.incomingCapped ? '+' : ''} incoming`;
  }
  return 'not checked';
}

function tone(item: BatchUpdateItem): string {
  if (item.status === 'failed' || item.status === 'blocked') return 'text-svn-conflict';
  if (item.status === 'completed')
    return item.verificationError ? 'text-svn-modified' : 'text-svn-normal';
  if (item.status === 'running' || item.status === 'queued') return 'text-accent';
  if ((item.localChangeCount ?? 0) > 0) return 'text-svn-modified';
  return 'text-text-muted';
}

function checkedLabel(item: BatchUpdateItem): string | null {
  if (!item.checkedAt) return null;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - item.checkedAt) / 1000));
  const age =
    ageSeconds < 60
      ? 'just now'
      : ageSeconds < 3600
        ? `${Math.floor(ageSeconds / 60)}m ago`
        : `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${item.measurementSource === 'cached' ? 'cached' : 'fresh'} · ${age}`;
}

function openAuthenticationSettings(): void {
  window.dispatchEvent(new CustomEvent('shellysvn:open-settings', { detail: { tab: 'auth' } }));
}

export function CommandCenterSection() {
  const {
    items,
    summary,
    isChecking,
    checkAll,
    toggleSelection,
    startSelected,
    cancelItem,
    cancelAll,
    retryFailed,
    clearCompleted,
  } = useBatchUpdate();
  const active = summary.running + summary.queued;
  const terminal = summary.completed + summary.cancelled;
  const progress = [
    summary.running ? `${summary.running} running` : '',
    summary.queued ? `${summary.queued} queued` : '',
    summary.completed ? `${summary.completed} complete` : '',
    summary.failed ? `${summary.failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <BriefingSection
      id="home-working-copy-command-center"
      title="Working-copy command center"
      meta={
        active || summary.failed || summary.completed
          ? progress
          : `${items.length} working ${items.length === 1 ? 'copy' : 'copies'}`
      }
      action={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1"
            onClick={() => void checkAll()}
            disabled={isChecking || active > 0}
          >
            {isChecking ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            )}
            {isChecking ? 'Checking…' : 'Check all'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void startSelected()}
            disabled={summary.selected === 0 || active > 0 || isChecking}
          >
            Update selected{summary.selected > 0 ? ` (${summary.selected})` : ''}
          </button>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="px-3 py-4 text-12 text-text-muted">
          Open or check out a working copy to add it here.
        </p>
      ) : (
        <ul className="list-none">
          {items.map((item) => {
            const selectable = item.status === 'ready' && item.blockedKind !== 'at-head';
            const checked = checkedLabel(item);
            return (
              <li
                key={item.path}
                className="grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border-muted px-2.5 py-1.5 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:50px]"
              >
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={!selectable}
                  onChange={() => void toggleSelection(item.path)}
                  aria-label={`Select ${item.name} for update`}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <Link
                  to="/files"
                  search={{ path: item.path }}
                  className="min-w-0 rounded-6 hover:text-accent"
                  title={`Open ${item.path}`}
                >
                  <span className="flex items-center gap-1.5 truncate text-12.5 font-semibold text-text">
                    {item.name}
                    {item.requiresDirtyConfirmation && (
                      <AlertTriangle
                        className="h-3 w-3 flex-shrink-0 text-svn-modified"
                        aria-label="Has local changes"
                      />
                    )}
                  </span>
                  <span className="block truncate font-mono text-9.5 text-text-faint">
                    {shortenPath(item.path, 3)}
                  </span>
                </Link>
                <span className="hidden min-w-[145px] text-right font-mono text-9.5 text-text-muted sm:block">
                  {item.baseRevision === undefined ? 'BASE —' : `BASE r${item.baseRevision}`}
                  {' → '}
                  {item.headRevision === undefined ? 'HEAD —' : `HEAD r${item.headRevision}`}
                  {item.localChangeCount !== undefined && (
                    <span className="block">
                      {item.localChangeCount === 0
                        ? 'clean'
                        : `${item.localChangeCount} local changes`}
                    </span>
                  )}
                  {checked && (
                    <span
                      className="block text-text-faint"
                      title={new Date(item.checkedAt!).toString()}
                    >
                      {checked}
                    </span>
                  )}
                </span>
                <div className="flex min-w-[118px] items-center justify-end gap-1.5">
                  <span
                    className={`max-w-[180px] truncate font-mono text-9.5 ${tone(item)}`}
                    title={item.verificationError ?? item.error ?? item.blockedReason}
                  >
                    {stateLabel(item)}
                  </span>
                  {item.blockedKind === 'authentication' && (
                    <button
                      type="button"
                      onClick={openAuthenticationSettings}
                      className="rounded-6 px-1.5 py-0.5 text-10 text-accent hover:bg-accent/10"
                    >
                      Sign in
                    </button>
                  )}
                  {(item.status === 'running' || item.status === 'queued') && (
                    <button
                      type="button"
                      onClick={() => void cancelItem(item.path)}
                      className="rounded-6 p-1 text-text-muted hover:bg-bg-tertiary hover:text-svn-conflict"
                      aria-label={`Cancel update for ${item.name}`}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  {item.status === 'completed' && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-svn-normal" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(active > 0 || summary.failed > 0 || terminal > 0) && (
        <div
          className="flex min-h-9 items-center gap-2 border-t border-border bg-bg-tertiary/45 px-2.5"
          aria-live="polite"
        >
          <span className="font-mono text-10 text-text-muted">
            {progress || `${summary.cancelled} cancelled`}
          </span>
          <span className="ml-auto flex gap-1.5">
            {active > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void cancelAll()}
              >
                Cancel all
              </button>
            )}
            {summary.failed > 0 && active === 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm gap-1"
                onClick={() => void retryFailed()}
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Retry failed
              </button>
            )}
            {terminal > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearCompleted}>
                Clear completed
              </button>
            )}
          </span>
        </div>
      )}
    </BriefingSection>
  );
}
