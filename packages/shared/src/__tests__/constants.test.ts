import { describe, expect, it } from 'vitest';

import {
  CACHE_CLEANUP_INTERVAL_MS,
  DEFAULT_DIFF_CACHE_SIZE_BYTES,
  DEFAULT_DIFF_CACHE_TTL_MS,
  DEFAULT_DIFF_CHUNK_SIZE,
  DEFAULT_QUERY_STALE_TIME_MS,
  hoursToMs,
  MAX_COMMIT_MESSAGE_LENGTH,
  MAX_DIFF_LINE_LENGTH_BYTES,
  MAX_FILE_PREVIEW_SIZE_BYTES,
  MAX_FILE_WRITE_SIZE_BYTES,
  mbToBytes,
  minutesToMs,
  MONITOR_REFRESH_INTERVAL_MS,
  OFFLINE_CACHE_SIZE_BYTES,
  OFFLINE_CACHE_TTL_MS,
  secondsToMs,
} from '../constants';

/**
 * J14 — Shared core. These constants are resource and security guardrails
 * (preview/write size caps, diff line-length DoS limit, commit-message cap) and
 * timing budgets used across both processes. A dropped zero here silently
 * weakens a limit or starves a cache, so the exact values are pinned.
 */
describe('size-limit guardrails', () => {
  it('caps text preview at 1 MiB', () => {
    expect(MAX_FILE_PREVIEW_SIZE_BYTES).toBe(1024 * 1024);
  });

  it('caps writes/images at 10 MiB', () => {
    expect(MAX_FILE_WRITE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('caps diff line length at 1 MiB (DoS guard)', () => {
    expect(MAX_DIFF_LINE_LENGTH_BYTES).toBe(1024 * 1024);
  });

  it('caps commit message length at 100,000 characters', () => {
    expect(MAX_COMMIT_MESSAGE_LENGTH).toBe(100_000);
  });

  it('keeps the write cap larger than the preview cap', () => {
    expect(MAX_FILE_WRITE_SIZE_BYTES).toBeGreaterThan(MAX_FILE_PREVIEW_SIZE_BYTES);
  });
});

describe('cache budgets', () => {
  it('sizes the diff cache at 100 MiB and the offline cache at 50 MiB', () => {
    expect(DEFAULT_DIFF_CACHE_SIZE_BYTES).toBe(100 * 1024 * 1024);
    expect(OFFLINE_CACHE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('streams diffs in 1000-line chunks', () => {
    expect(DEFAULT_DIFF_CHUNK_SIZE).toBe(1000);
  });
});

describe('timing budgets (ms)', () => {
  it('pins the polling/refresh intervals', () => {
    expect(MONITOR_REFRESH_INTERVAL_MS).toBe(60_000);
    expect(CACHE_CLEANUP_INTERVAL_MS).toBe(30_000);
    expect(DEFAULT_QUERY_STALE_TIME_MS).toBe(5 * 60_000);
  });

  it('pins the cache TTLs', () => {
    expect(DEFAULT_DIFF_CACHE_TTL_MS).toBe(30 * 60_000);
    expect(OFFLINE_CACHE_TTL_MS).toBe(24 * 60 * 60_000);
  });
});

describe('unit converters', () => {
  it('converts seconds, minutes, and hours to milliseconds', () => {
    expect(secondsToMs(1)).toBe(1000);
    expect(minutesToMs(1)).toBe(60_000);
    expect(hoursToMs(1)).toBe(60 * 60_000);
  });

  it('converts megabytes to bytes', () => {
    expect(mbToBytes(1)).toBe(1024 * 1024);
    expect(mbToBytes(10)).toBe(MAX_FILE_WRITE_SIZE_BYTES);
  });
});
