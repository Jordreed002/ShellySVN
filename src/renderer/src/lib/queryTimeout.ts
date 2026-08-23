/**
 * A ceiling on every `queryFn`, so a hung IPC call becomes an error instead of
 * an eternal spinner.
 *
 * The renderer talks to Subversion exclusively through `window.api`, and a
 * wedged `svn` process (a stalled network mount, a locked working copy) leaves
 * the promise pending forever. TanStack Query has no built-in deadline, so this
 * module supplies one in two layers:
 *
 *  1. `withTimeout` races any promise against a timer and rejects with
 *     {@link QueryTimeoutError} when the timer wins.
 *  2. `createAppQueryClient` patches the client's `defaultQueryOptions` so
 *     *every* query's `queryFn` is wrapped unless the query opts out. All entry
 *     points funnel through `defaultQueryOptions` — observers, `fetchQuery`,
 *     `prefetchQuery`, `ensureQueryData` — so one patch covers the whole app.
 *
 * A query can tune the ceiling (`meta: { timeoutMs }`) or drop it entirely
 * (`meta: { noTimeout: true }`) for the rare read that is slow by design.
 *
 * Timeouts are deliberately not retried: re-running a call that just hung only
 * doubles the wait. The error surfaces to the UI, where the shared ErrorPanel
 * offers the retry as a user decision.
 */

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

/**
 * The grace period a query keeps its spinner before this becomes an error.
 * Long enough for a legitimate `svn log` over a slow link; short enough that a
 * wedged process is reported within a minute.
 */
export const DEFAULT_QUERY_TIMEOUT_MS = 45_000;

/** Marker set on a wrapped `queryFn` so re-defaulting never double-wraps. */
const TIMED_QUERY_FN = Symbol('shellysvn:timed-query-fn');

/** Thrown when a query or IPC call exceeds its deadline. */
export class QueryTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly source: string;

  constructor(source: string, timeoutMs: number) {
    super(`${source} did not respond within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'QueryTimeoutError';
    this.timeoutMs = timeoutMs;
    this.source = source;
  }
}

export function isQueryTimeoutError(error: unknown): error is QueryTimeoutError {
  return error instanceof QueryTimeoutError;
}

/** Human label for a query key — its scope, e.g. `svn:log` of `['svn:log', p]`. */
export function describeQuerySource(queryKey: readonly unknown[]): string {
  const scope = queryKey[0];
  return typeof scope === 'string' && scope !== '' ? scope : 'request';
}

/**
 * Race `promise` against a timer.
 *
 * The timer is always cleared — win or lose — so a late resolution after a
 * timeout cannot surface as an unhandled rejection.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS,
  source = 'request'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueryTimeoutError(source, timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Wrap a bare async call (an imperative IPC fetch, not a `queryFn`). */
export function withIpcTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS,
  source = 'request'
): Promise<T> {
  return withTimeout(operation(), timeoutMs, source);
}

/**
 * Default retry policy: one retry for ordinary failures (matching the previous
 * `retry: 1`), none for timeouts.
 */
export function defaultQueryRetry(failureCount: number, error: unknown): boolean {
  if (isQueryTimeoutError(error)) return false;
  return failureCount < 1;
}

type TimedQueryFn = ((context: never) => Promise<unknown>) & { [TIMED_QUERY_FN]?: boolean };

interface TimeoutQueryMeta {
  timeoutMs?: number;
  noTimeout?: boolean;
}

/**
 * Patch a {@link QueryClient} so every query's `queryFn` runs under a deadline.
 *
 * `defaultQueryOptions` is the one choke point every fetch path already calls
 * with the raw user options, and it short-circuits already-defaulted objects,
 * so the wrapper is applied exactly once per options object.
 */
export function patchQueryTimeout(client: QueryClient): QueryClient {
  // The signature is generic in six type parameters; the patch only shuttles
  // the options object through, so it is typed by the two fields it touches.
  const original = client.defaultQueryOptions.bind(client) as unknown as (options: object) => {
    queryFn?: unknown;
    meta?: unknown;
    object;
  };

  const patched = (options: object) => {
    const defaulted = original(options);
    const queryFn = defaulted.queryFn as TimedQueryFn | undefined;

    if (typeof queryFn !== 'function' || queryFn[TIMED_QUERY_FN]) {
      return defaulted;
    }

    const meta = defaulted.meta as TimeoutQueryMeta | undefined;
    if (meta?.noTimeout === true) return defaulted;

    const timeoutMs =
      typeof meta?.timeoutMs === 'number' ? meta.timeoutMs : DEFAULT_QUERY_TIMEOUT_MS;

    const wrapped = Object.assign(
      (context: never) =>
        withTimeout(
          queryFn(context),
          timeoutMs,
          describeQuerySource((context as { queryKey?: readonly unknown[] })?.queryKey ?? [])
        ),
      { [TIMED_QUERY_FN]: true }
    ) as TimedQueryFn;

    // The wrapper preserves the options' runtime shape; only the function is
    // substituted, so the widened cast is safe for every caller.
    return { ...defaulted, queryFn: wrapped };
  };

  client.defaultQueryOptions = patched as unknown as typeof client.defaultQueryOptions;
  return client;
}

/**
 * The app's QueryClient: the caller's configuration plus the timeout ceiling
 * and the no-retry-on-timeout policy as defaults.
 */
export function createAppQueryClient(config: QueryClientConfig = {}): QueryClient {
  const client = new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: {
        retry: defaultQueryRetry,
        ...config.defaultOptions?.queries,
      },
    },
  });

  return patchQueryTimeout(client);
}
