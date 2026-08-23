/**
 * useOptimisticMutation (#92) — the optimistic-UI contract:
 *
 * - the cache shows the optimistic value the moment the mutation starts;
 * - a failed write rolls the cache back to the exact previous value;
 * - a successful write keeps the optimistic value (optionally invalidating);
 * - returning `undefined` from `optimisticValue` skips the mutation entirely.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  applyOptimisticStep,
  useOptimisticMutation,
  type OptimisticCacheClient,
} from '../useOptimisticMutation';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderOptimistic<TVariables, TCached, TData>(
  options: Parameters<typeof useOptimisticMutation<TVariables, TCached, TData>>[0]
) {
  const queryClient = createClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useOptimisticMutation(options), { wrapper });
  return { hook, queryClient };
}

describe('useOptimisticMutation', () => {
  it('applies the optimistic value immediately and keeps it on success', async () => {
    const onApplied = vi.fn();
    const mutationFn = vi.fn().mockResolvedValue('ok');
    const { hook, queryClient } = renderOptimistic<string, string[], string>({
      queryKey: ['views'],
      optimisticValue: (current, id) => (current ?? []).filter((view) => view !== id),
      mutationFn,
      onApplied,
    });

    queryClient.setQueryData(['views'], ['alpha', 'beta']);

    await act(async () => {
      await hook.result.current.mutateAsync('alpha');
    });

    expect(queryClient.getQueryData(['views'])).toEqual(['beta']);
    expect(mutationFn).toHaveBeenCalledWith('alpha');
    // onApplied fired for the optimistic write and the confirmation.
    expect(onApplied).toHaveBeenCalledWith(['beta'], 'optimistic');
    expect(onApplied).toHaveBeenCalledWith(['beta'], 'confirmed');
  });

  it('rolls the cache back to the previous value when the write fails', async () => {
    const onApplied = vi.fn();
    const onRollback = vi.fn();
    const failure = new Error('store write failed');
    const { hook, queryClient } = renderOptimistic<string, string[], string>({
      queryKey: ['views'],
      optimisticValue: (current, id) => (current ?? []).filter((view) => view !== id),
      mutationFn: vi.fn().mockRejectedValue(failure),
      onApplied,
      onRollback,
    });

    queryClient.setQueryData(['views'], ['alpha', 'beta']);

    await expect(
      act(async () => {
        await hook.result.current.mutateAsync('beta');
      })
    ).rejects.toThrow('store write failed');

    // The exact pre-mutation value is restored, not a refetched one. The
    // rollback lands in the mutation's error chain, a beat after the
    // mutateAsync rejection surfaces — hence waitFor.
    await waitFor(() => expect(queryClient.getQueryData(['views'])).toEqual(['alpha', 'beta']));
    expect(onApplied).toHaveBeenCalledWith(['alpha', 'beta'], 'rollback');
    expect(onRollback).toHaveBeenCalledWith(failure, 'beta');
    // Flush the mutation state dispatch (error) through React.
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.rollbackError).toBe(failure);
  });

  it('skips the mutation when optimisticValue returns undefined', async () => {
    const mutationFn = vi.fn().mockResolvedValue('ok');
    const { hook, queryClient } = renderOptimistic<string, string[], string>({
      queryKey: ['views'],
      optimisticValue: () => undefined,
      mutationFn,
    });

    queryClient.setQueryData(['views'], ['alpha']);

    await act(async () => {
      await hook.result.current.mutateAsync('alpha');
    });

    expect(mutationFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['views'])).toEqual(['alpha']);
  });

  it('reports isPending while the write is in flight and handles undefined cache starts', async () => {
    let resolveWrite: ((value: string) => void) | undefined;
    const { hook, queryClient } = renderOptimistic<string, string[], string>({
      queryKey: ['fresh'],
      optimisticValue: (current, name) => [...(current ?? []), name],
      mutationFn: () =>
        new Promise<string>((resolve) => {
          resolveWrite = resolve;
        }),
    });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = hook.result.current.mutateAsync('first');
    });

    // No cached value existed; the optimistic write still applied from `[]`.
    expect(queryClient.getQueryData(['fresh'])).toEqual(['first']);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    await act(async () => {
      resolveWrite?.('done');
      await pending;
      // Let the success dispatch chain (onSuccess → onSettled → state) settle
      // through a macrotask before React reads the final isPending.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hook.result.current.isPending).toBe(false);
    expect(queryClient.getQueryData(['fresh'])).toEqual(['first']);
  });

  it('invalidates the key after success when asked', async () => {
    const queryClient = createClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useOptimisticMutation<string, string[], string>({
          queryKey: ['views'],
          optimisticValue: (current, id) => [...(current ?? []), id],
          mutationFn: vi.fn().mockResolvedValue('ok'),
          invalidateOnSuccess: true,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutateAsync('alpha');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['views'] });
  });
});

describe('applyOptimisticStep (pure cache step)', () => {
  function fakeClient(): OptimisticCacheClient & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
      data,
      getQueryData: (key) => data.get(String(key)),
      setQueryData: (key, updater) => {
        data.set(String(key), updater);
        return updater;
      },
      invalidateQueries: vi.fn(),
    };
  }

  it('writes the optimistic value and reports the previous one', () => {
    const client = fakeClient();
    client.data.set(String(['views']), ['a', 'b']);

    const step = applyOptimisticStep<string, string[], string>(client, {
      queryKey: ['views'],
      optimisticValue: (current, id) => (current ?? []).filter((view) => view !== id),
      mutationFn: vi.fn(),
    }, 'a');

    expect(step).toEqual({ previous: ['a', 'b'], next: ['b'] });
    expect(client.data.get(String(['views']))).toEqual(['b']);
  });

  it('returns null when the optimistic value is undefined', () => {
    const client = fakeClient();
    const step = applyOptimisticStep<string, string[], string>(client, {
      queryKey: ['views'],
      optimisticValue: () => undefined,
      mutationFn: vi.fn(),
    }, 'a');
    expect(step).toBeNull();
  });
});
