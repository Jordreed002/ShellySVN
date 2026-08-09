import { describe, expect, it } from 'vitest';

import type { SvnBlameLine } from '@shared/types';

import { toBlameLine } from '../useRepoBlame';

/**
 * J7 — History & blame.
 *
 * `svn blame` reports uncommitted local lines as revision 0 with author
 * "unknown". The blame view must render those distinctly (no revision, no
 * author) rather than crediting them to a fictional "unknown" committer.
 * `toBlameLine` is the single mapping that enforces that distinction.
 */
function blame(overrides: Partial<SvnBlameLine>): SvnBlameLine {
  return {
    revision: 0,
    author: 'unknown',
    date: '',
    lineNumber: 1,
    content: 'line',
    ...overrides,
  };
}

describe('toBlameLine', () => {
  it('maps a committed line through with its revision, author, and date', () => {
    const line = toBlameLine(
      blame({
        revision: 42,
        author: 'alice',
        date: '2024-01-01',
        lineNumber: 7,
        content: 'const x = 1;',
      })
    );
    expect(line).toEqual({
      revision: 42,
      author: 'alice',
      date: '2024-01-01',
      lineNumber: 7,
      content: 'const x = 1;',
    });
  });

  it('collapses an uncommitted line (r0, author "unknown") to a null revision with no author', () => {
    const line = toBlameLine(blame({ revision: 0, author: 'unknown', lineNumber: 3 }));
    expect(line.revision).toBeNull();
    expect(line.author).toBe('');
    expect(line.date).toBe('');
    expect(line.lineNumber).toBe(3);
  });

  it('treats a missing or non-positive revision as uncommitted', () => {
    expect(toBlameLine(blame({ revision: 0 })).revision).toBeNull();
    expect(toBlameLine(blame({ revision: -5 as unknown as number })).revision).toBeNull();
  });

  it('always preserves the line number and content', () => {
    const committed = toBlameLine(blame({ revision: 9, lineNumber: 100, content: 'hi' }));
    const uncommitted = toBlameLine(blame({ revision: 0, lineNumber: 101, content: 'bye' }));
    expect(committed.lineNumber).toBe(100);
    expect(committed.content).toBe('hi');
    expect(uncommitted.lineNumber).toBe(101);
    expect(uncommitted.content).toBe('bye');
  });
});
