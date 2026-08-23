// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { collapseNestedFiles } from '../svn-portable-shelf-files';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('electron', () => ({
  app: undefined,
  shell: undefined,
}));

import { portableShelfApply, portableShelfSave } from '../svn-portable-shelves';

/**
 * J4 / J14 — Portable shelves.
 *
 * When a shelf captures a directory, every file nested under it is redundant —
 * restoring the directory already restores its contents. `collapseNestedFiles`
 * drops those nested entries so a shelf stores the minimal set. A regression
 * here either bloats shelves with redundant entries or, worse, drops a file by
 * misclassifying a sibling as nested.
 */
const SEP = '/';

function file(relativePath: string) {
  return { relativePath, status: 'M', kind: 'file' as const };
}
function dir(relativePath: string) {
  return { relativePath, status: 'M', kind: 'directory' as const };
}
function paths(entries: ReturnType<typeof file>[]) {
  return entries.map((e) => e.relativePath);
}

describe('collapseNestedFiles', () => {
  it('returns an empty list unchanged', () => {
    expect(collapseNestedFiles([])).toEqual([]);
  });

  it('keeps every entry when nothing is nested under a listed directory', () => {
    const entries = [file(`src${SEP}a.ts`), file(`src${SEP}b.ts`), file(`readme.md`)];
    expect(paths(collapseNestedFiles(entries))).toEqual([
      `src${SEP}a.ts`,
      `src${SEP}b.ts`,
      'readme.md',
    ]);
  });

  it('drops files that live under a listed directory', () => {
    const entries = [
      dir('src'),
      file(`src${SEP}a.ts`),
      file(`src${SEP}nested${SEP}b.ts`),
      file('readme.md'),
    ];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src', 'readme.md']);
  });

  it('collapses directories nested under other listed directories', () => {
    const entries = [dir('src'), dir(`src${SEP}nested`), file(`src${SEP}nested${SEP}deep.ts`)];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src']);
  });

  it('does not collapse siblings that merely share a name prefix', () => {
    // 'src' is not a listed directory here, so src-foo must survive even though
    // its path starts with "src".
    const entries = [file('src-foo.ts'), file(`src${SEP}bar.ts`)];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src-foo.ts', `src${SEP}bar.ts`]);
  });

  it('is order-independent', () => {
    const a = [dir('src'), file(`src${SEP}a.ts`)];
    const b = [file(`src${SEP}a.ts`), dir('src')];
    expect(paths(collapseNestedFiles(a))).toEqual(['src']);
    expect(paths(collapseNestedFiles(b))).toEqual(['src']);
  });

  /*
   * Portable shelves are cross-platform artifacts: one created on macOS (/)
   * may be inspected or restored on Windows (\). Containment must therefore be
   * decided on a canonical separator, not the host's path.sep — otherwise the
   * nested files survive on the "wrong" platform and shelves store redundancy.
   */
  it('collapses across mismatched separators (portable shelf made on another OS)', () => {
    // Directory recorded with the host separator, nested file with the other.
    const backslashDir = [dir('src'), file('src\\nested\\a.ts')];
    const forwardSlashDir = [dir('src'), file('src/nested/a.ts')];

    expect(paths(collapseNestedFiles(backslashDir))).toEqual(['src']);
    expect(paths(collapseNestedFiles(forwardSlashDir))).toEqual(['src']);
  });

  it('does not collapse a sibling whose name merely prefixes the directory', () => {
    // 'src' the directory must not swallow 'src-other/a.ts'.
    const entries = [dir('src'), file('src-other/a.ts')];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src', 'src-other/a.ts']);
  });
});

/*
 * Zip-slip hardening: `metadata.json` inside a portable shelf is on-disk data
 * whose entry names could be crafted (the shelf equivalent of archive entry
 * paths). Restore must reject entries that traverse out of the working copy,
 * resolve through symlinks, or plant symlinks; capture must not write outside
 * the shelf's own files directory.
 */
describe('portable shelf extraction hardening', () => {
  let shelfBase: string;
  let workingCopy: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    shelfBase = await mkdtemp(join(tmpdir(), 'shellysvn-shelf-root-'));
    workingCopy = await mkdtemp(join(tmpdir(), 'shellysvn-shelf-wc-'));
    vi.stubEnv('SHELLYSVN_PORTABLE_SHELF_ROOT', shelfBase);
    // A clean working copy for the apply pre-flight status check.
    mockState.runSvnText.mockResolvedValue('');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function shelfDirectoryFor(wcPath: string, name: string): string {
    const key = createHash('sha256').update(resolve(wcPath)).digest('hex');
    const safeName = Buffer.from(name, 'utf8').toString('base64url');
    return join(shelfBase, 'portable-shelves', key, safeName);
  }

  async function craftShelf(
    name: string,
    files: Array<{ relativePath: string; status: string; kind: 'file' | 'directory' }>,
    options: { patch?: string } = {}
  ): Promise<string> {
    const directory = shelfDirectoryFor(workingCopy, name);
    await mkdir(join(directory, 'files'), { recursive: true });
    await writeFile(
      join(directory, 'metadata.json'),
      JSON.stringify({
        version: 1,
        name,
        workingCopyPath: resolve(workingCopy),
        createdAt: new Date().toISOString(),
        files,
      }),
      'utf8'
    );
    await writeFile(join(directory, 'changes.patch'), options.patch ?? '', 'utf8');
    return directory;
  }

  it('saves and restores a portable shelf round-trip', async () => {
    await writeFile(join(workingCopy, 'a.txt'), 'shelved content', 'utf8');
    mockState.runSvnText.mockImplementation((args: string[]) => {
      if (args[0] === 'status') {
        return Promise.resolve(
          `<?xml version="1.0"?><status><target path="."><entry path="a.txt">` +
            `<wc-status item="modified" props="none"/></entry></target></status>`
        );
      }
      if (args[0] === 'diff') return Promise.resolve('diff --git a/a.txt b/a.txt');
      return Promise.resolve('');
    });

    await expect(portableShelfSave('default', workingCopy, 'message')).resolves.toMatchObject({
      success: true,
    });

    const shelfDirectory = shelfDirectoryFor(workingCopy, 'default');
    await expect(readFile(join(shelfDirectory, 'files', 'a.txt'), 'utf8')).resolves.toBe(
      'shelved content'
    );

    // Simulate the post-save revert, then restore (working copy is clean).
    await writeFile(join(workingCopy, 'a.txt'), 'reverted', 'utf8');
    mockState.runSvnText.mockResolvedValue('');
    await expect(portableShelfApply('default', workingCopy)).resolves.toMatchObject({
      success: true,
    });
    await expect(readFile(join(workingCopy, 'a.txt'), 'utf8')).resolves.toBe('shelved content');
  });

  it('rejects crafted entries that traverse out of the working copy (zip-slip)', async () => {
    await craftShelf('evil', [
      { relativePath: '../../../stolen.txt', status: 'modified', kind: 'file' },
    ]);

    await expect(portableShelfApply('evil', workingCopy)).rejects.toThrow(
      /must not contain ".." segments/
    );
  });

  it('rejects crafted entries that are absolute paths', async () => {
    await craftShelf('absolute', [
      { relativePath: '/etc/passwd', status: 'modified', kind: 'file' },
    ]);

    await expect(portableShelfApply('absolute', workingCopy)).rejects.toThrow(/must be relative/);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects entries that resolve through a working-copy symlink (zip-slip via symlink)',
    async () => {
      const outside = await mkdtemp(join(tmpdir(), 'shellysvn-shelf-outside-'));
      await writeFile(join(outside, 'secret.txt'), 'classified', 'utf8');
      await symlink(outside, join(workingCopy, 'link'));
      await craftShelf('symlinked', [
        { relativePath: 'link/secret.txt', status: 'modified', kind: 'file' },
      ]);

      await expect(portableShelfApply('symlinked', workingCopy)).rejects.toThrow(
        /symlink|resolves outside/
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects symlink entries planted inside the shelf itself',
    async () => {
      const outside = await mkdtemp(join(tmpdir(), 'shellysvn-shelf-outside-'));
      // A symlink to an existing file: caught by the source-side containment
      // audit (realpath resolves through it, outside the files directory).
      await craftShelf('planted', [
        { relativePath: 'payload.txt', status: 'modified', kind: 'file' },
      ]);
      const directory = shelfDirectoryFor(workingCopy, 'planted');
      const target = join(outside, 'payload.txt');
      await writeFile(target, 'payload', 'utf8');
      await symlink(target, join(directory, 'files', 'payload.txt'));

      await expect(portableShelfApply('planted', workingCopy)).rejects.toThrow(
        /symlink that redirects outside/
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects dangling symlink entries planted inside the shelf itself',
    async () => {
      // A dangling symlink defeats the realpath audit (nothing resolves
      // through it); the explicit lstat check must still refuse to copy it
      // verbatim into the working copy.
      const outside = await mkdtemp(join(tmpdir(), 'shellysvn-shelf-outside-'));
      const directory = await craftShelf('dangling', [
        { relativePath: 'payload.txt', status: 'modified', kind: 'file' },
      ]);
      await symlink(join(outside, 'missing.txt'), join(directory, 'files', 'payload.txt'));

      await expect(portableShelfApply('dangling', workingCopy)).rejects.toThrow(
        /is a symlink and cannot be restored/
      );
    }
  );

  it('rejects status entries that escape the working copy during capture', async () => {
    mockState.runSvnText.mockImplementation((args: string[]) => {
      if (args[0] === 'status') {
        return Promise.resolve(
          `<?xml version="1.0"?><status><target path="."><entry path="../../../outside.txt">` +
            `<wc-status item="modified" props="none"/></entry></target></status>`
        );
      }
      return Promise.resolve('');
    });

    await expect(portableShelfSave('escape', workingCopy)).rejects.toThrow(
      /resolves outside|escapes/
    );
  });
});
