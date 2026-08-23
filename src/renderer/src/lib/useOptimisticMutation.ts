/**
 * useOptimisticMutation (#92) — one typed helper for the optimistic-UI pattern.
 *
 * Wraps `useMutation` + `queryClient` around a single rule:
 *
 * 1. the optimistic value is computed from the current cached data and written
 *    with `setQueryData` **before** the real write starts, so the UI reacts in
 *    the same frame as the click;
 * 2. when the real write fails, the exact previous cached value is written
 *    back — rollback, not a refetch (the failed write never reached the store,
 *    so the old value is still the truth);
 * 3. when it succeeds, the optimistic value simply stays (optionally the key is
 *    invalidated so the next read confirms it).
 *
 * Callers that mirror the cached value into local state (a hook whose data is
 * store-backed rather than query-backed) pass `onApplied`, which fires for the
 * optimistic write, the rollback, and the confirmation alike — so the mirrored
 * state can never disagree with the cache.
 *
 * This is deliberately small: no retries (a failed optimistic write should roll
 * back and surface, not silently retry), no concurrency tracking beyond the
 * last mutation's previous value. Concurrent mutations against the same key
 * roll back to the value observed when *that* mutation started.
 */

import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

/** Where an `onApplied` value came from. */
export type OptimisticPhase = 'optimistic' | 'confirmed' | 'rollback';

export interface UseOptimisticMutationOptions<TVariables, TCached, TData> {
  /** Cache key whose data is the optimistic surface. */
  queryKey: readonly unknown[];
  /**
   * Compute the optimistic value from the current cached one. Returning
   * `undefined` aborts the mutation before anything is written (for "nothing
   * would change" cases).
   */
  optimisticValue: (current: TCached | undefined, variables: TVariables) => TCached | undefined;
  /** The real write. Resolve on success, reject to trigger rollback. */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** Called with every applied value — optimistic, confirmed and rollback. */
  onApplied?: (value: TCached, phase: OptimisticPhase) => void;
  /** Invalidate the key after success so the next read confirms the write. */
  invalidateOnSuccess?: boolean;
  /** Called after a successful write (after `onApplied(_, 'confirmed')`). */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Called after rollback. The helper rethrows nothing; handle it here. */
  onRollback?: (error: unknown, variables: TVariables) => void;
}

export interface UseOptimisticMutationResult<TVariables> {
  /** Fire-and-forget form; rollback is handled internally. */
  mutate: (variables: TVariables) => void;
  /** Awaiting form; rejects only after rollback has already happened. */
  mutateAsync: (variables: TVariables) => Promise<void>;
  isPending: boolean;
  /** The error behind the most recent rollback, if any. */
  rollbackError: unknown;
}

/**
 * The queryClient surface the helper needs — easy to fake in tests without a
 * provider.
 */
export interface OptimisticCacheClient {
  getQueryData: (queryKey: readonly unknown[]) => unknown;
  setQueryData: (queryKey: readonly unknown[], updater: unknown) => unknown;
  invalidateQueries: (filters: { queryKey?: readonly unknown[] }) => Promise<void> | void;
}

/** Apply one optimistic mutation step against a cache client (pure, testable). */
export function applyOptimisticStep<TVariables, TCached, TData>(
  queryClient: OptimisticCacheClient,
  options: UseOptimisticMutationOptions<TVariables, TCached, TData>,
  variables: TVariables
): { previous: TCached | undefined; next: TCached } | null {
  const current = queryClient.getQueryData(options.queryKey) as TCached | undefined;
  const next = options.optimisticValue(current, variables);
  if (next === undefined) return null;
  queryClient.setQueryData(options.queryKey, next);
  options.onApplied?.(next, 'optimistic');
  return { previous: current, next };
}

/**
 * The context the helper threads from `onMutate` to `onSuccess`/`onError`:
 * the cached value observed before the optimistic write, plus whether the
 * mutation was skipped because nothing would change.
 */
export interface OptimisticContext<TCached> {
  previous: TCached | undefined;
  skipped: boolean;
}

/**
 * The optimistic mutation hook. Must run under a `QueryClientProvider`
 * (like every `useMutation` consumer).
 */
export function useOptimisticMutation<TVariables, TCached, TData>(
  options: UseOptimisticMutationOptions<TVariables, TCached, TData>
): UseOptimisticMutationResult<TVariables> {
  const queryClient = useQueryClient() as unknown as QueryClient & OptimisticCacheClient;
  // onMutate runs before mutationFn, so this records the skip decision for it.
  const skipRef = useRef(false);

  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      // A skipped mutation ("nothing would change") must not reach the caller's
      // mutationFn; resolve as a no-op success without calling it.
      if (skipRef.current) return undefined as unknown as TData;
      return options.mutationFn(variables);
    },
    onMutate: (variables): OptimisticContext<TCached> => {
      const step = applyOptimisticStep(queryClient, options, variables);
      skipRef.current = step === null;
      // onMutate's return value is the context handed to onError/onSuccess.
      return step
        ? { previous: step.previous, skipped: false }
        : { previous: undefined, skipped: true };
    },
    onSuccess: (_data, variables, context) => {
      const ctx = context as OptimisticContext<TCached> | undefined;
      if (ctx?.skipped) return;
      options.onApplied?.(readCached<TCached>(queryClient, options.queryKey), 'confirmed');
      options.onSuccess?.(_data, variables);
      if (options.invalidateOnSuccess) {
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      }
    },
    onError: (error, variables, context) => {
      const ctx = context as OptimisticContext<TCached> | undefined;
      if (ctx?.skipped) return;
      // Rollback: restore the exact value observed before the optimistic write.
      queryClient.setQueryData(options.queryKey, ctx?.previous);
      options.onApplied?.(ctx?.previous as TCached, 'rollback');
      options.onRollback?.(error, variables);
    },
  });

  // `mutate` reports failure through the rollback path (onError), never as an
  // unhandled rejection; `mutateAsync` rejects only after rollback has run.
  const fireAndForget = useCallback(
    (variables: TVariables) => mutation.mutate(variables),
    [mutation]
  );
  const awaitable = useCallback(
    async (variables: TVariables) => {
      await mutation.mutateAsync(variables);
    },
    [mutation]
  );

  return {
    mutate: fireAndForget,
    mutateAsync: awaitable,
    isPending: mutation.isPending,
    rollbackError: mutation.error,
  };
}

function readCached<TCached>(
  queryClient: OptimisticCacheClient,
  queryKey: readonly unknown[]
): TCached {
  return queryClient.getQueryData(queryKey) as TCached;
}
