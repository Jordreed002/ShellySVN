// @vitest-environment node

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { createServer, connect } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
  findForUrl: vi.fn<() => { realm: string; username: string; password: string } | null>(() => null),
  getSvnExecutionContext: vi.fn(),
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: vi.fn().mockResolvedValue(undefined),
    getSvnClientPath: () => 'svn',
    getSvnExecutionContext: mockState.getSvnExecutionContext,
  }),
}));

vi.mock('../../hooks/HookExecutor', () => ({
  executeHooksForType: mockState.executeHooksForType,
}));

vi.mock('../../ipc/store', () => ({
  getStore: mockState.getStore,
}));

vi.mock('../../auth-cache', () => ({
  getAuthCache: () => ({
    ready: vi.fn().mockResolvedValue(undefined),
    findForUrl: mockState.findForUrl,
  }),
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
import { catRepositoryFile } from '../svn-content';
import { getMergeInfo, getUrlDiff } from '../svn-history';
import { getBlame } from '../svn-history';
import { runSvnText } from '../svn-executor';
import { lock, unlock, getLockInfo, listLocks } from '../svn-locks';
import {
  changelistAdd,
  changelistDelete,
  changelistList,
  changelistRemove,
  externalsAdd,
  externalsEdit,
  externalsList,
  externalsRemove,
  externalsUpdate,
  listRepository,
  propdel,
  propdelRemote,
  propget,
  proplist,
  propset,
  propsetRemote,
  revpropdel,
  revpropget,
  revpropset,
} from '../svn-metadata';
import { createPatch, applyPatch } from '../svn-patch';
import {
  portableShelfApply,
  portableShelfDelete,
  portableShelfList,
  portableShelfSave,
} from '../svn-portable-shelves';
import {
  copyRepositoryItem,
  createRemoteFolder,
  deleteRemoteItem,
  exportRepository,
  importRepository,
  mergeRepositoryRange,
  moveRemoteItem,
  relocateWorkingCopy,
  resolveConflict,
  switchWorkingCopy,
} from '../svn-repository-ops';
import {
  add,
  cleanup,
  copy,
  getStatus,
  previewCleanup,
  revert,
  update,
  updateToRevision,
  upgradeWorkingCopy,
} from '../svn-working-copy';

function hasSvnToolchain(): boolean {
  try {
    execFileSync('svn', ['--version', '--quiet'], { stdio: 'pipe' });
    execFileSync('svnadmin', ['--version', '--quiet'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasSvnServe(): boolean {
  try {
    execFileSync('svnserve', ['--version', '--quiet'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a TCP port for svnserve'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForTcpPort(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`svnserve did not start on port ${port}`);
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
  let svnserveProcess: ChildProcess | null = null;
  let originalSvnSsh: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'shellysvn-release-workflows-'));
    repoPath = join(tempRoot, 'repo');
    repoUrl = pathToFileURL(repoPath).href;
    trunkUrl = `${repoUrl}/trunk`;
    branchesUrl = `${repoUrl}/branches`;
    tagsUrl = `${repoUrl}/tags`;
    wcPath = join(tempRoot, 'wc');

    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.findForUrl.mockReturnValue(null);
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: undefined,
      connectionTimeout: 30,
      sslVerify: true,
      clientCertificatePath: '',
    });
    mockState.getStore.mockResolvedValue({
      get: vi.fn().mockResolvedValue({}),
    });

    execFileSync('svnadmin', ['create', repoPath], { stdio: 'pipe' });
    const revpropHook =
      process.platform === 'win32'
        ? join(repoPath, 'hooks', 'pre-revprop-change.bat')
        : join(repoPath, 'hooks', 'pre-revprop-change');
    writeFileSync(
      revpropHook,
      process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
      { mode: 0o700 }
    );
    execFileSync('svn', ['mkdir', '-m', 'create standard layout', trunkUrl, branchesUrl, tagsUrl], {
      stdio: 'pipe',
    });
    originalSvnSsh = process.env.SVN_SSH;
  });

  afterEach(async () => {
    svnserveProcess?.kill();
    svnserveProcess = null;
    if (originalSvnSsh === undefined) delete process.env.SVN_SSH;
    else process.env.SVN_SSH = originalSvnSsh;
    delete process.env.SHELLYSVN_PORTABLE_SHELF_ROOT;
    if (tempRoot) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
      } catch {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  // TortoiseSVN's Windows client does not honor --password-from-stdin for the
  // ra_svn protocol. Keep credentials off the process list and exercise this
  // transport on the Linux/macOS jobs where the secure path is supported.
  it.skipIf(process.platform === 'win32' || !hasSvnServe())(
    'reads and mutates over svn:// and reports authentication failures structurally',
    async () => {
      const confPath = join(repoPath, 'conf', 'svnserve.conf');
      writeFileSync(join(repoPath, 'conf', 'passwd'), ['[users]', 'reader = secret', ''].join('\n'));
      writeFileSync(
        confPath,
        [
          '[general]',
          'anon-access = none',
          'auth-access = write',
          'password-db = passwd',
          'realm = ShellySVN test',
          '',
        ].join('\n')
      );

      const port = await reserveTcpPort();
      svnserveProcess = spawn(
        'svnserve',
        [
          '--daemon',
          '--foreground',
          '--root',
          tempRoot,
          '--listen-host',
          '127.0.0.1',
          '--listen-port',
          String(port),
        ],
        { stdio: 'ignore', windowsHide: true }
      );
      await waitForTcpPort(port);

      const svnTrunkUrl = `svn://127.0.0.1:${port}/repo/trunk`;
      const unauthenticated = await listRepository(svnTrunkUrl);
      expect(unauthenticated).toMatchObject({
        entries: [],
        commandError: {
          category: 'authentication',
          authenticationRequired: true,
        },
      });
      const credentials = { username: 'reader', password: 'secret' };
      const authenticatedList = await listRepository(
        svnTrunkUrl,
        undefined,
        undefined,
        credentials
      );
      expect(authenticatedList.error).toBeUndefined();
      expect(authenticatedList.entries).toEqual(expect.any(Array));

      const svnWcPath = join(tempRoot, 'svn-wc');
      await expect(
        checkout(svnTrunkUrl, svnWcPath, undefined, undefined, { credentials })
      ).resolves.toMatchObject({ success: true });
      mockState.findForUrl.mockReturnValue({
        realm: svnTrunkUrl,
        ...credentials,
      });
      const networkFile = join(svnWcPath, 'network.txt');
      writeFileSync(networkFile, 'created through svnserve\n');
      await expect(add([networkFile])).resolves.toMatchObject({ success: true });
      await expect(commit([networkFile], 'svn protocol mutation')).resolves.toMatchObject({
        success: true,
      });
    },
    20_000
  );

  it.skipIf(process.platform === 'win32' || !hasSvnServe())(
    'reads and mutates through the svn+ssh tunnel transport',
    async () => {
      const tunnelScript = join(tempRoot, 'svn-ssh-tunnel');
      const quotedRoot = tempRoot.replaceAll("'", "'\\''");
      writeFileSync(
        tunnelScript,
        `#!/bin/sh\nexec svnserve --tunnel-user shellysvn-test -t -r '${quotedRoot}'\n`,
        { mode: 0o700 }
      );
      process.env.SVN_SSH = tunnelScript;

      const tunnelUrl = 'svn+ssh://local-tunnel/repo/trunk';
      const tunnelList = await listRepository(tunnelUrl);
      expect(tunnelList.error).toBeUndefined();

      const tunnelWc = join(tempRoot, 'ssh-wc');
      await expect(checkout(tunnelUrl, tunnelWc)).resolves.toMatchObject({ success: true });
      const tunnelFile = join(tunnelWc, 'tunnel.txt');
      writeFileSync(tunnelFile, 'created through svn+ssh\n');
      await expect(add([tunnelFile])).resolves.toMatchObject({ success: true });
      await expect(commit([tunnelFile], 'svn+ssh protocol mutation')).resolves.toMatchObject({
        success: true,
      });
    },
    20_000
  );

  it('verifies CI-provisioned authenticated HTTP and self-signed HTTPS repositories', async () => {
    const endpoints = [
      process.env.SHELLYSVN_HTTP_TEST_URL,
      process.env.SHELLYSVN_HTTPS_TEST_URL,
    ].filter((endpoint): endpoint is string => Boolean(endpoint));
    if (endpoints.length === 0) return;

    const credentials = {
      username: process.env.SHELLYSVN_PROTOCOL_USERNAME || 'shellysvn',
      password: process.env.SHELLYSVN_PROTOCOL_PASSWORD || 'release-test',
    };

    for (const [index, endpoint] of endpoints.entries()) {
      const isHttps = endpoint.startsWith('https://');
      mockState.getSvnExecutionContext.mockReturnValue({
        proxySettings: undefined,
        connectionTimeout: 30,
        sslVerify: !isHttps,
        clientCertificatePath: '',
      });
      mockState.findForUrl.mockReturnValue(null);

      const rejectedCredentials = await listRepository(endpoint, undefined, 'immediates', {
        username: 'invalid-user',
        password: 'invalid-password',
      });
      expect(rejectedCredentials.commandError?.category).toBe('authentication');

      const repositoryList = await listRepository(endpoint, undefined, 'immediates', credentials);
      expect(repositoryList.error).toBeUndefined();

      const protocolWc = join(tempRoot, `dav-wc-${index}`);
      await expect(
        checkout(endpoint, protocolWc, undefined, 'infinity', {
          credentials,
          trustSsl: isHttps,
          sslFailures: isHttps ? ['unknown-ca', 'cn-mismatch'] : undefined,
        })
      ).resolves.toMatchObject({ success: true });

      mockState.findForUrl.mockReturnValue({ realm: endpoint, ...credentials });
      const protocolFile = join(protocolWc, `dav-${Date.now()}-${index}.txt`);
      writeFileSync(protocolFile, `created through ${isHttps ? 'https' : 'http'}\n`);
      await expect(add([protocolFile])).resolves.toMatchObject({ success: true });
      await expect(commit([protocolFile], `DAV protocol mutation ${index}`)).resolves.toMatchObject(
        { success: true }
      );
    }
  }, 30_000);

  it('runs destructive app-service workflows against the Docker SVN compatibility lab', async () => {
    const sandboxUrl = process.env.SHELLYSVN_DOCKER_SVN_TEST_URL;
    if (!sandboxUrl) return;

    const credentials = {
      username: process.env.SHELLYSVN_PROTOCOL_USERNAME || 'shellysvn',
      password: process.env.SHELLYSVN_PROTOCOL_PASSWORD || 'release-test',
    };
    const testName = `run-${Date.now()}-${process.pid}`;
    const testRootUrl = `${sandboxUrl.replace(/\/+$/, '')}/${testName}`;
    const testTrunkUrl = `${testRootUrl}/trunk`;
    const testBranchesUrl = `${testRootUrl}/branches`;
    const testTagsUrl = `${testRootUrl}/tags`;
    const dockerWc = join(tempRoot, 'docker-wc');

    mockState.findForUrl.mockReturnValue({
      realm: sandboxUrl,
      ...credentials,
    });

    try {
      await expect(
        createRemoteFolder(sandboxUrl, testName, 'create isolated compatibility run', credentials)
      ).resolves.toMatchObject({ success: true });
      for (const folder of ['trunk', 'branches', 'tags']) {
        await expect(
          createRemoteFolder(testRootUrl, folder, `create ${folder}`, credentials)
        ).resolves.toMatchObject({ success: true });
      }

      await expect(
        checkout(testTrunkUrl, dockerWc, undefined, 'infinity', { credentials })
      ).resolves.toMatchObject({ success: true });
      const trackedFile = join(dockerWc, 'compatibility.txt');
      writeFileSync(trackedFile, 'initial compatibility content\n');
      await expect(add([trackedFile])).resolves.toMatchObject({ success: true });
      await expect(commit([trackedFile], 'add compatibility fixture')).resolves.toMatchObject({
        success: true,
      });

      expect(
        (await listRepository(testTrunkUrl, 'HEAD', 'immediates', credentials)).error
      ).toBeUndefined();
      expect((await getStatus(dockerWc)).entries).toEqual([]);
      const remoteContent = await catRepositoryFile(`${testTrunkUrl}/compatibility.txt`, 'HEAD');
      expect(Buffer.from(remoteContent.contentBase64, 'base64').toString('utf8')).toContain(
        'initial compatibility content'
      );
      expect((await getBlame(trackedFile)).error).toBeUndefined();

      writeFileSync(trackedFile, 'local content to revert\n');
      await expect(revert([trackedFile])).resolves.toEqual({ success: true });
      expect(readFileSync(trackedFile, 'utf8')).toBe('initial compatibility content\n');
      await expect(update(dockerWc)).resolves.toMatchObject({ success: true });
      await expect(cleanup(dockerWc)).resolves.toEqual({ success: true });

      await expect(lock(trackedFile, 'compatibility lock')).resolves.toMatchObject({
        success: true,
      });
      await expect(getLockInfo(trackedFile)).resolves.toMatchObject({
        lock: {
          owner: credentials.username,
        },
      });
      await expect(unlock(trackedFile)).resolves.toMatchObject({ success: true });

      await expect(propset(trackedFile, 'custom:compatibility', 'verified')).resolves.toEqual({
        success: true,
      });
      await expect(propget(trackedFile, 'custom:compatibility')).resolves.toMatchObject({
        value: expect.stringContaining('verified'),
      });
      await expect(changelistAdd([trackedFile], 'compatibility')).resolves.toEqual({
        success: true,
      });
      expect((await changelistList(dockerWc)).changelists).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'compatibility' })])
      );
      await expect(changelistRemove([trackedFile])).resolves.toEqual({ success: true });
      await expect(commit([trackedFile], 'commit compatibility property')).resolves.toMatchObject({
        success: true,
      });

      await expect(
        copyRepositoryItem(testTrunkUrl, `${testBranchesUrl}/feature`, 'create feature')
      ).resolves.toMatchObject({ success: true });
      await expect(
        copyRepositoryItem(testTrunkUrl, `${testTagsUrl}/verified`, 'create tag')
      ).resolves.toMatchObject({ success: true });
      await expect(
        switchWorkingCopy(dockerWc, `${testBranchesUrl}/feature`)
      ).resolves.toMatchObject({
        success: true,
      });
      await expect(switchWorkingCopy(dockerWc, testTrunkUrl)).resolves.toMatchObject({
        success: true,
      });

      const patchPath = join(tempRoot, 'docker-compat.patch');
      writeFileSync(trackedFile, 'patched compatibility content\n');
      await expect(createPatch([trackedFile], patchPath)).resolves.toMatchObject({
        success: true,
      });
      await revert([trackedFile]);
      await expect(applyPatch(patchPath, dockerWc, true)).resolves.toMatchObject({
        success: true,
      });
      await expect(applyPatch(patchPath, dockerWc)).resolves.toMatchObject({
        success: true,
      });

      await expect(
        createRemoteFolder(testTrunkUrl, 'remote-folder', 'create remote folder', credentials)
      ).resolves.toMatchObject({ success: true });
      await expect(
        moveRemoteItem(
          `${testTrunkUrl}/remote-folder`,
          `${testTrunkUrl}/renamed-folder`,
          'move remote folder',
          credentials
        )
      ).resolves.toMatchObject({ success: true });
      await expect(
        deleteRemoteItem(`${testTrunkUrl}/renamed-folder`, 'delete remote folder', credentials)
      ).resolves.toMatchObject({ success: true });

      const sparseWc = join(tempRoot, 'docker-sparse-wc');
      await expect(
        checkout(testTrunkUrl, sparseWc, undefined, undefined, {
          credentials,
          sparsePaths: [`${testTrunkUrl}/compatibility.txt`],
        })
      ).resolves.toMatchObject({ success: true });
      expect(readFileSync(join(sparseWc, 'compatibility.txt'), 'utf8')).toContain('initial');
    } finally {
      await deleteRemoteItem(testRootUrl, 'remove isolated compatibility run', credentials).catch(
        () => undefined
      );
    }
  }, 30_000);

  it('verifies checkout, commit, update, revert, cleanup, locks, and patch apply', async () => {
    const initialCheckout = await checkout(trunkUrl, wcPath);
    expect(initialCheckout.success).toBe(true);

    const appFile = join(wcPath, 'app.txt');
    writeFileSync(appFile, 'line one\n');
    await expect(add([appFile])).resolves.toEqual({ success: true });

    const firstCommit = await commit([appFile], 'add app file');
    expect(firstCommit).toMatchObject({ success: true });
    expect(firstCommit.revision).toBeGreaterThan(1);

    // The Windows CI client leaves its working-copy database locked after the
    // preceding commit. Other Windows workflows remain covered below.
    if (process.platform !== 'win32') {
      const copiedFile = join(wcPath, 'app-copy.txt');
      await expect(copy(appFile, copiedFile)).resolves.toMatchObject({ success: true });
      expect(readFileSync(copiedFile, 'utf8')).toBe('line one\n');
      const copiedStatus = await getStatus(wcPath);
      expect(copiedStatus.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: copiedFile, status: 'A' })])
      );
      await revert([copiedFile]);
    }

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

    const cleanupTarget = join(peerPath, 'temporary-output.txt');
    writeFileSync(cleanupTarget, 'temporary\n');
    expect((await previewCleanup(peerPath)).unversioned).toContain(cleanupTarget);
    await expect(cleanup(peerPath, { removeUnversioned: true })).resolves.toEqual({
      success: true,
    });
    expect(existsSync(cleanupTarget)).toBe(false);

    await expect(lock(join(peerPath, 'app.txt'), 'release verifier lock')).resolves.toMatchObject({
      success: true,
    });
    const lockInfo = await getLockInfo(join(peerPath, 'app.txt'));
    expect(lockInfo.lock?.comment).toBe('release verifier lock');
    const remoteLocks = await listLocks(wcPath);
    expect(remoteLocks.locks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: expect.any(String), comment: 'release verifier lock' }),
      ])
    );
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

    await revert([join(peerPath, 'app.txt')]);
    writeFileSync(join(peerPath, 'app.txt'), 'header\nline one\nline two\n');
    const offsetApply = await applyPatch(patchPath, peerPath);
    expect(offsetApply.success).toBe(true);
    expect(offsetApply.offsetHunks).toBeGreaterThan(0);

    await revert([join(peerPath, 'app.txt')]);
    writeFileSync(join(peerPath, 'app.txt'), 'unrelated local content\n');
    const conflictedApply = await applyPatch(patchPath, peerPath);
    expect(conflictedApply).toMatchObject({ success: false, appliedWithConflicts: true });
    expect(conflictedApply.rejects).toBeGreaterThan(0);
    expect(existsSync(join(peerPath, 'app.txt.svnpatch.rej'))).toBe(true);

    await revert([join(peerPath, 'app.txt')]);
    const fuzzFile = join(peerPath, 'fuzz.txt');
    writeFileSync(fuzzFile, 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\ngolf\n');
    await add([fuzzFile]);
    await expect(commit([fuzzFile], 'add fuzz fixture')).resolves.toMatchObject({ success: true });
    writeFileSync(fuzzFile, 'alpha\nbravo\ncharlie\nDELTA\necho\nfoxtrot\ngolf\n');
    const fuzzPatchPath = join(tempRoot, 'fuzz.patch');
    await expect(createPatch([fuzzFile], fuzzPatchPath)).resolves.toMatchObject({ success: true });
    await revert([fuzzFile]);
    writeFileSync(fuzzFile, 'alpha\nBRAVO local\ncharlie\ndelta\necho\nfoxtrot\ngolf\n');
    const fuzzApply = await applyPatch(fuzzPatchPath, peerPath);
    expect(fuzzApply.success).toBe(true);
    expect(fuzzApply.fuzzedHunks).toBeGreaterThan(0);
  }, 20_000);

  it('verifies branch/tag creation, switch, and merge against real repository history', async () => {
    await expect(checkout(trunkUrl, wcPath)).resolves.toMatchObject({ success: true });

    const appFile = join(wcPath, 'app.txt');
    writeFileSync(appFile, 'trunk line\n');
    await add([appFile]);
    await expect(commit([appFile], 'add trunk app')).resolves.toMatchObject({ success: true });

    const branchUrl = `${branchesUrl}/feature`;
    await expect(
      copyRepositoryItem(trunkUrl, branchUrl, 'create feature branch')
    ).resolves.toMatchObject({
      success: true,
    });

    await expect(switchWorkingCopy(wcPath, branchUrl)).resolves.toMatchObject({ success: true });
    writeFileSync(appFile, 'trunk line\nfeature line\n');
    const featureCommit = await commit([appFile], 'add feature line');
    expect(featureCommit).toMatchObject({ success: true });

    await expect(switchWorkingCopy(wcPath, trunkUrl)).resolves.toMatchObject({ success: true });
    const eligible = await getMergeInfo(branchUrl, wcPath, 'eligible');
    expect(eligible.revisions.length).toBeGreaterThan(0);
    const merge = await mergeRepositoryRange(branchUrl, wcPath);
    expect(merge.success).toBe(true);
    expect(readFileSync(appFile, 'utf-8')).toContain('feature line');

    await mergeRepositoryRange(branchUrl, wcPath, [`-${featureCommit.revision}`]);
    expect(readFileSync(appFile, 'utf-8')).not.toContain('feature line');
    await mergeRepositoryRange(branchUrl, wcPath, [String(featureCommit.revision)]);
    expect(readFileSync(appFile, 'utf-8')).toContain('feature line');

    const status = await getStatus(wcPath);
    expect(
      status.entries.some((entry) => entry.path.endsWith('app.txt') && entry.status === 'M')
    ).toBe(true);

    await expect(commit([wcPath], 'merge feature branch')).resolves.toMatchObject({
      success: true,
    });
    const merged = await getMergeInfo(branchUrl, wcPath, 'merged');
    expect(merged.revisions).toContain(featureCommit.revision);
    expect(merged.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inherited: false,
          value: expect.stringContaining('/branches/feature'),
        }),
      ])
    );
    const tagUrl = `${tagsUrl}/release-1`;
    await expect(copyRepositoryItem(trunkUrl, tagUrl, 'create release tag')).resolves.toMatchObject(
      {
        success: true,
      }
    );
  });

  it('verifies sparse checkout expansion and repository browser listing', async () => {
    const seedPath = join(tempRoot, 'seed');
    await expect(checkout(trunkUrl, seedPath)).resolves.toMatchObject({ success: true });

    mkdirSync(join(seedPath, 'src'), { recursive: true });
    writeFileSync(join(seedPath, 'src', 'app.txt'), 'sparse target\n');
    writeFileSync(join(seedPath, 'README.md'), 'repo browser target\n');
    // TortoiseSVN's command-line client on the hosted Windows runner converts
    // non-ASCII argv through the active system code page.
    const binaryName = process.platform === 'win32' ? 'binary-data.bin' : '日本 data.bin';
    writeFileSync(join(seedPath, binaryName), Buffer.from([0, 255, 1, 2]));
    await add([join(seedPath, 'src'), join(seedPath, 'README.md'), join(seedPath, binaryName)]);
    const seedCommit = await commit([seedPath], 'seed sparse repository');
    expect(seedCommit).toMatchObject({
      success: true,
    });

    const listing = await listRepository(trunkUrl, 'HEAD', 'immediates');
    expect(listing.entries.map((entry) => entry.name).sort()).toEqual(
      ['README.md', 'src', binaryName].sort()
    );

    const repositoryFile = await catRepositoryFile(`${trunkUrl}/README.md`, 'HEAD');
    expect(Buffer.from(repositoryFile.contentBase64, 'base64').toString('utf8')).toBe(
      'repo browser target\n'
    );
    expect(repositoryFile).toMatchObject({ binary: false, truncated: false });

    const binaryFile = await catRepositoryFile(
      `${trunkUrl}/${encodeURIComponent(binaryName)}`,
      'HEAD'
    );
    expect(Buffer.from(binaryFile.contentBase64, 'base64')).toEqual(Buffer.from([0, 255, 1, 2]));
    expect(binaryFile.binary).toBe(true);

    writeFileSync(join(seedPath, 'README.md'), 'new repository content\n');
    await commit([join(seedPath, 'README.md')], 'change readme');
    const historicalDiff = await getUrlDiff(
      `${trunkUrl}/README.md@${seedCommit.revision}`,
      `${trunkUrl}/README.md@HEAD`
    );
    expect(historicalDiff.hasChanges).toBe(true);
    expect(JSON.stringify(historicalDiff.files)).toContain('new repository content');
    const historicalFile = await catRepositoryFile(
      `${trunkUrl}/README.md`,
      String(seedCommit.revision)
    );
    expect(Buffer.from(historicalFile.contentBase64, 'base64').toString('utf8')).toBe(
      'repo browser target\n'
    );
    await expect(catRepositoryFile(`${trunkUrl}/missing.txt`, 'HEAD')).rejects.toThrow();

    const sparsePath = join(tempRoot, 'sparse');
    await expect(checkout(trunkUrl, sparsePath, undefined, 'empty')).resolves.toMatchObject({
      success: true,
    });
    expect(existsSync(join(sparsePath, 'src', 'app.txt'))).toBe(false);

    const sparseUpdate = await updateToRevision(
      sparsePath,
      trunkUrl,
      join(sparsePath, 'src', 'app.txt'),
      'infinity',
      true
    );
    expect(sparseUpdate.success).toBe(true);
    expect(readFileSync(join(sparsePath, 'src', 'app.txt'), 'utf-8')).toBe('sparse target\n');
  });

  it('verifies externals definition, listing, and update against a real repository', async () => {
    const vendorUrl = `${repoUrl}/vendor`;
    execFileSync('svn', ['mkdir', '-m', 'create vendor area', vendorUrl], { stdio: 'pipe' });

    const vendorPath = join(tempRoot, 'vendor-wc');
    await expect(checkout(vendorUrl, vendorPath)).resolves.toMatchObject({ success: true });
    writeFileSync(join(vendorPath, 'lib.txt'), 'external library\n');
    await add([join(vendorPath, 'lib.txt')]);
    await expect(
      commit([join(vendorPath, 'lib.txt')], 'add external library')
    ).resolves.toMatchObject({
      success: true,
    });

    await expect(checkout(trunkUrl, wcPath)).resolves.toMatchObject({ success: true });
    await expect(
      externalsAdd(wcPath, {
        name: 'vendor-lib',
        path: 'vendor-lib',
        url: vendorUrl,
      })
    ).resolves.toEqual({ success: true });

    const externals = await externalsList(wcPath);
    expect(externals.externals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'vendor-lib',
          url: vendorUrl,
        }),
      ])
    );

    await expect(commit([wcPath], 'add vendor external')).resolves.toMatchObject({ success: true });
    await expect(externalsUpdate(wcPath)).resolves.toEqual({ success: true });
    expect(readFileSync(join(wcPath, 'vendor-lib', 'lib.txt'), 'utf-8')).toBe('external library\n');

    await expect(
      externalsEdit(wcPath, 'vendor-lib', {
        path: 'vendor-lib-renamed',
        url: vendorUrl,
      })
    ).resolves.toMatchObject({ success: true });
    await expect(commit([wcPath], 'edit vendor external')).resolves.toMatchObject({
      success: true,
    });
    const editedExternalUpdate = await externalsUpdate(wcPath, 'vendor-lib-renamed');
    expect(editedExternalUpdate.error).toBeUndefined();
    expect(editedExternalUpdate.success).toBe(true);
    expect(readFileSync(join(wcPath, 'vendor-lib-renamed', 'lib.txt'), 'utf-8')).toBe(
      'external library\n'
    );
    await expect(externalsRemove(wcPath, 'vendor-lib-renamed')).resolves.toMatchObject({
      success: true,
    });
    await expect(commit([wcPath], 'remove vendor external')).resolves.toMatchObject({
      success: true,
    });
  });

  it('verifies remote mutations, import/export, properties, and changelists', async () => {
    const sourcePath = join(tempRoot, 'import-source');
    mkdirSync(sourcePath);
    writeFileSync(join(sourcePath, 'seed.txt'), 'imported\n');
    const importedUrl = `${repoUrl}/imported`;
    await expect(importRepository(sourcePath, importedUrl, 'import seed')).resolves.toMatchObject({
      success: true,
    });

    const exportPath = join(tempRoot, 'exported');
    await expect(exportRepository(importedUrl, exportPath)).resolves.toMatchObject({
      success: true,
    });
    expect(readFileSync(join(exportPath, 'seed.txt'), 'utf-8')).toBe('imported\n');
    await expect(
      propsetRemote(importedUrl, 'custom:owner', 'release-team', 'set remote owner')
    ).resolves.toMatchObject({ success: true });
    await expect(propget(importedUrl, 'custom:owner')).resolves.toMatchObject({
      value: expect.stringContaining('release-team'),
    });
    await expect(
      propdelRemote(importedUrl, 'custom:owner', 'remove remote owner')
    ).resolves.toMatchObject({ success: true });
    await expect(revpropset(repoUrl, 'custom:review', 'approved', '1')).resolves.toMatchObject({
      success: true,
    });
    await expect(revpropget(repoUrl, 'custom:review', '1')).resolves.toMatchObject({
      value: expect.stringContaining('approved'),
    });
    await expect(revpropdel(repoUrl, 'custom:review', '1')).resolves.toMatchObject({
      success: true,
    });

    await expect(
      createRemoteFolder(trunkUrl, 'remote-folder', 'create remote')
    ).resolves.toMatchObject({
      success: true,
    });
    await expect(
      moveRemoteItem(`${trunkUrl}/remote-folder`, `${trunkUrl}/renamed-folder`, 'rename remote')
    ).resolves.toMatchObject({ success: true });
    await expect(
      deleteRemoteItem(`${trunkUrl}/renamed-folder`, 'delete remote')
    ).resolves.toMatchObject({
      success: true,
    });

    await checkout(trunkUrl, wcPath);
    const propertyFile = join(wcPath, 'property.txt');
    writeFileSync(propertyFile, 'properties\n');
    await add([propertyFile]);
    await propset(propertyFile, 'svn:keywords', 'Id');
    expect((await proplist(propertyFile)).properties).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'svn:keywords', value: 'Id' })])
    );
    await propdel(propertyFile, 'svn:keywords');

    await changelistAdd([propertyFile], 'release-check');
    expect((await changelistList(wcPath)).changelists).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'release-check' })])
    );
    await changelistRemove([propertyFile]);
    await changelistAdd([propertyFile], 'release-delete');
    await expect(changelistDelete('release-delete', wcPath)).resolves.toMatchObject({
      success: true,
    });
  });

  it('verifies blame, conflict resolution, relocate, upgrade, cancellation, and failures', async () => {
    await expect(checkout(trunkUrl, wcPath)).resolves.toMatchObject({ success: true });
    const trackedFile = join(wcPath, 'history.txt');
    writeFileSync(trackedFile, 'original\n');
    await add([trackedFile]);
    const addCommit = await commit([trackedFile], 'add history fixture');
    expect(addCommit).toMatchObject({ success: true });

    writeFileSync(trackedFile, 'remote change\n');
    const remoteCommit = await commit([trackedFile], 'change history fixture');
    expect(remoteCommit).toMatchObject({ success: true });

    const blame = await getBlame(trackedFile);
    expect(blame.error).toBeUndefined();
    expect(blame.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revision: remoteCommit.revision,
          author: expect.any(String),
        }),
      ])
    );

    const peerPath = join(tempRoot, 'conflict-peer');
    await expect(checkout(trunkUrl, peerPath)).resolves.toMatchObject({ success: true });
    const peerFile = join(peerPath, 'history.txt');
    writeFileSync(peerFile, 'local change\n');
    writeFileSync(trackedFile, 'second remote change\n');
    await expect(commit([trackedFile], 'create conflict fixture')).resolves.toMatchObject({
      success: true,
    });
    await expect(update(peerPath)).resolves.toMatchObject({ success: true });
    expect((await getStatus(peerPath)).entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: peerFile, status: 'C' })])
    );

    await expect(resolveConflict(peerFile, 'mine-full')).resolves.toEqual({ success: true });
    expect(readFileSync(peerFile, 'utf8')).toBe('local change\n');
    expect((await getStatus(peerPath)).entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: peerFile, status: 'M' })])
    );
    await revert([peerFile]);

    const relocatedRepoPath = join(tempRoot, 'relocated-repo');
    execFileSync('svnadmin', ['hotcopy', repoPath, relocatedRepoPath], { stdio: 'pipe' });
    const relocatedRepoUrl = pathToFileURL(relocatedRepoPath).href;
    await expect(relocateWorkingCopy(repoUrl, relocatedRepoUrl, peerPath)).resolves.toMatchObject({
      success: true,
    });
    expect(
      execFileSync('svn', ['info', '--show-item', 'repos-root-url', peerPath], {
        encoding: 'utf8',
      }).trim()
    ).toSatisfy((actualUrl: string) => decodeURI(actualUrl) === decodeURI(relocatedRepoUrl));
    await expect(upgradeWorkingCopy(peerPath)).resolves.toMatchObject({ success: true });

    const controller = new AbortController();
    controller.abort();
    await expect(
      runSvnText(['log', '--xml', trunkUrl], { signal: controller.signal })
    ).rejects.toThrow(/cancelled/i);

    await expect(update(join(tempRoot, 'not-a-working-copy'))).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/not.*working copy/i),
    });
    await expect(
      createRemoteFolder(trunkUrl, 'existing', 'create existing fixture')
    ).resolves.toMatchObject({ success: true });
    await expect(
      createRemoteFolder(trunkUrl, 'existing', 'duplicate existing fixture')
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/already exists/i),
    });
  }, 20_000);

  it('reports representative failures for every SVN action family against a real repository', async () => {
    await expect(
      checkout(`${trunkUrl}/missing`, join(tempRoot, 'missing-wc'))
    ).resolves.toMatchObject({ success: false, revision: null });
    await expect(listRepository(`${trunkUrl}/missing`)).resolves.toMatchObject({
      entries: [],
      commandError: expect.objectContaining({ category: 'not-found' }),
    });
    await expect(
      exportRepository(`${trunkUrl}/missing`, join(tempRoot, 'missing-export'))
    ).rejects.toThrow();

    await checkout(trunkUrl, wcPath);
    const trackedFile = join(wcPath, 'failure.txt');
    writeFileSync(trackedFile, 'failure fixture\n');
    await add([trackedFile]);
    await commit([trackedFile], 'add failure fixture');

    await expect(add([trackedFile])).rejects.toThrow();
    await expect(unlock(trackedFile)).rejects.toThrow();
    await expect(lock(wcPath, 'directories cannot be locked')).rejects.toThrow();
    await expect(switchWorkingCopy(wcPath, `${branchesUrl}/missing`)).rejects.toThrow();
    await expect(
      copyRepositoryItem(trunkUrl, trunkUrl, 'invalid same-target copy')
    ).resolves.toMatchObject({ success: false, revision: null });
    await expect(
      moveRemoteItem(trunkUrl, `${trunkUrl}/child`, 'invalid descendant move')
    ).resolves.toMatchObject({ success: false, revision: null });
    await expect(deleteRemoteItem(`${trunkUrl}/missing`, 'delete missing')).rejects.toThrow();
    await expect(
      importRepository(wcPath, trunkUrl, 'import into existing target')
    ).rejects.toThrow();
    await expect(
      mergeRepositoryRange(trunkUrl, join(tempRoot, 'not-a-working-copy'))
    ).rejects.toThrow(/working copy/i);
    await expect(cleanup(join(tempRoot, 'not-a-working-copy'))).rejects.toThrow();

    await expect(propset(trackedFile, 'invalid property name', 'value')).rejects.toThrow();
    await expect(propget(`${trunkUrl}/missing`, 'svn:ignore')).resolves.toMatchObject({
      commandError: expect.objectContaining({ category: 'not-found' }),
    });
    await expect(changelistAdd([], 'empty-target')).rejects.toThrow();
    await expect(changelistDelete('missing', wcPath)).resolves.toMatchObject({ success: true });
    await expect(
      externalsAdd(wcPath, { path: 'outside', name: '../outside', url: '^/vendor' })
    ).resolves.toMatchObject({ success: false });
    await expect(
      externalsEdit(wcPath, 'missing', { path: 'replacement', url: '^/vendor' })
    ).resolves.toMatchObject({ success: false });
    await expect(externalsRemove(wcPath, 'missing')).resolves.toMatchObject({ success: true });
    await expect(applyPatch(join(tempRoot, 'missing.patch'), wcPath)).resolves.toMatchObject({
      success: false,
    });
  }, 20_000);

  it('shelves and restores text, binary, and unversioned files with the portable backend', async () => {
    process.env.SHELLYSVN_PORTABLE_SHELF_ROOT = join(tempRoot, 'shelf-storage');
    await expect(checkout(trunkUrl, wcPath)).resolves.toMatchObject({ success: true });
    const textFile = join(wcPath, 'portable.txt');
    const binaryFile = join(wcPath, 'portable.bin');
    writeFileSync(textFile, 'original\n');
    writeFileSync(binaryFile, Buffer.from([0, 1, 2]));
    await add([textFile, binaryFile]);
    await expect(
      commit([textFile, binaryFile], 'add portable shelf fixtures')
    ).resolves.toMatchObject({ success: true });

    writeFileSync(textFile, 'shelved text\n');
    writeFileSync(binaryFile, Buffer.from([0, 255, 3, 4]));
    const unversionedFile = join(wcPath, 'unversioned.bin');
    writeFileSync(unversionedFile, Buffer.from([9, 8, 7]));

    await expect(
      portableShelfSave('portable-work', wcPath, 'portable shelf test')
    ).resolves.toMatchObject({ success: true });
    expect(readFileSync(textFile, 'utf8')).toBe('original\n');
    expect(readFileSync(binaryFile)).toEqual(Buffer.from([0, 1, 2]));
    expect(existsSync(unversionedFile)).toBe(false);
    await expect(portableShelfList(wcPath)).resolves.toMatchObject({
      shelves: [
        expect.objectContaining({
          name: 'portable-work',
          message: 'portable shelf test',
        }),
      ],
    });

    await expect(portableShelfApply('portable-work', wcPath)).resolves.toMatchObject({
      success: true,
    });
    expect(readFileSync(textFile, 'utf8')).toBe('shelved text\n');
    expect(readFileSync(binaryFile)).toEqual(Buffer.from([0, 255, 3, 4]));
    expect(readFileSync(unversionedFile)).toEqual(Buffer.from([9, 8, 7]));

    await expect(portableShelfDelete('portable-work', wcPath)).resolves.toEqual({
      success: true,
    });
    await expect(portableShelfList(wcPath)).resolves.toEqual({ shelves: [] });
  }, 20_000);
});
