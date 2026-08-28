import { describe, expect, it } from 'vitest';
import { getCommitWarnings, type CommitWarningFile } from '../commitWarnings';

function file(overrides: Partial<CommitWarningFile>): CommitWarningFile {
  return {
    path: 'src/file.ts',
    status: 'M',
    selected: true,
    ...overrides,
  };
}

describe('commitWarnings', () => {
  it('warns about conflicted selected files', () => {
    const warnings = getCommitWarnings([file({ path: 'conflict.txt', status: 'C' })]);

    expect(warnings).toContainEqual(
      expect.objectContaining({
        id: 'conflicts',
        severity: 'danger',
        paths: ['conflict.txt'],
      })
    );
  });

  it('does not warn when selected versioned files span normal mixed revisions', () => {
    const warnings = getCommitWarnings([
      file({ path: 'old.txt', revision: 10 }),
      file({ path: 'new.txt', revision: 12 }),
      file({ path: 'unversioned.txt', status: '?', revision: undefined }),
    ]);

    expect(warnings.map((warning) => warning.id)).toEqual(['unversioned']);
  });

  it('warns about switched paths, locks, and externals', () => {
    const warnings = getCommitWarnings(
      [
        file({ path: 'branches/feature/file.ts', switched: true }),
        file({ path: 'locked.txt', lock: { owner: 'alice', comment: '', date: '' } }),
        file({ path: 'vendor/lib/file.ts' }),
      ],
      [
        { path: 'vendor/lib', status: 'X' },
        { path: 'branches/feature/file.ts', status: 'M', switched: true },
      ]
    );

    expect(warnings.map((warning) => warning.id)).toEqual(['switched-paths', 'locks', 'externals']);
  });

  it('reports unversioned selections as informational warnings', () => {
    const warnings = getCommitWarnings([file({ path: 'new.txt', status: '?' })]);

    expect(warnings).toContainEqual(
      expect.objectContaining({
        id: 'unversioned',
        severity: 'info',
        message: '1 unversioned path will be added before commit.',
      })
    );
  });
});
