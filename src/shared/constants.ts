/**
 * Shared Constants for ShellySVN
 *
 * Centralized constants for time intervals, file size limits,
 * and other configuration values used across main and renderer processes.
 */

// ============================================
// Time Intervals (in milliseconds)
// ============================================

/** Monitor refresh interval - how often to check working copies for changes */
export const MONITOR_REFRESH_INTERVAL_MS = 60_000; // 1 minute

/** Default stale time for React Query queries */
export const DEFAULT_QUERY_STALE_TIME_MS = 5 * 60_000; // 5 minutes

/** LRU cache cleanup interval for expired entries */
export const CACHE_CLEANUP_INTERVAL_MS = 30_000; // 30 seconds

/** Default TTL for diff cache entries */
export const DEFAULT_DIFF_CACHE_TTL_MS = 30 * 60_000; // 30 minutes

/** Default TTL for offline cache entries */
export const OFFLINE_CACHE_TTL_MS = 24 * 60 * 60_000; // 24 hours

/** Interval for updating offline duration display */
export const OFFLINE_DURATION_UPDATE_INTERVAL_MS = 60_000; // 1 minute

// ============================================
// File Size Limits (in bytes)
// ============================================

/** Maximum file size for text preview (1MB) */
export const MAX_FILE_PREVIEW_SIZE_BYTES = 1024 * 1024;

/** Maximum file size for images and write operations (10MB) */
export const MAX_FILE_WRITE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum line length in diff parsing to prevent memory exhaustion (1MB) */
export const MAX_DIFF_LINE_LENGTH_BYTES = 1024 * 1024;

/** Maximum commit message length (~100KB) */
export const MAX_COMMIT_MESSAGE_LENGTH = 100_000;

/** Default maximum size for diff cache (100MB) */
export const DEFAULT_DIFF_CACHE_SIZE_BYTES = 100 * 1024 * 1024;

/** Maximum size for offline cache (50MB) */
export const OFFLINE_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

// ============================================
// Processing Limits
// ============================================

/** Default chunk size for streaming diff parsing (lines) */
export const DEFAULT_DIFF_CHUNK_SIZE = 1000;

// ============================================
// Helper functions (for readability)
// ============================================

/** Convert seconds to milliseconds */
export const secondsToMs = (seconds: number): number => seconds * 1000;

/** Convert minutes to milliseconds */
export const minutesToMs = (minutes: number): number => minutes * 60_000;

/** Convert hours to milliseconds */
export const hoursToMs = (hours: number): number => hours * 60 * 60_000;

/** Convert megabytes to bytes */
export const mbToBytes = (mb: number): number => mb * 1024 * 1024;
