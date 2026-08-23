import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FsStatusResult, SvnChildCommitInfo } from '@shared/types';
import {
  buildMixedRevisionItems,
  deriveMixedRevisions,
  resolveIncomingChanges,
  type IncomingChange,
  type MixedRevisionSummary,
} from '@renderer/lib/workingCopyFreshness';

/**
 * Mixed-revision detection over facts already on screen.
 *
 * The items are built by the caller from whatever it already holds (the Files
 * surface passes its deep status and child-commit reads); the derivation is
 * memoized so the banner costs nothing per render. See
 * `lib/workingCopyFreshness` for what "mixed" means here and for the limits of
 * deriving it without new SVN calls.
 */
export function useMixedRevisions({
  baseRevision,
  items,
}: {
  baseRevision?: number;
  items: readonly import('@renderer/lib/workingCopyFreshness').FreshnessItem[];
}): MixedRevisionSummary | null {
  return useMemo(() => deriveMixedRevisions({ baseRevision, items }), [baseRevision, items]);
}

/**
 * Read a cached query's data — and only that. Like the status bar's
 * `useKnownSvnVersion`, this observes the cache instead of issuing a call: a
 * cell describing the working copy must never become the reason a working copy
 * is read.
 */
function useCachedQueryData<T>(queryKey: readonly unknown[]): T | undefined {
  const queryClient = useQueryClient();
  const queryCache = queryClient.getQueryCache();

  return useSyncExternalStore(
    (onStoreChange) =>
      queryCache.subscribe((event) => {
        if (event.type === 'updated' || event.type === 'added' || event.type === 'removed') {
          onStoreChange();
        }
      }),
    () => queryClient.getQueryData<T>(queryKey),
    () => undefined
  );
}

/**
 * The active working copy's mixed-revision state, derived from cache entries
 * the Files surface has already populated for that path: `fs:getDeepStatus`
 * (recursive changed items) and `svn:childCommits` (immediate children). When
 * neither has been read yet there is no evidence, so there is no summary —
 * the same "measured fact or absent" rule the status bar applies everywhere.
 */
export function useWorkingCopyMixedRevisions(
  workingCopyPath: string | null | undefined,
  baseRevision?: number
): MixedRevisionSummary | null {
  const deepStatusData = useCachedQueryData<FsStatusResult>([
    'fs:getDeepStatus',
    workingCopyPath ?? '',
  ]);
  const childCommits = useCachedQueryData<Record<string, SvnChildCommitInfo>>([
    'svn:childCommits',
    workingCopyPath ?? '',
  ]);

  const items = useMemo(
    () => buildMixedRevisionItems({ deepStatusData, childCommits, directoryPath: workingCopyPath }),
    [deepStatusData, childCommits, workingCopyPath]
  );

  return useMixedRevisions({ baseRevision, items });
}

/** What the commit gate is doing between "the user pressed Commit" and "svn commit ran". */
export type OodGatePhase =
  /** No check in progress; submits go straight through. */
  | 'idle'
  /** `svn status --show-updates` is running against the repository. */
  | 'checking'
  /** Incoming changes affect the selected paths; the commit is held. */
  | 'blocked'
  /** "Update and retry" is running the update. */
  | 'updating'
  /** The update (not the check) failed; the commit is still held. */
  | 'failed';

export interface OodGateState {
  phase: OodGatePhase;
  incoming: IncomingChange[];
  /** Present in the 'failed' phase: why the update did not complete. */
  error?: string;
}

export interface UseOutOfDateCommitGateOptions {
  workingCopyPath: string;
  /**
   * Whether the commit would survive its own local validation (message,
   * selection, commit rules). The freshness check is a repository round trip
   * and must not fire when the controller would fail fast without it.
   */
  isCommitReady: () => boolean;
  /** Absolute paths selected for commit. */
  getSelectedPaths: () => string[];
  /** Perform the commit (the controller's submit path). */
  runCommit: (event: FormEvent) => void;
  /**
   * Update the working copy using the app's existing update action; returns
   * the action's result so failures can be reported in the panel.
   */
  runUpdate: () => Promise<{ success: boolean; revision?: number; message?: string }>;
  /** Called after a successful update, before the commit is retried. */
  onUpdated?: () => void | Promise<void>;
}

/** A form event for gate-initiated retries: nothing to prevent, nothing to read. */
export const SILENT_FORM_EVENT = { preventDefault: () => undefined } as FormEvent;

/**
 * The out-of-date check in front of every commit.
 *
 * Before the controller's submit path runs, `svn status --show-updates`
 * (already exposed as the `svn:statusRemote` IPC, cancellable through its
 * worker job) is asked whether the repository holds changes for the paths
 * being committed. If it does, the commit is held and the panel offers to
 * update and retry. Every other outcome — local validation failing, the check
 * erroring, the repository being unreachable, the user skipping — lets the
 * commit proceed exactly as it would have without this gate.
 */
export function useOutOfDateCommitGate(options: UseOutOfDateCommitGateOptions) {
  const [state, setState] = useState<OodGateState>({ phase: 'idle', incoming: [] });
  const abortRef = useRef<AbortController | null>(null);
  // Latest-callback refs so the gate never acts on a stale closure while a
  // check is in flight.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stopCheck = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stopCheck, [stopCheck]);

  const proceed = useCallback((event: FormEvent) => {
    setState({ phase: 'idle', incoming: [] });
    optionsRef.current.runCommit(event);
  }, []);

  /**
   * The form's submit handler. Validation failures and check failures both
   * fall through to the untouched commit path — the gate only ever *adds* a
   * blocking step, never a failing one.
   */
  const gateSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (state.phase !== 'idle') return;
      if (!optionsRef.current.isCommitReady()) {
        // Let the controller surface its own validation error; no repository
        // round trip was spent on a commit that cannot start.
        optionsRef.current.runCommit(event);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: 'checking', incoming: [] });

      void (async () => {
        try {
          const result = await window.api.svn.statusRemote(optionsRef.current.workingCopyPath, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          // A failed or unparsed read is not evidence of being up to date,
          // but it is also not evidence of being behind: fail open.
          if (result.error || result.cancelled || !result.remoteChecked) {
            proceed(event);
            return;
          }
          const incoming = resolveIncomingChanges(result, {
            workingCopyPath: optionsRef.current.workingCopyPath,
            selectedPaths: optionsRef.current.getSelectedPaths(),
          });
          if (incoming.length === 0) {
            proceed(event);
            return;
          }
          setState({ phase: 'blocked', incoming });
        } catch {
          // Aborted means the user cancelled or skipped, and both of those
          // paths already chose what happens next — do not act twice.
          if (controller.signal.aborted) return;
          // Offline, auth, timeout — the commit proceeds as it always did.
          proceed(event);
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    },
    [proceed, state.phase]
  );

  /** "Update and retry": update via the existing action, then commit once. */
  const updateAndRetry = useCallback(async () => {
    if (state.phase !== 'blocked' && state.phase !== 'failed') return;
    setState((current) => ({ phase: 'updating', incoming: current.incoming }));
    const result = await optionsRef.current.runUpdate();
    if (!result.success) {
      setState((current) => ({
        phase: 'failed',
        incoming: current.incoming,
        error: result.message || 'Update failed',
      }));
      return;
    }
    await optionsRef.current.onUpdated?.();
    // Re-run the commit flow exactly once, without re-gating: the user has
    // just seen the freshness answer for this attempt.
    setState({ phase: 'idle', incoming: [] });
    optionsRef.current.runCommit(SILENT_FORM_EVENT);
  }, [state.phase]);

  /** Commit without updating — the answer Subversion would give anyway. */
  const commitAnyway = useCallback(() => {
    stopCheck();
    proceed(SILENT_FORM_EVENT);
  }, [proceed, stopCheck]);

  /** Abandon the check (or the blocked state); the commit is not attempted. */
  const cancel = useCallback(() => {
    stopCheck();
    setState({ phase: 'idle', incoming: [] });
  }, [stopCheck]);

  /** While checking: drop the check and commit immediately. */
  const skipCheck = useCallback(
    (event?: FormEvent) => {
      stopCheck();
      proceed(event ?? SILENT_FORM_EVENT);
    },
    [proceed, stopCheck]
  );

  /** Back to a clean slate — called when the dialog closes. */
  const reset = useCallback(() => {
    stopCheck();
    setState({ phase: 'idle', incoming: [] });
  }, [stopCheck]);

  return { state, gateSubmit, updateAndRetry, commitAnyway, cancel, skipCheck, reset };
}
