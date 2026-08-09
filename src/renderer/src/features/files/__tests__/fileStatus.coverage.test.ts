import { describe, expect, it } from 'vitest';
import type { FileInfo, FsStatusResult, SvnStatusChar } from '@shared/types';

import { applyDeepStatus, buildFolderChangeCounts, fileInfoToEntry } from '../fileStatus';

function file(path: string, isDirectory = false): FileInfo {
  return {
    name: path.split(/[/\\]/).pop() || path,
    path,
    isDirectory,
    size: 0,
    modifiedTime: '2026-05-06T00:00:00.000Z',
  };
}

function deepStatus(entries: Array<{ fullPath: string; status: SvnStatusChar }>): FsStatusResult {
  return { directStatus: {}, allEntries: entries };
}

describe('fileInfoToEntry', () => {
  it('maps a versioned file with svnStatus onto a status entry', () => {
    const entry = fileInfoToEntry({
      ...file('/repo/a.ts'),
      svnStatus: {
        path: '/repo/a.ts',
        status: 'M',
        revision: 5,
        author: 'al',
        date: 'd',
        isDirectory: false,
      },
    });

    expect(entry).toEqual({
      path: '/repo/a.ts',
      remoteUrl: undefined,
      status: 'M',
      revision: 5,
      author: 'al',
      date: 'd',
      isDirectory: false,
    });
  });

  it('defaults status to blank when svnStatus is absent', () => {
    const entry = fileInfoToEntry(file('/repo/a.ts'));

    expect(entry.status).toBe(' ');
    expect(entry.revision).toBeUndefined();
    expect(entry.author).toBeUndefined();
    expect(entry.date).toBeUndefined();
    expect(entry.remoteUrl).toBeUndefined();
  });

  it('carries the directory flag and remoteUrl through', () => {
    const entry = fileInfoToEntry({
      ...file('/repo/src', true),
      svnStatus: {
        path: '/repo/src',
        status: ' ',
        isDirectory: true,
        remoteUrl: 'https://svn/repo/src',
      },
    });

    expect(entry.isDirectory).toBe(true);
    expect(entry.remoteUrl).toBe('https://svn/repo/src');
    expect(entry.status).toBe(' ');
  });
});

describe('buildFolderChangeCounts', () => {
  it('counts pending changes nested under each immediate folder', () => {
    const counts = buildFolderChangeCounts(
      [file('/repo/src', true), file('/repo/docs', true)],
      deepStatus([
        { fullPath: '/repo/src/a.ts', status: 'M' },
        { fullPath: '/repo/src/nested/b.ts', status: 'A' },
        { fullPath: '/repo/docs/g.md', status: 'D' },
      ])
    );

    expect(counts.get('/repo/src')).toBe(2);
    expect(counts.get('/repo/docs')).toBe(1);
  });

  it('skips unversioned, ignored, and external entries', () => {
    const counts = buildFolderChangeCounts(
      [file('/repo/src', true)],
      deepStatus([
        { fullPath: '/repo/src/u.ts', status: '?' },
        { fullPath: '/repo/src/i.ts', status: 'I' },
        { fullPath: '/repo/src/e', status: 'X' },
        { fullPath: '/repo/src/m.ts', status: 'M' },
      ])
    );

    expect(counts.get('/repo/src')).toBe(1);
  });

  it('counts a deeply nested change once per ancestor folder', () => {
    const counts = buildFolderChangeCounts(
      [file('/repo', true), file('/repo/src', true)],
      deepStatus([{ fullPath: '/repo/src/deep/x.ts', status: 'M' }])
    );

    expect(counts.get('/repo')).toBe(1);
    expect(counts.get('/repo/src')).toBe(1);
  });

  it('returns empty when there are no folders or no deep entries', () => {
    expect(
      buildFolderChangeCounts(
        [file('/repo/a.ts')],
        deepStatus([{ fullPath: '/repo/a.ts', status: 'M' }])
      ).size
    ).toBe(0);
    expect(buildFolderChangeCounts([file('/repo/src', true)], deepStatus([])).size).toBe(0);
  });
});

describe('applyDeepStatus branches', () => {
  it('leaves files unchanged when there are no folders', () => {
    const result = applyDeepStatus(
      [file('/repo/a.ts'), file('/repo/b.ts')],
      deepStatus([{ fullPath: '/repo/a.ts', status: 'M' }])
    );

    expect(result.every((f) => f.svnStatus === undefined)).toBe(true);
  });

  it('keeps the worst status when a later entry is lower priority', () => {
    const result = applyDeepStatus(
      [file('/repo/src', true)],
      deepStatus([
        { fullPath: '/repo/src/c.ts', status: 'C' },
        { fullPath: '/repo/src/u.ts', status: '?' },
      ])
    );

    expect(result[0].svnStatus?.status).toBe('C');
  });

  it('leaves a folder without descendant changes at no status', () => {
    const result = applyDeepStatus(
      [file('/repo/src', true)],
      deepStatus([{ fullPath: '/repo/docs/x.ts', status: 'M' }])
    );

    expect(result[0].svnStatus).toBeUndefined();
  });
});
