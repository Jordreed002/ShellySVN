import { describe, expect, it } from 'vitest';
import type { FileInfo, SvnChildCommitInfo } from '@shared/types';
import { appendExcludedChildren, isInsideWorkingCopy } from '../excludedChildren';

function file(name: string, path: string): FileInfo {
  return { name, path, isDirectory: true, size: 0, modifiedTime: '' };
}

const CHILD_COMMITS: Record<string, SvnChildCommitInfo> = {
  keep: { revision: 3, author: 'ana', date: '2026-02-01T00:00:00Z' },
  sub: {
    revision: 7,
    author: 'ben',
    date: '2026-03-01T00:00:00Z',
    excluded: true,
    kind: 'dir',
    url: 'https://svn.example.com/repo/trunk/sub',
  },
};

describe('appendExcludedChildren', () => {
  it('adds an excluded folder as a not-fetched row carrying its repository URL', () => {
    const result = appendExcludedChildren([file('keep', '/wc/keep')], CHILD_COMMITS, '/wc');

    expect(result.map((entry) => entry.name)).toEqual(['keep', 'sub']);
    expect(result[1]).toMatchObject({
      name: 'sub',
      path: '/wc/sub',
      isDirectory: true,
      svnStatus: {
        path: '/wc/sub',
        status: 'O',
        remoteUrl: 'https://svn.example.com/repo/trunk/sub',
        revision: 7,
        isDirectory: true,
      },
    });
  });

  it('leaves the listing alone when the folder is back on disk', () => {
    const files = [file('keep', '/wc/keep'), file('sub', '/wc/sub')];
    expect(appendExcludedChildren(files, CHILD_COMMITS, '/wc')).toBe(files);
  });

  it('adds nothing when no child is excluded, and tolerates missing data', () => {
    const files = [file('keep', '/wc/keep')];
    expect(appendExcludedChildren(files, { keep: CHILD_COMMITS.keep }, '/wc')).toBe(files);
    expect(appendExcludedChildren(files, undefined, '/wc')).toBe(files);
  });

  it('keeps an excluded file a file, so it offers file actions and opens nothing', () => {
    const result = appendExcludedChildren(
      [],
      {
        notes: {
          revision: 9,
          author: 'cleo',
          date: '2026-04-01T00:00:00Z',
          excluded: true,
          kind: 'file',
          url: 'https://svn.example.com/repo/trunk/notes.txt',
        },
      },
      '/wc'
    );

    expect(result[0]).toMatchObject({
      name: 'notes',
      isDirectory: false,
      svnStatus: { status: 'O', isDirectory: false },
    });
  });

  it('builds Windows paths with a backslash', () => {
    const result = appendExcludedChildren([], CHILD_COMMITS, 'C:\\wc');
    expect(result[0].path).toBe('C:\\wc\\sub');
  });
});

describe('isInsideWorkingCopy', () => {
  it('accepts the root and its descendants on both path styles', () => {
    expect(isInsideWorkingCopy('/wc', '/wc')).toBe(true);
    expect(isInsideWorkingCopy('/wc/sub/deep', '/wc/')).toBe(true);
    expect(isInsideWorkingCopy('C:\\wc\\sub', 'C:\\wc')).toBe(true);
  });

  it('rejects siblings that merely share a prefix, and missing input', () => {
    expect(isInsideWorkingCopy('/wc-other/sub', '/wc')).toBe(false);
    expect(isInsideWorkingCopy('/elsewhere', '/wc')).toBe(false);
    expect(isInsideWorkingCopy('/wc/sub', undefined)).toBe(false);
    expect(isInsideWorkingCopy('', '/wc')).toBe(false);
  });
});
