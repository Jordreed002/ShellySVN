import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRemoteUrlToLocalPath } from '../src/utils/pathResolution';

/*
 * macOS path-output contract for resolveRemoteUrlToLocalPath. The sibling suite
 * adapts expected separators to the host via platformPath() and forces win32 for
 * a single Windows test; force darwin here so the POSIX forward-slash,
 * case-preserving output is locked on every host. The macOS filesystem is
 * case-sensitive, so every segment's case must round-trip exactly through
 * resolution — unlike Windows, where the SVN cache layer lowercases path keys.
 */
describe('pathResolution — macOS (darwin) output', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('keeps forward slashes for a POSIX working copy root', () => {
    const result = resolveRemoteUrlToLocalPath(
      'https://svn.example.com/repo/trunk/src/file.ts',
      '/Users/user/project',
      'https://svn.example.com/repo'
    );
    expect(result).toBe('/Users/user/project/trunk/src/file.ts');
  });

  it('does not convert forward slashes to backslashes on macOS', () => {
    const result = resolveRemoteUrlToLocalPath(
      'https://svn.example.com/repo/trunk/deep/nested/file.ts',
      '/Users/user/project',
      'https://svn.example.com/repo'
    );
    expect(result).not.toContain('\\');
  });

  it('preserves the exact case of every segment (case-sensitive filesystem)', () => {
    const result = resolveRemoteUrlToLocalPath(
      'https://svn.example.com/repo/trunk/Docs/ReadMe.md',
      '/Users/Jordan/MyProject',
      'https://svn.example.com/repo'
    );
    expect(result).toBe('/Users/Jordan/MyProject/trunk/Docs/ReadMe.md');
  });
});
