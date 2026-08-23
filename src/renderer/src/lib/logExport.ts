/**
 * CSV/JSON export for the filtered log result set (#66).
 *
 * Serialization is pure (and unit-tested); `exportLogEntries` handles the
 * transport: the app's native save dialog (`window.api.dialog.saveFile`) plus
 * `window.api.fs.writeFile`, exactly like CreatePatchDialog. When the native
 * bridge or the write is unavailable the content is copied to the clipboard
 * and reported, so the export action always leaves the user with something.
 */

import type { SvnLogEntry } from '@shared/types';

export type LogExportFormat = 'csv' | 'json';

export interface ExportLogResult {
  status: 'saved' | 'cancelled' | 'copied' | 'failed';
  /** Chosen file path, when saved. */
  path?: string;
  /** Human-readable outcome for the caller to report. */
  message: string;
  /** The serialized payload (useful for tests and fallbacks). */
  content: string;
}

const CSV_COLUMNS = ['revision', 'date', 'author', 'message', 'paths', 'actions'] as const;

/** Quote a CSV cell; RFC-4180 style — quotes doubled, embedded newlines kept. */
export function csvEscape(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (/[",\n;]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function logEntriesToCsv(entries: readonly SvnLogEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    const paths = entry.paths ?? [];
    const cells = [
      String(entry.revision),
      entry.date,
      entry.author,
      entry.message ?? '',
      paths.map((changed) => changed.path).join('; '),
      paths.map((changed) => changed.action).join(''),
    ].map(csvEscape);
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function logEntriesToJson(entries: readonly SvnLogEntry[], exportedAt?: Date): string {
  const payload = {
    format: 'shellysvn-log-export',
    version: 1,
    exportedAt: (exportedAt ?? new Date()).toISOString(),
    entryCount: entries.length,
    entries: entries.map((entry) => ({
      revision: entry.revision,
      date: entry.date,
      author: entry.author,
      message: entry.message,
      paths: (entry.paths ?? []).map((changed) => ({
        action: changed.action,
        path: changed.path,
        ...(changed.copyFromPath !== undefined ? { copyFromPath: changed.copyFromPath } : {}),
        ...(changed.copyFromRev !== undefined ? { copyFromRev: changed.copyFromRev } : {}),
      })),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function serializeLogEntries(
  entries: readonly SvnLogEntry[],
  format: LogExportFormat,
  exportedAt?: Date
): string {
  return format === 'csv' ? logEntriesToCsv(entries) : logEntriesToJson(entries, exportedAt);
}

export function defaultExportFileName(
  path: string | null | undefined,
  format: LogExportFormat,
  now?: Date
): string {
  const leaf = (path ?? '').split(/[/\\]/).filter(Boolean).pop() ?? 'log';
  const safeLeaf = leaf.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'log';
  const day = (now ?? new Date()).toISOString().slice(0, 10);
  return `svn-log-${safeLeaf}-${day}.${format}`;
}

async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export `entries` (the caller passes the currently filtered set) through the
 * native save dialog. Cancelling the dialog is a no-op; a failed write or a
 * missing bridge falls back to the clipboard and says so.
 */
export async function exportLogEntries(
  entries: readonly SvnLogEntry[],
  format: LogExportFormat,
  options?: { path?: string | null; defaultName?: string; exportedAt?: Date }
): Promise<ExportLogResult> {
  const content = serializeLogEntries(entries, format, options?.exportedAt);
  const defaultName =
    options?.defaultName ?? defaultExportFileName(options?.path ?? null, format, options?.exportedAt);

  const saveFile = window.api?.dialog?.saveFile?.bind(window.api.dialog);
  const writeFile = window.api?.fs?.writeFile?.bind(window.api.fs);

  if (saveFile && writeFile) {
    try {
      const target = await saveFile(defaultName);
      if (!target) {
        return { status: 'cancelled', message: 'Export cancelled', content };
      }
      const result = await writeFile(target, content);
      if (result.success) {
        return { status: 'saved', path: target, message: `Saved ${target}`, content };
      }
      throw new Error(result.error || 'Writing the export file failed');
    } catch {
      // fall through to the clipboard fallback below
    }
  }

  const copied = await copyToClipboard(content);
  if (copied) {
    return {
      status: 'copied',
      message: `File save unavailable — ${format.toUpperCase()} copied to clipboard instead`,
      content,
    };
  }
  return {
    status: 'failed',
    message: `Export failed: could not write a file or reach the clipboard`,
    content,
  };
}
