// @vitest-environment node
import { mkdtemp, mkdir, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approvePathForIpc,
  assertPathApprovedForIpc,
  clearApprovedPathsForTests,
  isPathApprovedForIpc,
} from '../approved-paths';

let root: string;

beforeEach(async () => {
  clearApprovedPathsForTests();
  root = await mkdtemp(join(tmpdir(), 'shellysvn-approved-paths-'));
});

afterEach(() => {
  clearApprovedPathsForTests();
});

describe('approved renderer paths', () => {
  it('allows an explicitly approved root and its descendants only', async () => {
    const approved = join(root, 'approved');
    const other = join(root, 'other');
    await Promise.all([mkdir(approved), mkdir(other)]);
    approvePathForIpc(approved);

    expect(isPathApprovedForIpc(join(approved, 'new-file.txt'))).toBe(true);
    expect(isPathApprovedForIpc(other)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink inside an approved root that escapes the root',
    async () => {
      const approved = join(root, 'approved');
      const outside = join(root, 'outside');
      await Promise.all([mkdir(approved), mkdir(outside)]);
      await symlink(outside, join(approved, 'escape'));
      approvePathForIpc(approved);

      expect(() =>
        assertPathApprovedForIpc(join(approved, 'escape', 'secret.txt'), 'File read')
      ).toThrow('selected through ShellySVN');
    }
  );
});
