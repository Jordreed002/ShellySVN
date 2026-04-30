import { describe, expect, it } from 'vitest';
import { resolveRemoteUpdateTarget } from '../src/components/files/remoteUpdateTarget';

describe('resolveRemoteUpdateTarget', () => {
  it('resolves a remote-only file URL into the working-copy target path', () => {
    const target = resolveRemoteUpdateTarget({
      entry: {
        path: 'C:\\wc\\src\\missing.ts',
        remoteUrl: 'https://svn.example.com/repo/trunk/src/missing.ts',
        status: 'O',
        isDirectory: false,
      },
      repositoryRoot: 'https://svn.example.com/repo',
      workingCopyUrl: 'https://svn.example.com/repo/trunk',
      workingCopyRoot: 'C:\\wc',
      currentPath: 'C:\\wc',
    });

    expect(target).toEqual({
      repoUrl: 'https://svn.example.com/repo/trunk/src/missing.ts',
      localPath: 'C:\\wc\\src\\missing.ts',
    });
  });

  it('resolves a remote-only folder URL for sparse subtree updates', () => {
    const target = resolveRemoteUpdateTarget({
      entry: {
        path: 'C:\\wc\\docs',
        remoteUrl: 'https://svn.example.com/repo/trunk/docs',
        status: 'O',
        isDirectory: true,
      },
      repositoryRoot: 'https://svn.example.com/repo',
      workingCopyUrl: 'https://svn.example.com/repo/trunk',
      workingCopyRoot: 'C:\\wc',
      currentPath: 'C:\\wc',
    });

    expect(target).toEqual({
      repoUrl: 'https://svn.example.com/repo/trunk/docs',
      localPath: 'C:\\wc\\docs',
    });
  });

  it('resolves remote-only children relative to the current local folder', () => {
    const target = resolveRemoteUpdateTarget({
      entry: {
        path: 'C:\\wc\\src\\new.ts',
        remoteUrl: 'https://svn.example.com/repo/trunk/src/new.ts',
        status: 'O',
        isDirectory: false,
      },
      repositoryRoot: 'https://svn.example.com/repo',
      workingCopyUrl: 'https://svn.example.com/repo/trunk/src',
      workingCopyRoot: 'C:\\wc',
      currentPath: 'C:\\wc\\src',
    });

    expect(target).toEqual({
      repoUrl: 'https://svn.example.com/repo/trunk/src/new.ts',
      localPath: 'C:\\wc\\src\\new.ts',
    });
  });
});
