import { useCallback, useEffect, useRef } from 'react';
import { useSettings } from '@renderer/hooks/useSettings';
import { useBatchUpdate } from '@renderer/features/working-copy-command-center/BatchUpdateProvider';
import {
  createMutationCompletionWatcher,
  fireDesktopNotification,
  isLongOperation,
  markOperationAnnounced,
  shouldAnnounceOperation,
  shouldRecordInCenter,
  type CompletedOperation,
  type OperationOutcome,
} from '@renderer/lib/operationNotifications';
import { pushNotification } from '@renderer/lib/notificationCenterStore';

/** Terminal batch statuses worth reporting. */
const REPORTED = new Set(['completed', 'failed']);

function outcomeOf(item: {
  status: string;
  error?: string;
  verificationError?: string;
}): { outcome: OperationOutcome; detail?: string } | null {
  if (item.status === 'failed') return { outcome: 'failed', detail: item.error };
  if (item.status === 'completed') {
    if (item.verificationError) return { outcome: 'warning', detail: item.verificationError };
    return { outcome: 'success' };
  }
  return null;
}

/**
 * Long-operation notifications (#81): Layout-level wiring with no UI of its
 * own — it feeds the notification center (and, for long operations, desktop
 * notifications through the existing IPC, gated by the settings) from the two
 * places operations complete:
 *
 *  1. the batch pipeline (`useBatchUpdate`) — precise outcomes for working-copy
 *     updates it ran;
 *  2. the mutation activity IPC — durations for any other mutation (commit,
 *     checkout, …) via `createMutationCompletionWatcher`.
 *
 * Both sources announce through the same dedupe so one completion is one
 * notification.
 */
export function OperationNotifications() {
  const { settings } = useSettings();
  const { items } = useBatchUpdate();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const startedAtRef = useRef(new Map<string, number>());
  const reportedRef = useRef(new Set<string>());

  const announce = useCallback((operation: CompletedOperation, toast: boolean) => {
    if (!shouldAnnounceOperation(operation.path)) return;
    markOperationAnnounced(operation.path);
    if (!shouldRecordInCenter(operation)) return;
    pushNotification({
      severity: operation.outcome === 'failed' ? 'error' : operation.outcome,
      title: titleOf(operation),
      body: bodyOf(operation),
      source: 'operation',
      workingCopyPath: operation.path,
      toast,
    });
    void fireDesktopNotification(settingsRef.current, operation);
  }, []);

  // Batch pipeline outcomes.
  useEffect(() => {
    const startedAt = startedAtRef.current;
    const reported = reportedRef.current;
    for (const item of items) {
      const key = `${item.path}#${item.status}`;
      if (item.status === 'queued' || item.status === 'running') {
        if (!startedAt.has(item.path)) startedAt.set(item.path, Date.now());
        continue;
      }
      if (REPORTED.has(item.status)) {
        if (reported.has(key)) continue;
        reported.add(key);
        const started = startedAt.get(item.path);
        startedAt.delete(item.path);
        if (started === undefined) continue;
        const resolved = outcomeOf(item);
        if (!resolved) continue;
        announce(
          {
            path: item.path,
            label: 'Update',
            durationMs: Math.max(0, Date.now() - started),
            outcome: resolved.outcome,
            detail: resolved.detail,
            revision: item.revision ?? undefined,
          },
          item.status === 'failed' || isLongOperation(Date.now() - started)
        );
      }
    }
    // Prune per-path start markers for items that vanished without a report.
    const live = new Set(items.map((item) => item.path));
    for (const path of Array.from(startedAt.keys())) {
      if (!live.has(path)) startedAt.delete(path);
    }
  }, [items, announce]);

  // Any other working-copy mutation (commit, checkout, …).
  useEffect(() => {
    const watcher = createMutationCompletionWatcher({
      onCompleted: ({ path, durationMs, success }) => {
        announce(
          {
            path,
            label: 'SVN operation',
            durationMs,
            outcome: success ? 'success' : 'failed',
            detail: success ? undefined : 'The operation did not report success.',
          },
          isLongOperation(durationMs)
        );
      },
    });

    const unsubscribeState = window.api.svn.onWorkingCopyMutationStateChanged((paths) => {
      watcher.onActivePathsChanged(paths);
    });
    const unsubscribeMutation = window.api.svn.onMutation((notification) => {
      watcher.onMutationNotification(notification.localPaths);
    });

    return () => {
      watcher.dispose();
      unsubscribeState();
      unsubscribeMutation();
    };
  }, [announce]);

  return null;
}

function titleOf(operation: CompletedOperation): string {
  const name = operation.path.split(/[/\\]/).filter(Boolean).pop() || operation.path;
  const verb =
    operation.outcome === 'failed'
      ? 'failed'
      : operation.outcome === 'warning'
        ? 'finished with warnings'
        : 'finished';
  return `${operation.label} ${verb} — ${name}`;
}

function bodyOf(operation: CompletedOperation): string {
  const seconds = operation.durationMs / 1000;
  const parts = [seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`];
  if (operation.revision !== undefined && operation.revision !== null) parts.push(`r${operation.revision}`);
  if (operation.detail) parts.push(operation.detail);
  return parts.join(' · ');
}
