/**
 * Common Test Utilities
 *
 * Shared helper functions and utilities for testing.
 */

import { vi } from 'vitest';

/**
 * Wait for all pending promises to resolve
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock function that resolves after a delay
 */
export function createDelayedMock<T>(
  value: T,
  delayMs: number = 100
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(value), delayMs))
  );
}

/**
 * Create a mock function that rejects after a delay
 */
export function createDelayedErrorMock(
  error: Error | string,
  delayMs: number = 100
): ReturnType<typeof vi.fn> {
  const err = typeof error === 'string' ? new Error(error) : error;
  return vi.fn().mockImplementation(
    () => new Promise((_, reject) => setTimeout(() => reject(err), delayMs))
  );
}

/**
 * Create a mock that returns different values on sequential calls
 */
export function createSequenceMock<T>(values: T[]): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(() => {
    const value = values[index % values.length];
    index++;
    return Promise.resolve(value);
  });
}

/**
 * Helper to create a mock event emitter
 */
export function createMockEventEmitter<T extends Record<string, any[]>>() {
  const listeners = new Map<keyof T, Set<(...args: any[]) => void>>();

  return {
    on<K extends keyof T>(event: K, callback: (...args: T[K]) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);

      return () => {
        listeners.get(event)?.delete(callback);
      };
    },

    emit<K extends keyof T>(event: K, ...args: T[K]): void {
      listeners.get(event)?.forEach((cb) => cb(...args));
    },

    removeAllListeners(): void {
      listeners.clear();
    },

    getListenerCount<K extends keyof T>(event: K): number {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

/**
 * Helper to create mock file system entries
 */
export function createMockFileEntry(overrides: Partial<{
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}> = {}) {
  return {
    name: 'test.txt',
    path: '/test/test.txt',
    isDirectory: false,
    size: 1024,
    modifiedTime: '2024-01-01T12:00:00Z',
    ...overrides,
  };
}

/**
 * Helper to create mock directory entries
 */
export function createMockDirectoryEntry(overrides: Partial<{
  name: string;
  path: string;
}> = {}) {
  return createMockFileEntry({
    name: 'testdir',
    path: '/test/testdir',
    isDirectory: true,
    size: 0,
    ...overrides,
  });
}

/**
 * Helper to create a temp directory path for tests
 */
export function createTempPath(baseName: string = 'test'): string {
  return `/tmp/shellysvn-test-${baseName}-${Date.now()}`;
}

/**
 * Suppress console output during tests
 */
export function suppressConsole(): () => void {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  };
}

/**
 * Helper for testing async errors
 */
export async function expectAsyncError<T>(
  promise: Promise<T>,
  errorMessage?: string | RegExp
): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to reject, but it resolved');
  } catch (error) {
    if (errorMessage) {
      if (typeof errorMessage === 'string') {
        expect((error as Error).message).toContain(errorMessage);
      } else {
        expect((error as Error).message).toMatch(errorMessage);
      }
    }
    return error as Error;
  }
}

/**
 * Create a mock stream for testing streaming operations
 */
export function createMockStream<T>(items: T[], delayMs: number = 10) {
  let index = 0;
  const callbacks = {
    data: [] as ((item: T) => void)[],
    end: [] as (() => void)[],
    error: [] as ((error: Error) => void)[],
  };

  // Start streaming after a tick
  setTimeout(async () => {
    for (const item of items) {
      callbacks.data.forEach((cb) => cb(item));
      await wait(delayMs);
    }
    callbacks.end.forEach((cb) => cb());
  }, 0);

  return {
    on(event: 'data' | 'end' | 'error', callback: (...args: any[]) => void) {
      if (event in callbacks) {
        (callbacks as any)[event].push(callback);
      }
      return this;
    },
    destroy() {
      callbacks.data = [];
      callbacks.end = [];
      callbacks.error = [];
    },
  };
}

/**
 * Type helper to extract the resolved type of a Promise
 */
export type ResolvedType<T> = T extends Promise<infer U> ? U : T;

/**
 * Type helper for mock functions
 */
export type MockFn<T extends (...args: any[]) => any = (...args: any[]) => any> =
  ReturnType<typeof vi.fn<T>>;

/**
 * Re-export commonly used test utilities
 */
export { vi, describe, it, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
