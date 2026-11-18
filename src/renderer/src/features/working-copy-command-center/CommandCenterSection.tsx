/**
 * The Home working-copy list: every saved checkout, what `svn status` says about
 * it locally, what the server side looks like once someone has asked, and the
 * batch update pipeline's check / select / update / cancel / retry controls.
 *
 * It renders the one `BatchUpdateProvider` pipeline — the sidebar's "Update
 * all" enqueues into the same items — and never runs an update of its own.
 */
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { BriefingSection } from '@renderer/components/home/HomeSections';
import { shortenPath } from '@renderer/components/sidebar/sidebarData';
import { useBatchUpdate } from './BatchUpdateProvider';
import {
  batchItemCheckedLabel,
  batchItemRevisions,
  batchItemStateLabel,
  batchItemTone,
} from './itemLabels';
import type { BatchUpdateItem, BatchUpdateSummary } from './types';

/** Local facts for one row, supplied by the screen that already read them. */
interface CommandCenterLocalState {
  label: string;
  /** Tailwind text colour class. */
  className: string;
}

function openAuthenticationSettings(): void {
  window.dispatchEvent(new CustomEvent('shellysvn:open-settings', { detail: { tab: 'auth' } }));
}

function batchProgressText(summary: BatchUpdateSummary): string {
  return [
    summary.running ? `${summary.running} updating` : '',
    summary.queued ? `${summary.queued} queued` : '',
    summary.completed ? `${summary.completed} updated` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.cancelled ? `${summary.cancelled} cancelled` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The pipeline's run controls — cancel, retry, clear — shown under whichever
 * Home surface carries the batch while a run is active or has results.
 */
export function BatchRunBar() {
  const { summary, cancelAll, retryFailed, clearCompleted } = useBatchUpdate();
  const active = summary.running + summary.queued;
  const terminal = summary.completed + summary.cancelled;
  if (active === 0 && summary.failed === 0 && terminal === 0) return null;

  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-2 border-t border-border-muted px-1 py-1.5"
      role="status"
      aria-live="polite"
      data-testid="batch-run-bar"
    >
      {active > 0 ? (
        <Loader2
          className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-accent"
          aria-hidden="true"
        />
      ) : summary.failed > 0 ? (
        <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-svn-normal" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 text-12 text-text-secondary">
        {batchProgressText(summary)}
      </span>
      <span className="flex flex-shrink-0 gap-1.5">
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
        {terminal > 0 && active === 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearCompleted}>
            Clear results
          </button>
        )}
      </span>
    </div>
  );
}

interface CommandCenterSectionProps {
  /** Local `svn status` facts per path, from the cache the sidebar already filled. */
  localStateOf?: (path: string) => CommandCenterLocalState | undefined;
}

export function CommandCenterSection({ localStateOf }: CommandCenterSectionProps = {}) {
  const { items, summary, isChecking, checkAll, toggleSelection, startSelected, cancelItem } =
    useBatchUpdate();
  const active = summary.running + summary.queued;

  return (
    <BriefingSection
      id="home-working-copy-command-center"
      title="Working copies"
      meta={`${items.length}`}
      metaTitle="Saved working copies on this machine. Check for updates asks each repository for HEAD; nothing is updated until you choose."
      action={
        items.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1.5"
              onClick={() => void checkAll()}
              disabled={isChecking || active > 0}
              title="Ask each repository for HEAD — svn info, no files change"
            >
              {isChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isChecking ? 'Checking…' : 'Check for updates'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void startSelected()}
              disabled={summary.selected === 0 || active > 0 || isChecking}
              title={
                summary.selected === 0
                  ? 'Select working copies with incoming revisions to update them together'
                  : 'svn update each selected working copy'
              }
            >
              Update selected
              {summary.selected > 0 ? ` (${summary.selected})` : ''}
            </button>
          </div>
        )
      }
    >
      {items.length === 0 ? (
        <p className="px-1 py-3 text-12 text-text-muted">
          Open or check out a working copy to add it here.
        </p>
      ) : (
        <ul className="list-none" aria-label="Saved working copies">
          {items.map((item) => (
            <WorkingCopyListRow
              key={item.path}
              item={item}
              local={localStateOf?.(item.path)}
              onToggle={() => void toggleSelection(item.path)}
              onCancel={() => void cancelItem(item.path)}
            />
          ))}
        </ul>
      )}
      <BatchRunBar />
    </BriefingSection>
  );
}

interface WorkingCopyListRowProps {
  item: BatchUpdateItem;
  local?: CommandCenterLocalState;
  onToggle: () => void;
  onCancel: () => void;
}

function WorkingCopyListRow({ item, local, onToggle, onCancel }: WorkingCopyListRowProps) {
  const selectable = item.status === 'ready' && item.blockedKind !== 'at-head';
  const checked = batchItemCheckedLabel(item);
  const stateLabel = batchItemStateLabel(item);
  const stateDetail = item.verificationError ?? item.error ?? item.blockedReason;

  return (
    <li className="grid min-h-[52px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-border-muted px-1 py-2 last:border-b-0 sm:grid-cols-[20px_minmax(0,1fr)_minmax(0,11rem)_minmax(0,13rem)_auto] [content-visibility:auto] [contain-intrinsic-size:52px]">
      <input
        type="checkbox"
        checked={item.selected}
        disabled={!selectable}
        onChange={onToggle}
        aria-label={`Select ${item.name} for update`}
        title={
          selectable
            ? `Include ${item.name} in Update selected`
            : 'Check for updates first — only working copies behind HEAD can be selected'
        }
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <Link
        to="/files"
        search={{ path: item.path }}
        className="min-w-0 rounded-6 hover:text-accent"
        title={`Open ${item.path}`}
      >
        <span className="flex items-center gap-1.5 text-13 font-medium text-text">
          <span className="truncate">{item.name}</span>
          {item.requiresDirtyConfirmation && (
            <AlertTriangle
              className="h-3 w-3 flex-shrink-0 text-svn-modified"
              aria-label="Has local changes"
            />
          )}
        </span>
        <span className="block truncate font-mono text-11 text-text-muted">
          {shortenPath(item.path, 3)}
        </span>
      </Link>
      <span
        className={`hidden truncate text-12 sm:block ${local?.className ?? 'text-text-muted'}`}
        title={local?.label}
      >
        {local?.label ??
          (item.localChangeCount === undefined
            ? '—'
            : item.localChangeCount === 0
              ? 'No local changes'
              : `${item.localChangeCount} local changes`)}
      </span>
      <span className="hidden min-w-0 text-right sm:block" title={stateDetail}>
        <span className={`block truncate text-12 ${batchItemTone(item)}`}>{stateLabel}</span>
        <span className="block truncate font-mono text-11 text-text-muted">
          {batchItemRevisions(item)}
          {checked ? ` · ${checked}` : ''}
        </span>
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1">
        {/* Narrow widths: state moves here so it is never lost. */}
        <span className={`truncate text-12 sm:hidden ${batchItemTone(item)}`} title={stateDetail}>
          {stateLabel}
        </span>
        {item.blockedKind === 'authentication' && (
          <button
            type="button"
            onClick={openAuthenticationSettings}
            className="btn btn-ghost btn-sm text-accent"
          >
            Sign in
          </button>
        )}
        {(item.status === 'running' || item.status === 'queued') && (
          <button
            type="button"
            onClick={onCancel}
            className="btn-icon-sm text-text-muted hover:text-svn-conflict"
            aria-label={`Cancel update for ${item.name}`}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </span>
    </li>
  );
}
