// @vitest-environment node

import { execFileSync } from 'child_process';
import { realpathSync, rmSync, symlinkSync, writeFileSync, unlinkSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../settings-manager', () => ({
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

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

import { getInfo, getStatus, getWorkingCopyContext } from '../svn-working-copy';

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

describeIfSvn('svn-working-copy real SVN integration', () => {
  let tempRoot = '';
  let repoPath = '';
  let workingCopyPath = '';
  let repoUrl = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'shellysvn-wc-'));
    repoPath = join(tempRoot, 'repo');
    workingCopyPath = join(tempRoot, 'wc');
    repoUrl = pathToFileURL(repoPath).href;

    execFileSync('svnadmin', ['create', repoPath], { stdio: 'pipe' });
    execFileSync('svn', ['checkout', repoUrl, workingCopyPath], { stdio: 'pipe' });

    writeFileSync(join(workingCopyPath, 'modified.txt'), 'initial\n');
    writeFileSync(join(workingCopyPath, 'missing.txt'), 'initial\n');
    execFileSync('svn', ['add', 'modified.txt', 'missing.txt'], {
      cwd: workingCopyPath,
      stdio: 'pipe',
    });
    execFileSync('svn', ['commit', '-m', 'initial import'], {
      cwd: workingCopyPath,
      stdio: 'pipe',
    });

    writeFileSync(join(workingCopyPath, 'modified.txt'), 'changed\n');
    unlinkSync(join(workingCopyPath, 'missing.txt'));
    writeFileSync(join(workingCopyPath, 'unversioned.txt'), 'new\n');
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

  it('detects working-copy info, context, and common status states', async () => {
    const info = await getInfo(workingCopyPath);
    const context = await getWorkingCopyContext(join(workingCopyPath, 'modified.txt'));
    const status = await getStatus(workingCopyPath);
    const entriesByName = new Map(
      status.entries.map((entry) => [entry.path.split(/[/\\]/).pop(), entry])
    );

    expect(info.url).toBe(repoUrl);
    expect(info.path).toBe(workingCopyPath);
    const canonicalWorkingCopyPath = realpathSync.native(workingCopyPath);
    expect(context).toMatchObject({
      workingCopyRoot: canonicalWorkingCopyPath,
      repositoryRoot: repoUrl,
      url: `${repoUrl}/modified.txt`,
      localPath: join(canonicalWorkingCopyPath, 'modified.txt'),
      nearestVersionedPath: join(canonicalWorkingCopyPath, 'modified.txt'),
      nearestVersionedUrl: `${repoUrl}/modified.txt`,
      derived: false,
    });
    expect(entriesByName.get('modified.txt')?.status).toBe('M');
    expect(entriesByName.get('missing.txt')?.status).toBe('!');
    expect(entriesByName.get('unversioned.txt')?.status).toBe('?');
  });

  it.skipIf(process.platform === 'win32')(
    'does not map a symlink that escapes the working-copy root',
    async () => {
      const outsidePath = join(tempRoot, 'outside');
      writeFileSync(outsidePath, 'outside\n');
      const linkPath = join(workingCopyPath, 'outside-link');
      symlinkSync(outsidePath, linkPath);

      await expect(getWorkingCopyContext(linkPath)).resolves.toBeNull();
    }
  );
});
