/**
 * Format seconds to human-readable time string
 *
 * @param seconds - Number of seconds
 * @returns Formatted string (e.g., "1m 30s", "2h 15m")
 *
 * @example
 * formatTime(30)    // "30s"
 * formatTime(90)    // "1m 30s"
 * formatTime(3661)  // "1h 1m"
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
}

/**
 * Format milliseconds to human-readable duration string
 *
 * @param ms - Number of milliseconds
 * @param style - Formatting style: 'short' (e.g., "1.5s") or 'long' (e.g., "< 1 minute")
 * @returns Formatted string
 *
 * @example
 * formatDuration(500)              // "500ms"
 * formatDuration(1500)             // "1.50s"
 * formatDuration(90000)            // "1m 30s"
 * formatDuration(90000, 'long')    // "1 minutes"
 */
export function formatDuration(
  ms: number,
  style: 'short' | 'long' = 'short'
): string {
  if (style === 'long') {
    // Long style for user-friendly display
    if (ms < 60000) return '< 1 minute';
    if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)} hours`;
    return `${Math.floor(ms / 86400000)} days`;
  }

  // Short style for precise display
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
