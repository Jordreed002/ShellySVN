// @vitest-environment node

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    getSvnClientPath: () => 'svn',
    getSvnExecutionContext: () => ({
      proxySettings: undefined,
      connectionTimeout: 30,
      sslVerify: true,
      clientCertificatePath: '',
    }),
  }),
}));

vi.mock('../../hooks/HookExecutor', () => ({
  executeHooksForType: mockState.executeHooksForType,
}));

vi.mock('../../ipc/store', () => ({
  getStore: mockState.getStore,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

import { checkout } from '../svn-checkout';
import { commit } from '../svn-commit';
import { lock, unlock, getLockInfo } from '../svn-locks';
import { createPatch, applyPatch } from '../svn-patch';
import { copyRepositoryItem, mergeRepositoryRange, switchWorkingCopy } from '../svn-repository-ops';
import { add, cleanup, getStatus, revert, update } from '../svn-working-copy';

function hasSvnToolchain(): boolean {
  try {
    execFileSync('svn', ['--version', '--quiet'], { stdio: 'pipe' });
    execFileSync('svnadmin', ['--version', '--quiet'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const describeIfSvn = hasSvnToolchain() ? describe : describe.skip;

describeIfSvn('release-critical SVN workflows against a real repository', () => {
  let tempRoot = '';
  let repoPath = '';
  let repoUrl = '';
  let trunkUrl = '';
  let branchesUrl = '';
  let tagsUrl = '';
  let wcPath = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'shellysvn-release-workflows-'));
    repoPath = join(tempRoot, 'repo');
    repoUrl = pathToFileURL(repoPath).href;
    trunkUrl = `${repoUrl}/trunk`;
    branchesUrl = `${repoUrl}/branches`;
    tagsUrl = `${repoUrl}/tags`;
    wcPath = join(tempRoot, 'wc');

    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.getStore.mockResolvedValue({
      get: vi.fn().mockResolvedValue({}),
    });

    execFileSync('svnadmin', ['create', repoPath], { stdio: 'pipe' });
    execFileSync(
      'svn',
      ['mkdir', '-m', 'create standard layout', trunkUrl, branchesUrl, tagsUrl],
      { stdio: 'pipe' }
    );
  });

  afterEach(async () => {
    if (tempRoot) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
      } catch {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('verifies checkout, commit, update, revert, cleanup, locks, and patch apply', async () => {
    const initialCheckout = await checkout(trunkUrl, wcPath);
    expect(initialCheckout.success).toBe(true);

    const appFile = join(wcPath, 'app.txt');
    writeFileSync(appFile, 'line one\n');
    await expect(add([appFile])).resolves.toEqual({ success: true });

    const firstCommit = await commit([appFile], 'add app file');
    expect(firstCommit).toMatchObject({ success: true });
    expect(firstCommit.revision).toBeGreaterThan(1);

    const peerPath = join(tempRoot, 'peer');
    await expect(checkout(trunkUrl, peerPath)).resolves.toMatchObject({ success: true });

    writeFileSync(appFile, 'line one\nline two\n');
    await expect(commit([appFile], 'update app file')).resolves.toMatchObject({ success: true });

    const updateResult = await update(peerPath);
    expect(updateResult.success).toBe(true);
    expect(readFileSync(join(peerPath, 'app.txt'), 'utf-8')).toContain('line two');

    writeFileSync(join(peerPath, 'app.txt'), 'local edit\n');
    await expect(revert([join(peerPath, 'app.txt')])).resolves.toEqual({ success: true });
    await expect(cleanup(peerPath)).resolves.toEqual({ success: true });
    expect(readFileSync(join(peerPath, 'app.txt'), 'utf-8')).toContain('line two');

    await expect(lock(join(peerPath, 'app.txt'), 'release verifier lock')).resolves.toMatchObject({
      success: true,
    });
    const lockInfo = await getLockInfo(join(peerPath, 'app.txt'));
    expect(lockInfo?.comment).toBe('release verifier lock');
    await expect(unlock(join(peerPath, 'app.txt'))).resolves.toMatchObject({ success: true });

    writeFileSync(join(peerPath, 'app.txt'), 'line one\nline two\npatched line\n');
    const patchPath = join(tempRoot, 'app.patch');
    const patch = await createPatch([join(peerPath, 'app.txt')], patchPath);
    expect(patch.success).toBe(true);
    expect(existsSync(patchPath)).toBe(true);

    await expect(revert([join(peerPath, 'app.txt')])).resolves.toEqual({ success: true });
    const dryRun = await applyPatch(patchPath, peerPath, true);
    expect(dryRun.success).toBe(true);
    const apply = await applyPatch(patchPath, peerPath);
    expect(apply.success).toBe(true);
    expect(readFileSync(join(peerPath, 'app.txt'), 'utf-8')).toContain('patched line');
  });

  it('verifies branch/tag creation, switch, and merge against real repository history', async () => {
    await expect(checkout(trunkUrl, wcPath)).resolves.toMatchObject({ success: true });

    const appFile = join(wcPath, 'app.txt');
    writeFileSync(appFile, 'trunk line\n');
    await add([appFile]);
    await expect(commit([appFile], 'add trunk app')).resolves.toMatchObject({ success: true });

    const branchUrl = `${branchesUrl}/feature`;
    await expect(copyRepositoryItem(trunkUrl, branchUrl, 'create feature branch')).resolves.toMatchObject({
      success: true,
    });

    await expect(switchWorkingCopy(wcPath, branchUrl)).resolves.toMatchObject({ success: true });
    writeFileSync(appFile, 'trunk line\nfeature line\n');
    await expect(commit([appFile], 'add feature line')).resolves.toMatchObject({ success: true });

    await expect(switchWorkingCopy(wcPath, trunkUrl)).resolves.toMatchObject({ success: true });
    const merge = await mergeRepositoryRange(branchUrl, wcPath);
    expect(merge.success).toBe(true);
    expect(readFileSync(appFile, 'utf-8')).toContain('feature line');

    const status = await getStatus(wcPath);
    expect(status.entries.some((entry) => entry.path.endsWith('app.txt') && entry.status === 'M')).toBe(true);

    await expect(commit([wcPath], 'merge feature branch')).resolves.toMatchObject({ success: true });
    const tagUrl = `${tagsUrl}/release-1`;
    await expect(copyRepositoryItem(trunkUrl, tagUrl, 'create release tag')).resolves.toMatchObject({
      success: true,
    });
  });
});
