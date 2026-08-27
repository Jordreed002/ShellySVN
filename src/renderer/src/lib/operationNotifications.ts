/**
 * Long-operation notifications (#81).
 *
 * The renderer has two honest sources for "an SVN operation just finished":
 *
 *  - The batch pipeline (`BatchUpdateProvider`, via `useBatchUpdate`) — knows
 *    the exact outcome of every working-copy update it ran.
 *  - The mutation activity IPC (`svn.onWorkingCopyMutationStateChanged` +
 *    `svn.onMutation`) — knows when *any* working copy mutation (commit,
 *    checkout, update from elsewhere) started and, through the mutation
 *    notification that fires on success, how it ended.
 *
 * This module holds the shared logic: durations, the "long enough to notify"
 * threshold, the settings gate for desktop notifications, and the dedupe that
 * keeps the two sources from double-announcing one completion. Components
 * (`components/layout/OperationNotifications.tsx`) supply the IPC wiring.
 */

import type { AppSettings } from '@shared/types';

/** An operation qualifies as "long" past this duration. */
export const LONG_OPERATION_THRESHOLD_MS = 8000;

/** Both sources may report one completion; first announcement wins. */
export const OPERATION_DEDUPE_WINDOW_MS = 3000;

/** How long after activity ends we still accept a success mutation event. */
export const MUTATION_GRACE_MS = 1500;

export type OperationOutcome = 'success' | 'failed' | 'warning';

export interface CompletedOperation {
  path: string;
  /** What ran, e.g. "Update", "Commit", "Checkout", "SVN operation". */
  label: string;
  durationMs: number;
  outcome: OperationOutcome;
  revision?: number | null;
  detail?: string;
}

/** Slash-form identity used to match mutation paths across sources. */
export function operationPathIdentity(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function isLongOperation(durationMs: number): boolean {
  return durationMs >= LONG_OPERATION_THRESHOLD_MS;
}

/**
 * Noise rule for the notification center: failures always land; otherwise an
 * operation has to have been long.
 */
export function shouldRecordInCenter(operation: CompletedOperation): boolean {
  return operation.outcome === 'failed' || isLongOperation(operation.durationMs);
}

/**
 * Desktop notifications are for long operations only, and only when the user
 * enabled system notifications (`settings.notifications.enableSystemNotifications`).
 */
export function shouldSendDesktopNotification(
  settings: Pick<AppSettings, 'notifications'> | undefined,
  operation: CompletedOperation
): boolean {
  return (
    settings?.notifications?.enableSystemNotifications === true && isLongOperation(operation.durationMs)
  );
}

function outcomeText(operation: CompletedOperation): { verb: string; type: 'success' | 'warning' | 'error' } {
  if (operation.outcome === 'failed') return { verb: 'failed', type: 'error' };
  if (operation.outcome === 'warning') return { verb: 'finished with warnings', type: 'warning' };
  return { verb: 'finished', type: 'success' };
}

function describeDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

export function describeOperation(operation: CompletedOperation): {
  title: string;
  body: string;
  type: 'success' | 'warning' | 'error';
} {
  const name = operation.path.split(/[/\\]/).filter(Boolean).pop() || operation.path;
  const { verb, type } = outcomeText(operation);
  const parts = [`r${operation.revision ?? '?'}`, describeDuration(operation.durationMs)];
  if (operation.detail) parts.push(operation.detail);
  return {
    title: `${operation.label} ${verb} — ${name}`,
    body: parts.join(' · '),
    type,
  };
}

/**
 * Fire the desktop notification through the existing IPC, honouring the
 * sounds setting (`silent` unless enabled). Failures degrade silently — a
 * notification that cannot be shown must not break the caller.
 */
export async function fireDesktopNotification(
  settings: Pick<AppSettings, 'notifications'> | undefined,
  operation: CompletedOperation
): Promise<boolean> {
  if (!shouldSendDesktopNotification(settings, operation)) return false;
  try {
    const { title, body, type } = describeOperation(operation);
    return await window.api.notification.show({
      title,
      body,
      type,
      silent: settings?.notifications?.enableSounds !== true,
    });
  } catch {
    return false;
  }
}

/* ── completion dedupe ────────────────────────────────────────────────────── */

const lastAnnouncedAt = new Map<string, number>();

export function markOperationAnnounced(path: string, now = Date.now()): void {
  lastAnnouncedAt.set(operationPathIdentity(path), now);
}

/** True when this path's completion has not been announced within the window. */
export function shouldAnnounceOperation(path: string, now = Date.now()): boolean {
  const at = lastAnnouncedAt.get(operationPathIdentity(path));
  return at === undefined || now - at > OPERATION_DEDUPE_WINDOW_MS;
}

/** Test helper. */
export function resetOperationAnnouncementsForTests(): void {
  lastAnnouncedAt.clear();
}

/* ── generic mutation watcher ─────────────────────────────────────────────── */

export interface MutationCompletion {
  path: string;
  durationMs: number;
  success: boolean;
}

export interface MutationCompletionWatcherOptions {
  onCompleted: (completion: MutationCompletion) => void;
  now?: () => number;
  graceMs?: number;
}

interface PendingEnd {
  path: string;
  startedAt: number;
  endedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Watches the active-mutation IPC and turns "a path left the active set" into
 * a completion with a duration and an outcome: a success is confirmed by the
 * `svn.onMutation` notification covering the path; if none arrives within the
 * grace window the mutation is reported as not-successful (failed/cancelled).
 */
export function createMutationCompletionWatcher({
  onCompleted,
  now = Date.now,
  graceMs = MUTATION_GRACE_MS,
}: MutationCompletionWatcherOptions): {
  onActivePathsChanged: (activePaths: readonly string[]) => void;
  onMutationNotification: (localPaths: readonly string[]) => void;
  dispose: () => void;
} {
  const activeMutations = new Map<string, { path: string; startedAt: number }>();
  const pending = new Map<string, PendingEnd>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function complete(path: string, success: boolean): void {
    const identity = operationPathIdentity(path);
    const entry = pending.get(identity);
    activeMutations.delete(identity);
    if (!entry) return;
    pending.delete(identity);
    clearTimeout(entry.timer);
    onCompleted({
      path,
      durationMs: Math.max(0, now() - entry.startedAt),
      success,
    });
  }

  function onActivePathsChanged(activePaths: readonly string[]): void {
    const active = new Set(activePaths.map(operationPathIdentity));
    for (const [identity, entry] of activeMutations) {
      if (active.has(identity)) continue;
      activeMutations.delete(identity);
      const timer = setTimeout(() => {
        timers.delete(timer);
        complete(entry.path, false);
      }, graceMs);
      timers.add(timer);
      pending.set(identity, { path: entry.path, startedAt: entry.startedAt, endedAt: now(), timer });
    }
    for (const path of activePaths) {
      const identity = operationPathIdentity(path);
      if (!activeMutations.has(identity) && !pending.has(identity)) {
        activeMutations.set(identity, { path, startedAt: now() });
      }
    }
  }

  function onMutationNotification(localPaths: readonly string[]): void {
    for (const notified of localPaths) {
      const identity = operationPathIdentity(notified);
      // The notification may name the working copy or anything under it.
      for (const [pendingIdentity, entry] of pending) {
        if (
          pendingIdentity === identity ||
          pendingIdentity.startsWith(`${identity}/`) ||
          identity.startsWith(`${pendingIdentity}/`)
        ) {
          complete(entry.path, true);
        }
      }
    }
  }

  function dispose(): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    pending.clear();
    activeMutations.clear();
  }

  return { onActivePathsChanged, onMutationNotification, dispose };
}

/* ── failure detail log ───────────────────────────────────────────────────── */

/**
 * How long a recorded mutation failure stays eligible as the detail of a
 * completion reported by the watcher. The failure event arrives while the
 * watcher is still inside its grace window, so this only needs to bridge
 * slow renders and queued announcements.
 */
export const MUTATION_FAILURE_TTL_MS = 15_000;

/** Notification bodies stay one line; cap the carried-over svn error. */
export const MUTATION_FAILURE_DETAIL_MAX_LENGTH = 180;

export interface MutationFailureRecord {
  message: string;
  errorCode?: string;
  cancelled?: boolean;
}

interface StoredFailure extends MutationFailureRecord {
  at: number;
}

export interface MutationFailureLog {
  record: (localPaths: readonly string[], failure: MutationFailureRecord) => void;
  /** Most recent failure covering `path` (exact or nested), summarized. */
  detailFor: (path: string) => string | undefined;
}

/** First line, whitespace-collapsed, capped — svn stderr can be very long. */
export function summarizeMutationFailure(
  message: string,
  maxLength = MUTATION_FAILURE_DETAIL_MAX_LENGTH
): string {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const collapsed = (firstLine ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Keeps the failure detail broadcast by `svn.onMutationFailed` so a failing
 * completion (which the watcher only infers) can name the real cause. Entries
 * expire after the TTL; matching follows the same path-identity rules as the
 * success notifications.
 */
export function createMutationFailureLog({
  ttlMs = MUTATION_FAILURE_TTL_MS,
  now = Date.now,
}: { ttlMs?: number; now?: () => number } = {}): MutationFailureLog {
  const entries = new Map<string, StoredFailure>();

  function prune(current: number): void {
    for (const [identity, entry] of entries) {
      if (current - entry.at > ttlMs) entries.delete(identity);
    }
  }

  function record(localPaths: readonly string[], failure: MutationFailureRecord): void {
    prune(now());
    for (const path of localPaths) {
      if (!path) continue;
      entries.set(operationPathIdentity(path), { ...failure, at: now() });
    }
  }

  function detailFor(path: string): string | undefined {
    prune(now());
    const identity = operationPathIdentity(path);
    let match: StoredFailure | undefined;
    for (const [failureIdentity, entry] of entries) {
      const covers =
        failureIdentity === identity ||
        failureIdentity.startsWith(`${identity}/`) ||
        identity.startsWith(`${failureIdentity}/`);
      if (covers && (match === undefined || entry.at > match.at)) match = entry;
    }
    if (!match) return undefined;
    if (match.cancelled) return 'Operation cancelled.';
    const summarized = summarizeMutationFailure(match.message);
    if (!summarized) return undefined;
    if (match.errorCode && !summarized.toUpperCase().includes(match.errorCode.toUpperCase())) {
      return summarizeMutationFailure(`[${match.errorCode}] ${summarized}`);
    }
    return summarized;
  }

  return { record, detailFor };
}
