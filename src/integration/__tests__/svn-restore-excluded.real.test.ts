// @vitest-environment node
/**
 * End-to-end check of the "Add to working copy…" path for a folder that was
 * excluded with `svn update --set-depth exclude`: the offline listing must
 * surface it, the Explorer's row-to-target resolution must find its local path,
 * and the update must actually put the folder back on disk.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/settings-manager', () => ({
  getSettingsManager: () => ({
    ready: vi.fn().mockResolvedValue(undefined),
    getSvnClientPath: () => 'svn',
    getSvnExecutionContext: () => ({
      proxySettings: undefined,
      connectionTimeout: 30,
      sslVerify: true,
      clientCertificatePath: '',
    }),
  }),
}));

vi.mock('@main/ipc/store', () => ({ getStore: async () => ({ get: async () => undefined }) }));

// The OS trash is not reachable outside Electron; from Subversion's point of
// view a trashed path is simply gone, which is what matters to these tests.
vi.mock('electron', () => ({
  shell: {
    trashItem: async (target: string) => {
      const { rmSync } = await import('fs');
      rmSync(target, { recursive: true, force: true });
    },
  },
}));

vi.mock('@main/auth-cache', () => ({
  getAuthCache: () => ({ ready: async () => undefined, findForUrl: () => null }),
}));

vi.mock('@main/ssl-trust-cache', () => ({
  getSslTrustCache: () => ({ ready: async () => undefined, findForUrl: () => null }),
}));

import { appendExcludedChildren } from '@renderer/features/files/excludedChildren';
import { fileInfoToEntry } from '@renderer/features/files/fileStatus';
import { resolveRemoteUpdateTarget } from '@renderer/components/files/remoteUpdateTarget';
import {
  excludeFromWorkingCopy,
  getChildCommits,
  getInfo,
  getStatus,
  updateToRevision,
} from '@main/services/svn-working-copy';

function hasSvnToolchain(): boolean {
  try {
    execFileSync('svn', ['--version', '--quiet'], { stdio: 'pipe' });
    execFileSync('svnadmin', ['--version', '--quiet'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasSvnToolchain())('restoring an excluded folder through the Explorer chain', () => {
  it('lists it offline, resolves its local path, and fetches it back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shelly-restore-'));
    const svn = (args: string[], cwd: string) =>
      execFileSync('svn', args, { cwd, encoding: 'utf8' });

    execFileSync('svnadmin', ['create', join(root, 'repo')]);
    const wc = join(root, 'wc');
    svn(['-q', 'checkout', pathToFileURL(join(root, 'repo')).href, wc], root);
    mkdirSync(join(wc, 'sub'), { recursive: true });
    mkdirSync(join(wc, 'keep'), { recursive: true });
    writeFileSync(join(wc, 'sub', 'f.txt'), 'hi\n');
    writeFileSync(join(wc, 'keep', 'g.txt'), 'k\n');
    svn(['-q', 'add', 'sub', 'keep'], wc);
    svn(['-q', 'commit', '-m', 'init'], wc);

    // What "Exclude and remove locally" leaves behind.
    svn(['update', '--set-depth', 'exclude', 'sub'], wc);
    expect(existsSync(join(wc, 'sub'))).toBe(false);

    const info = await getInfo(wc);

    // The offline listing the Explorer already reads must still know about it.
    const childCommits = await getChildCommits(wc);
    expect(childCommits.sub).toMatchObject({ excluded: true });

    // The row the Explorer synthesises from that listing.
    const onDisk = [
      { name: 'keep', path: join(wc, 'keep'), isDirectory: true, size: 0, modifiedTime: '' },
    ];
    const listing = appendExcludedChildren(onDisk, childCommits, wc);
    const row = listing.find((entry) => entry.name === 'sub');
    expect(row, 'excluded folder must appear in the listing').toBeTruthy();

    const entry = fileInfoToEntry(row!);
    expect(entry.status).toBe('O');

    const target = resolveRemoteUpdateTarget({
      entry,
      repositoryRoot: info.repositoryRoot!,
      workingCopyUrl: info.url,
      workingCopyRoot: info.workingCopyRoot!,
      currentPath: wc,
    });
    expect(target.localPath).toBe(join(wc, 'sub'));

    // Exactly what the dialog's default confirm runs.
    const result = await updateToRevision(
      info.workingCopyRoot!,
      target.repoUrl,
      target.localPath!,
      'infinity',
      false
    );
    expect(result).toMatchObject({ success: true });
    expect(existsSync(join(wc, 'sub', 'f.txt'))).toBe(true);

    // And the row is gone from the next listing rather than lingering as a ghost.
    const afterCommits = await getChildCommits(wc);
    expect(afterCommits.sub?.excluded).toBeUndefined();
  }, 60_000);

  it('removes a folder holding unversioned files without wedging the working copy', async () => {
    /*
     * Excluding first and trashing the leftovers afterwards exits 0 while
     * leaving the working copy locked, the entry at depth `empty`, and the
     * folder reported missing (`!`) — one permanent "change" the user can
     * neither commit nor clear, and the folder is not excluded at all.
     */
    const root = mkdtempSync(join(tmpdir(), 'shelly-remove-dirty-'));
    const svn = (args: string[], cwd: string) =>
      execFileSync('svn', args, { cwd, encoding: 'utf8' });

    execFileSync('svnadmin', ['create', join(root, 'repo')]);
    const wc = join(root, 'wc');
    svn(['-q', 'checkout', pathToFileURL(join(root, 'repo')).href, wc], root);
    mkdirSync(join(wc, 'sub', 'nested'), { recursive: true });
    writeFileSync(join(wc, 'sub', 'versioned.txt'), 'v\n');
    svn(['-q', 'add', 'sub'], wc);
    svn(['-q', 'commit', '-m', 'init'], wc);
    // The realistic case: build output and an editor file nobody committed.
    writeFileSync(join(wc, 'sub', 'untracked.log'), 'junk\n');
    writeFileSync(join(wc, 'sub', 'nested', 'more.tmp'), 'junk\n');

    await expect(excludeFromWorkingCopy(join(wc, 'sub'))).resolves.toEqual({ success: true });

    expect(existsSync(join(wc, 'sub'))).toBe(false);
    // No lock left behind, so the next operation is not refused.
    svn(['update'], wc);
    // Nothing to report and nothing pending: the whole point of excluding.
    expect(await getStatus(wc)).toMatchObject({ entries: [] });
    // Genuinely excluded — not silently downgraded to depth `empty`.
    expect(svn(['info', '--show-item', 'depth', 'sub'], wc).trim()).toBe('exclude');

    // And it is still offered back, with the versioned content intact.
    const childCommits = await getChildCommits(wc);
    expect(childCommits.sub).toMatchObject({ excluded: true, kind: 'dir' });
    const info = await getInfo(wc);
    await expect(
      updateToRevision(info.workingCopyRoot!, `${info.url}/sub`, join(wc, 'sub'), 'infinity', false)
    ).resolves.toMatchObject({ success: true });
    expect(existsSync(join(wc, 'sub', 'versioned.txt'))).toBe(true);
  }, 60_000);

  it('removes a folder and a file together, keeps svn quiet, and brings both back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shelly-remove-set-'));
    const svn = (args: string[], cwd: string) =>
      execFileSync('svn', args, { cwd, encoding: 'utf8' });

    execFileSync('svnadmin', ['create', join(root, 'repo')]);
    const wc = join(root, 'wc');
    svn(['-q', 'checkout', pathToFileURL(join(root, 'repo')).href, wc], root);
    mkdirSync(join(wc, 'sub'), { recursive: true });
    writeFileSync(join(wc, 'sub', 'f.txt'), 'hi\n');
    writeFileSync(join(wc, 'notes.txt'), 'notes\n');
    svn(['-q', 'add', 'sub', 'notes.txt'], wc);
    svn(['-q', 'commit', '-m', 'init'], wc);

    // One "Remove from working copy…" over a two-item selection.
    await expect(excludeFromWorkingCopy([join(wc, 'sub'), join(wc, 'notes.txt')])).resolves.toEqual(
      { success: true }
    );
    expect(existsSync(join(wc, 'sub'))).toBe(false);
    expect(existsSync(join(wc, 'notes.txt'))).toBe(false);

    // The point of excluding rather than deleting: nothing to report, nothing
    // pending to commit, and a later update does not drag them back.
    expect(await getStatus(wc)).toMatchObject({ entries: [] });
    svn(['update'], wc);
    expect(existsSync(join(wc, 'notes.txt'))).toBe(false);

    // Both are still offered, and the file is offered as a file.
    const childCommits = await getChildCommits(wc);
    const listing = appendExcludedChildren([], childCommits, wc);
    expect(listing.find((item) => item.name === 'sub')).toMatchObject({ isDirectory: true });
    expect(listing.find((item) => item.name === 'notes.txt')).toMatchObject({
      isDirectory: false,
    });

    const info = await getInfo(wc);
    for (const name of ['sub', 'notes.txt']) {
      const row = listing.find((item) => item.name === name)!;
      const target = resolveRemoteUpdateTarget({
        entry: fileInfoToEntry(row),
        repositoryRoot: info.repositoryRoot!,
        workingCopyUrl: info.url,
        workingCopyRoot: info.workingCopyRoot!,
        currentPath: wc,
      });
      await expect(
        updateToRevision(
          info.workingCopyRoot!,
          target.repoUrl,
          target.localPath!,
          'infinity',
          false
        )
      ).resolves.toMatchObject({ success: true });
    }

    expect(existsSync(join(wc, 'sub', 'f.txt'))).toBe(true);
    expect(existsSync(join(wc, 'notes.txt'))).toBe(true);
  }, 60_000);
});
