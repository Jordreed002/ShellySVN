/**
 * Byte formatting options
 */
export interface FormatBytesOptions {
  /** Number of decimal places. Use 'auto' for context-aware precision (default) */
  precision?: number | 'auto';
  /** Maximum unit to use (default: 'TB') */
  maxUnit?: 'B' | 'KB' | 'MB' | 'GB' | 'TB';
  /** Whether to trim trailing zeros (default: false) */
  trimZeros?: boolean;
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Number of bytes to format
 * @param options - Formatting options
 * @returns Formatted string (e.g., "1.5 MB")
 *
 * @example
 * formatBytes(0)                       // "0 B"
 * formatBytes(1024)                    // "1 KB"
 * formatBytes(1536)                    // "1.5 KB"
 * formatBytes(1536, { precision: 2 })  // "1.50 KB"
 * formatBytes(1536, { trimZeros: true })  // "1.5 KB"
 */
export function formatBytes(
  bytes: number,
  options: FormatBytesOptions = {}
): string {
  const {
    precision = 'auto',
    maxUnit = 'TB',
    trimZeros = false,
  } = options;

  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const maxUnitIndex = units.indexOf(maxUnit);
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    maxUnitIndex
  );

  const size = bytes / Math.pow(k, i);

  let formatted: string;

  if (precision === 'auto') {
    // Auto precision: no decimals for bytes/KB, 1 decimal for MB+
    if (i === 0) {
      formatted = `${Math.round(size)}`;
    } else if (i === 1) {
      formatted = `${Math.round(size)}`;
    } else {
      formatted = size.toFixed(1);
    }
  } else {
    formatted = size.toFixed(precision);
  }

  // Optionally trim trailing zeros
  if (trimZeros) {
    formatted = parseFloat(formatted).toString();
  }

  return `${formatted} ${units[i]}`;
}
