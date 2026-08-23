/**
 * The deadline primitives: a hung promise becomes a `QueryTimeoutError`, the
 * app QueryClient applies that to every queryFn (with meta-based opt-outs),
 * and timeouts are never retried automatically.
 */

import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  QueryTimeoutError,
  createAppQueryClient,
  defaultQueryRetry,
  describeQuerySource,
  isQueryTimeoutError,
  withTimeout,
} from '../queryTimeout';

const never = <T>() => new Promise<T>(() => {});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a hung promise with QueryTimeoutError once the deadline passes', async () => {
    const promise = withTimeout(never(), 5_000, 'svn:log');

    const expectation = expect(promise).rejects.toBeInstanceOf(QueryTimeoutError);
    await vi.advanceTimersByTimeAsync(5_001);
    await expectation;
  });

  it('carries the source and the deadline in the error', async () => {
    const promise = withTimeout(never(), 30_000, 'svn:log');

    const expectation = expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        isQueryTimeoutError(error) && error.source === 'svn:log' && error.timeoutMs === 30_000
    );
    await vi.advanceTimersByTimeAsync(30_001);
    await expectation;
  });

  it('passes a fast promise through untouched', async () => {
    const promise = withTimeout(Promise.resolve('entries'), 60_000, 'svn:log');

    await expect(promise).resolves.toBe('entries');
    // The timer must not outlive the race…
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not turn a late rejection into an unhandled error after a timeout', async () => {
    let rejectFn: ((error: Error) => void) | undefined;
    const slow = new Promise<string>((_, reject) => {
      rejectFn = reject;
    });

    const promise = withTimeout(slow, 5, 'svn:log');
    const expectation = expect(promise).rejects.toBeInstanceOf(QueryTimeoutError);
    await vi.advanceTimersByTimeAsync(6);
    await expectation;

    // The underlying call finally fails, long after the race was decided.
    rejectFn?.(new Error('process died'));
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
  });
});

describe('describeQuerySource', () => {
  it('names the key scope when there is one', () => {
    expect(describeQuerySource(['svn:log', '/wc'])).toBe('svn:log');
    expect(describeQuerySource([])).toBe('request');
    expect(describeQuerySource([42])).toBe('request');
  });
});

describe('defaultQueryRetry', () => {
  it('retries an ordinary failure once and a timeout never', () => {
    expect(defaultQueryRetry(0, new Error('E175002'))).toBe(true);
    expect(defaultQueryRetry(1, new Error('E175002'))).toBe(false);
    expect(defaultQueryRetry(0, new QueryTimeoutError('svn:log', 45_000))).toBe(false);
  });
});

describe('createAppQueryClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns a hung queryFn into a QueryTimeoutError via fetchQuery', async () => {
    const client = createAppQueryClient();
    const queryFn = vi.fn(() => never());

    const expectation = expect(
      client.fetchQuery({ queryKey: ['svn:log', '/wc'], queryFn })
    ).rejects.toBeInstanceOf(QueryTimeoutError);

    await vi.advanceTimersByTimeAsync(45_001);
    await expectation;
    // A timeout is not auto-retried — one attempt, then the error is the UI's.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('does not wrap a queryFn twice when options are re-defaulted', async () => {
    const client = createAppQueryClient();
    const queryFn = vi.fn(() => Promise.resolve('value'));
    const options = { queryKey: ['svn:info', '/wc'], queryFn };

    const first = client.defaultQueryOptions(options);
    const second = client.defaultQueryOptions(first);

    await expect(client.fetchQuery(second)).resolves.toBe('value');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('honours meta.timeoutMs as the deadline', async () => {
    const client = createAppQueryClient();
    let resolveFn: ((value: string) => void) | undefined;
    const queryFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        })
    );

    const expectation = expect(
      client.fetchQuery({ queryKey: ['svn:blame', '/wc'], queryFn, meta: { timeoutMs: 250 } })
    ).rejects.toBeInstanceOf(QueryTimeoutError);

    await vi.advanceTimersByTimeAsync(260);
    await expectation;

    // The underlying call settling late must not surface anywhere.
    resolveFn?.('too late');
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
  });

  it('leaves meta.noTimeout queries without a deadline', async () => {
    const client = createAppQueryClient();
    let resolveFn: ((value: string) => void) | undefined;
    const queryFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        })
    );

    let settled: 'pending' | 'resolved' = 'pending';
    const promise = client
      .fetchQuery({ queryKey: ['svn:status', '/wc'], queryFn, meta: { noTimeout: true } })
      .then((value) => {
        settled = 'resolved';
        return value;
      });

    // Well past the app-wide deadline the query is still patiently waiting.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe('pending');

    resolveFn?.('status');
    await expect(promise).resolves.toBe('status');
    expect(settled).toBe('resolved');
  });

  it('retries an ordinary failure once, as the previous default did', async () => {
    const client = createAppQueryClient();
    let attempts = 0;
    const queryFn = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('E175002');
      return 'recovered';
    });

    const expectation = expect(
      client.fetchQuery({ queryKey: ['svn:info', '/wc'], queryFn })
    ).resolves.toBe('recovered');

    // The default retry delay is exponential backoff — one second for the
    // first retry.
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(attempts).toBe(2);
  });

  it('does not change an untouched plain QueryClient', async () => {
    const plain = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    let resolveFn: ((value: string) => void) | undefined;
    const queryFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        })
    );

    let rejected = false;
    const promise = plain.fetchQuery({ queryKey: ['svn:log', '/wc'], queryFn }).catch(() => {
      rejected = true;
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(rejected).toBe(false);

    resolveFn?.('entries');
    // The catch never ran; the fetch resolved normally, late as it was.
    await expect(promise).resolves.toBe('entries');
    expect(rejected).toBe(false);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
