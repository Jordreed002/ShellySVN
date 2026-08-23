import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { FileInfo } from '@shared/types';
import {
  addPatchToIndex,
  dryRunHasConflicts,
  findRejectFiles,
  isRejectFileName,
  loadPatchIndex,
  locateHunkInContent,
  parsePatchActionLines,
  parseRejectFile,
  rejectFileTarget,
  removePatchFromIndex,
  summarizeDryRunOutput,
  type PatchHubEntry,
} from '../patchHub';

function entry(overrides: Partial<PatchHubEntry> = {}): PatchHubEntry {
  return {
    id: 'patch-1',
    name: 'changes.patch',
    path: '/patches/changes.patch',
    workingCopyPath: '/wc',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function file(name: string, path: string, isDirectory = false): FileInfo {
  return { name, path, isDirectory, size: 10, modifiedTime: '2026-01-01T00:00:00Z' };
}

describe('patch hub index persistence', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = new Map();
    window.api = createMockElectronAPI();
    window.api.store.get = vi.fn(async (key: string) => store.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads an empty index when nothing is stored', async () => {
    expect(await loadPatchIndex()).toEqual([]);
  });

  it('drops malformed entries and keeps valid ones', async () => {
    store.set('shellysvn:patch-hub:v1', [
      entry(),
      { id: 'bad' }, // missing everything else
      { ...entry({ id: 'patch-2' }), path: 42 }, // wrong type
      null,
    ]);
    const loaded = await loadPatchIndex();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('patch-1');
  });

  it('treats a non-array payload as an empty index', async () => {
    store.set('shellysvn:patch-hub:v1', { nope: true });
    expect(await loadPatchIndex()).toEqual([]);
  });

  it('prepends new patches and refreshes duplicates instead of duplicating them', async () => {
    await addPatchToIndex(entry());
    await addPatchToIndex(entry({ id: 'patch-2', path: '/patches/other.patch' }));
    // Same path again — refresh, not duplicate.
    await addPatchToIndex(entry({ id: 'patch-3', createdAt: '2026-02-02T00:00:00.000Z' }));
    const loaded = await loadPatchIndex();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('patch-3'); // newest first
  });

  it('removes patches by path', async () => {
    await addPatchToIndex(entry());
    await addPatchToIndex(entry({ id: 'patch-2', path: '/patches/other.patch' }));
    const remaining = await removePatchFromIndex('/patches/changes.patch');
    expect(remaining.map((item) => item.id)).toEqual(['patch-2']);
    expect(await loadPatchIndex()).toHaveLength(1);
  });
});

describe('dry-run output parsing', () => {
  it('parses action lines with their action chars', () => {
    const actions = parsePatchActionLines('U src/a.ts\nC src/b.ts\nA src/new.ts\nJunk line\nD src/old.ts');
    expect(actions).toEqual([
      { action: 'U', path: 'src/a.ts' },
      { action: 'C', path: 'src/b.ts' },
      { action: 'A', path: 'src/new.ts' },
      { action: 'D', path: 'src/old.ts' },
    ]);
  });

  it('summarizes conflicts, rejects, offsets and fuzz', () => {
    const summary = summarizeDryRunOutput(
      [
        'U    src/patched.ts',
        'C    src/conflicted.ts',
        '>         rejected hunk #1',
        '>         applied hunk #2 with offset 3 lines',
        '>         applied hunk #3 with fuzz 2',
      ].join('\n')
    );
    expect(summary.actions).toHaveLength(2);
    expect(summary.conflicts).toEqual([{ action: 'C', path: 'src/conflicted.ts' }]);
    expect(summary.rejects).toBe(2); // 1 textual + 1 conflict
    expect(summary.offsetHunks).toBe(1);
    expect(summary.fuzzedHunks).toBe(1);
    expect(dryRunHasConflicts(summary)).toBe(true);
  });

  it('uses the explicit reject count when svn reports one', () => {
    const summary = summarizeDryRunOutput('U    a.ts\n1 reject.\n');
    expect(summary.rejects).toBe(1);
  });

  it('reports a clean dry run', () => {
    const summary = summarizeDryRunOutput('U    a.ts\n');
    expect(dryRunHasConflicts(summary)).toBe(false);
  });
});

describe('reject file helpers', () => {
  it('recognizes both reject file naming schemes', () => {
    expect(isRejectFileName('a.ts.svnpatch.rej')).toBe(true);
    expect(isRejectFileName('a.ts.rej')).toBe(true);
    expect(isRejectFileName('a.ts')).toBe(false);
    expect(isRejectFileName('rej.ts')).toBe(false);
  });

  it('derives the target path from a reject file path', () => {
    expect(rejectFileTarget('/wc/src/a.ts.svnpatch.rej')).toBe('/wc/src/a.ts');
    expect(rejectFileTarget('/wc/src/a.ts.rej')).toBe('/wc/src/a.ts');
    expect(rejectFileTarget('/wc/src/a.ts')).toBe('/wc/src/a.ts');
  });

  it('scans the tree for reject files, skipping .svn and unreadable directories', async () => {
    const listDirectory = vi.fn(async (path: string): Promise<FileInfo[]> => {
      const tree: Record<string, FileInfo[]> = {
        '/wc': [file('src', '/wc/src', true), file('.svn', '/wc/.svn', true), file('root.txt', '/wc/root.txt')],
        '/wc/src': [file('a.ts.svnpatch.rej', '/wc/src/a.ts.svnpatch.rej'), file('deep', '/wc/src/deep', true)],
        '/wc/src/deep': [file('b.ts.rej', '/wc/src/deep/b.ts.rej')],
        '/wc/.svn': [file('pristine.txt.rej', '/wc/.svn/pristine.txt.rej')],
      };
      if (path === '/wc/forbidden') throw new Error('EACCES');
      return tree[path] ?? [];
    });

    const rejects = await findRejectFiles('/wc', listDirectory);
    expect(rejects).toEqual(['/wc/src/a.ts.svnpatch.rej', '/wc/src/deep/b.ts.rej']);
  });

  it('respects the depth limit', async () => {
    const listDirectory = vi.fn(async (path: string): Promise<FileInfo[]> => {
      if (path === '/wc') return [file('l1', '/wc/l1', true)];
      if (path === '/wc/l1') return [file('l2', '/wc/l1/l2', true)];
      if (path === '/wc/l1/l2') return [file('deep.rej', '/wc/l1/l2/deep.rej')];
      return [];
    });
    expect(await findRejectFiles('/wc', listDirectory, 1)).toEqual([]);
    expect(await findRejectFiles('/wc', listDirectory, 2)).toEqual(['/wc/l1/l2/deep.rej']);
  });
});

describe('parseRejectFile', () => {
  const REJECT_CONTENT = [
    '--- src/app.ts	(revision 42)',
    '+++ src/app.ts',
    '@@ -10,4 +10,5 @@ function main() {',
    ' context line',
    '-old line',
    '+new line',
    ' trailing context',
    '@@ -30,3 +31,3 @@',
    ' other context',
    '-another old',
    '+another new',
  ].join('\n');

  it('extracts the target path and hunks', () => {
    const parsed = parseRejectFile(REJECT_CONTENT);
    expect(parsed.targetPath).toBe('src/app.ts');
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].oldStart).toBe(10);
    expect(parsed.hunks[0].lines).toEqual([
      { kind: 'context', text: 'context line' },
      { kind: 'remove', text: 'old line' },
      { kind: 'add', text: 'new line' },
      { kind: 'context', text: 'trailing context' },
    ]);
    expect(parsed.hunks[1].oldStart).toBe(30);
  });

  it('handles content without a target header', () => {
    const parsed = parseRejectFile('@@ -1,1 +1,1 @@\n ctx\n');
    expect(parsed.targetPath).toBeNull();
    expect(parsed.hunks).toHaveLength(1);
  });
});

describe('locateHunkInContent', () => {
  const hunk = {
    header: '@@ -2,3 +2,4 @@',
    oldStart: 2,
    lines: [
      { kind: 'context' as const, text: 'alpha' },
      { kind: 'remove' as const, text: 'beta' },
      { kind: 'add' as const, text: 'BETA' },
      { kind: 'context' as const, text: 'gamma' },
    ],
  };

  it('locates the hunk by matching context lines and interleaves the file around it', () => {
    const fileContent = ['start', 'alpha', 'beta', 'gamma', 'end', 'tail'].join('\n');
    const located = locateHunkInContent(fileContent, hunk);
    expect(located.matched).toBe(true);
    expect(located.matchedAt).toBe(2); // 1-based line of 'alpha'
    const kinds = located.rows.map((row) => row.kind);
    expect(kinds).toEqual([
      'context', // 'start' before
      'context', // alpha
      'rejected-remove', // beta (matches the file)
      'rejected-add', // BETA (not in file)
      'context', // gamma
      'context', // 'end' after
      'context', // 'tail' after
    ]);
  });

  it('falls back to the recorded line number when context no longer matches', () => {
    const fileContent = ['totally', 'different', 'content'].join('\n');
    const located = locateHunkInContent(fileContent, hunk);
    expect(located.matched).toBe(false);
    expect(located.matchedAt).toBe(2);
  });

  it('keeps the window bounded by the context size', () => {
    const fileContent = Array.from({ length: 50 }, (_, index) => `line-${index}`).join('\n');
    const contextOnly = {
      header: '@@ -10,2 +10,2 @@',
      oldStart: 10,
      lines: [
        { kind: 'context' as const, text: 'line-9' },
        { kind: 'context' as const, text: 'line-10' },
      ],
    };
    const located = locateHunkInContent(fileContent, contextOnly, 2);
    // 2 before + 2 hunk lines + 2 after
    expect(located.rows).toHaveLength(6);
    expect(located.rows[0].text).toBe('line-7');
    expect(located.rows[located.rows.length - 1].text).toBe('line-12');
  });
});
