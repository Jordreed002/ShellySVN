import { describe, expect, it } from 'vitest';
import { resolveBranchContext } from '../branchDetection';

const ROOT = 'https://svn.example.com/repo/Clients/PanMacmillan';

describe('resolveBranchContext', () => {
  it('detects trunk and its sub-path', () => {
    expect(resolveBranchContext(`${ROOT}/trunk/src/app.ts`)).toEqual({
      branchRootUrl: ROOT,
      branch: 'trunk',
      branchKind: 'trunk',
      subPath: 'src/app.ts',
    });
  });

  it('detects a branch at the branch root (no sub-path)', () => {
    expect(resolveBranchContext(`${ROOT}/branches/feature-x`)).toEqual({
      branchRootUrl: ROOT,
      branch: 'feature-x',
      branchKind: 'branch',
      subPath: '',
    });
  });

  it('detects a tag', () => {
    expect(resolveBranchContext(`${ROOT}/tags/v1.2/readme.md`)).toEqual({
      branchRootUrl: ROOT,
      branch: 'v1.2',
      branchKind: 'tag',
      subPath: 'readme.md',
    });
  });

  it('picks the deepest branch-root for nested layouts', () => {
    const url = 'https://svn.example.com/repo/trunk/Clients/PanMacmillan/trunk/src';
    expect(resolveBranchContext(url)?.branchRootUrl).toBe(
      'https://svn.example.com/repo/trunk/Clients/PanMacmillan'
    );
  });

  it('returns null when there is no standard layout', () => {
    expect(resolveBranchContext('https://svn.example.com/repo/Clients/PanMacmillan')).toBeNull();
    expect(resolveBranchContext(undefined)).toBeNull();
  });
});
