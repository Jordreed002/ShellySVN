import { useCallback, useRef, useState } from 'react';
import type { SvnOperationProgress } from '@shared/types';

/**
 * Shared engine for the import/export wizards (backlog #62): runs one
 * progress-capable `window.api.svn.*WithProgress` invocation, keeps the last
 * progress snapshot, remembers the `operationId` that the preload layer
 * attaches to progress events, and routes cancellation through the existing
 * `svn:cancelOperation` channel.
 *
 * The operation id is only discovered from the first progress event — the
 * preload API creates it internally — so `cancel()` forwards the latest id we
 * have seen and lets the preload fall back to its most recent active
 * operation when none arrived yet.
 */

export type WizardPhase = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';

export interface WizardOperationState<T> {
  phase: WizardPhase;
  /** Last progress snapshot, including the operationId when one has arrived. */
  progress: SvnOperationProgress | null;
  /** Resolved value of the invoke when the phase is 'completed'. */
  result: T | null;
  /** Failure message when the phase is 'error'. */
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Final wall-clock duration, filled once the phase leaves 'running'. */
  elapsedMs: number | null;
  /** True after cancel() was called, until the next start(). */
  cancelRequested: boolean;
}

const IDLE_STATE: WizardOperationState<never> = {
  phase: 'idle',
  progress: null,
  result: null,
  error: null,
  startedAt: null,
  endedAt: null,
  elapsedMs: null,
  cancelRequested: false,
};

export interface WizardResultLike {
  success: boolean;
  error?: string;
}

export interface UseWizardOperationOptions {
  /** Used in fallback error messages, e.g. "Export failed". */
  label?: string;
}

export function useWizardOperation<T extends WizardResultLike = WizardResultLike>(
  options: UseWizardOperationOptions = {}
) {
  const { label = 'Operation' } = options;
  const [state, setState] = useState<WizardOperationState<T>>(
    IDLE_STATE as WizardOperationState<T>
  );

  const runningRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const sawCancelledStatusRef = useRef(false);

  const finish = useCallback(
    (patch: Partial<WizardOperationState<T>>) => {
      setState((previous) => {
        const startedAt = previous.startedAt ?? Date.now();
        return {
          ...previous,
          ...patch,
          endedAt: Date.now(),
          elapsedMs: Date.now() - startedAt,
        };
      });
      runningRef.current = false;
    },
    []
  );

  /**
   * Start the operation. `invoke` receives the progress callback that the
   * preload layer will call with `SvnOperationProgress` payloads; it must
   * forward it to the underlying `*WithProgress` API.
   */
  const start = useCallback(
    (invoke: (onProgress: (progress: SvnOperationProgress) => void) => Promise<T>) => {
      if (runningRef.current) return;

      runningRef.current = true;
      operationIdRef.current = null;
      cancelRequestedRef.current = false;
      sawCancelledStatusRef.current = false;
      const startedAt = Date.now();
      setState({ ...IDLE_STATE, phase: 'running', startedAt } as WizardOperationState<T>);

      const onProgress = (progress: SvnOperationProgress) => {
        if (progress.operationId) operationIdRef.current = progress.operationId;
        if (progress.status === 'cancelled') sawCancelledStatusRef.current = true;
        setState((previous) => ({ ...previous, progress }));
      };

      invoke(onProgress).then(
        (result) => {
          const cancelled = sawCancelledStatusRef.current || (cancelRequestedRef.current && !result.success);
          if (cancelled) {
            finish({ phase: 'cancelled' });
            return;
          }
          if (!result.success) {
            finish({ phase: 'error', error: result.error || `${label} failed` });
            return;
          }
          finish({ phase: 'completed', result });
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error ?? '');
          if (sawCancelledStatusRef.current || cancelRequestedRef.current) {
            finish({ phase: 'cancelled', error: message });
            return;
          }
          finish({ phase: 'error', error: message || `${label} failed` });
        }
      );
    },
    [finish, label]
  );

  /** Abort the in-flight operation through the shared cancel channel. */
  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    cancelRequestedRef.current = true;
    setState((previous) =>
      previous.phase === 'running' ? { ...previous, cancelRequested: true } : previous
    );
    void window.api.svn.cancelOperation(operationIdRef.current ?? undefined).catch(() => {
      // The invoke itself will fail or resolve as cancelled; a failed cancel
      // round-trip (operation already gone) must not mask that outcome.
    });
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    operationIdRef.current = null;
    cancelRequestedRef.current = false;
    sawCancelledStatusRef.current = false;
    setState(IDLE_STATE as WizardOperationState<T>);
  }, []);

  return { ...state, start, cancel, reset };
}
