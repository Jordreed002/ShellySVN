import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnLogEntry } from '@shared/types';
import {
  csvEscape,
  defaultExportFileName,
  exportLogEntries,
  logEntriesToCsv,
  logEntriesToJson,
} from '../logExport';

const entries: SvnLogEntry[] = [
  {
    revision: 42,
    author: 'alice',
    date: '2026-08-22T10:00:00.000Z',
    message: 'Fix the "lock" dialog, again',
    paths: [
      { action: 'M', path: '/trunk/src/lock.tsx' },
      { action: 'A', path: '/trunk/src/lock.css', copyFromPath: '/trunk/old.css', copyFromRev: 40 },
    ],
  },
  {
    revision: 43,
    author: 'bob',
    date: '2026-08-23T11:30:00.000Z',
    message: 'Multi-line\r\nmessage',
    paths: [],
  },
];

describe('logExport — CSV serialization', () => {
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('has,comma')).toBe('"has,comma"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\r\nline2')).toBe('"line1\nline2"');
  });

  it('writes one header plus one row per entry with paths and actions', () => {
    const csv = logEntriesToCsv(entries);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('revision,date,author,message,paths,actions');
    expect(lines[1]).toBe(
      '42,2026-08-22T10:00:00.000Z,alice,"Fix the ""lock"" dialog, again","/trunk/src/lock.tsx; /trunk/src/lock.css",MA'
    );
    // A multi-line message stays inside its quoted cell (trailing newline trimmed).
    expect(lines.slice(2).join('\n')).toBe('43,2026-08-23T11:30:00.000Z,bob,"Multi-line\nmessage",,');
  });
});

describe('logExport — JSON serialization', () => {
  it('emits a versioned envelope with the full entries', () => {
    const json = logEntriesToJson(entries, new Date('2026-08-23T12:00:00.000Z'));
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('shellysvn-log-export');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe('2026-08-23T12:00:00.000Z');
    expect(parsed.entryCount).toBe(2);
    expect(parsed.entries[0].paths[1]).toEqual({
      action: 'A',
      path: '/trunk/src/lock.css',
      copyFromPath: '/trunk/old.css',
      copyFromRev: 40,
    });
    expect(parsed.entries[1].paths).toEqual([]);
  });

  it('derives a filesystem-safe default file name from the path', () => {
    expect(defaultExportFileName('/wc/trunk: my repo', 'csv', new Date('2026-08-23T00:00:00Z'))).toBe(
      'svn-log-trunk-my-repo-2026-08-23.csv'
    );
    expect(defaultExportFileName(null, 'json')).toMatch(/^svn-log-log-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('logExport — transport', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves through the native dialog and writes the file', async () => {
    window.api.dialog.saveFile = vi.fn().mockResolvedValue('/tmp/out.csv');
    window.api.fs.writeFile = vi.fn().mockResolvedValue({ success: true });

    const result = await exportLogEntries(entries, 'csv', { path: '/wc/repo' });

    expect(result.status).toBe('saved');
    expect(result.path).toBe('/tmp/out.csv');
    expect(window.api.dialog.saveFile).toHaveBeenCalledWith(expect.stringMatching(/\.csv$/));
    const [target, content] = (window.api.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(target).toBe('/tmp/out.csv');
    expect(content).toBe(logEntriesToCsv(entries));
  });

  it('cancels cleanly when the user dismisses the dialog', async () => {
    window.api.dialog.saveFile = vi.fn().mockResolvedValue(null);
    const result = await exportLogEntries(entries, 'json');
    expect(result.status).toBe('cancelled');
    expect(window.api.fs.writeFile).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when the write fails', async () => {
    window.api.dialog.saveFile = vi.fn().mockResolvedValue('/tmp/out.json');
    window.api.fs.writeFile = vi.fn().mockResolvedValue({ success: false, error: 'disk full' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const result = await exportLogEntries(entries, 'json');

    expect(result.status).toBe('copied');
    expect(result.message).toMatch(/clipboard/i);
    const written = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(written).entryCount).toBe(2);
    expect(JSON.parse(written).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to the clipboard when the native bridge is missing entirely', async () => {
    // Simulate a non-Electron host: no api at all.
    const original = window.api;
    // @ts-expect-error test intentionally blanks the bridge
    window.api = undefined;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const result = await exportLogEntries(entries, 'csv');

    window.api = original;
    expect(result.status).toBe('copied');
    expect(writeText).toHaveBeenCalledOnce();
  });
});
