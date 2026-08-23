// @vitest-environment node

/*
 * Shutdown-safety coverage for backlog items #24 and #25:
 * - the mutation interruption journal (persist, read, preserve, clear),
 * - the live SVN process registry + bulk SIGTERM/SIGKILL shutdown,
 * - the suspend/resume network gate around repository-bound SVN commands.
 *
 * Mirrors the mocking conventions of services/__tests__/svn-executor.test.ts
 * (child_process + settings/auth/ssl caches + process-tree fakes) so the real
 * executor/runner/queue modules run without Electron or a real svn binary.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  spawn: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/svn-config-123'),
  rm: vi.fn().mockResolvedValue(undefined),
  settingsReady: vi.fn().mockResolvedValue(undefined),
  getSvnClientPath: vi.fn().mockReturnValue('svn'),
  getSvnExecutionContext: vi.fn().mockReturnValue({
    proxySettings: { enabled: false },
    connectionTimeout: 0,
    sslVerify: true,
    clientCertificatePath: '',
  }),
  authReady: vi.fn().mockResolvedValue(undefined),
  authFindForUrl: vi.fn(),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslFindForUrl: vi.fn(),
  terminateProcessTree: vi.fn().mockResolvedValue(undefined),
}));

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  proc.stdin = stdin;
  return proc;
}

vi.mock('child_process', () => ({
  default: { spawn: mockState.spawn },
  spawn: mockState.spawn,
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: mockState.writeFile,
    mkdtemp: mockState.mkdtemp,
    rm: mockState.rm,
  },
  writeFile: mockState.writeFile,
  mkdtemp: mockState.mkdtemp,
  rm: mockState.rm,
}));

vi.mock('../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: mockState.settingsReady,
    getSvnClientPath: mockState.getSvnClientPath,
    getSvnExecutionContext: mockState.getSvnExecutionContext,
  }),
}));

vi.mock('../auth-cache', () => ({
  getAuthCache: () => ({
    ready: mockState.authReady,
    findForUrl: mockState.authFindForUrl,
  }),
}));

vi.mock('../ssl-trust-cache', () => ({
  getSslTrustCache: () => ({
    ready: mockState.sslReady,
    findForUrl: mockState.sslFindForUrl,
  }),
}));

vi.mock('../utils/process-tree', () => ({
  terminateProcessTree: mockState.terminateProcessTree,
}));

import {
  beginSvnNetworkSuspend,
  endSvnNetworkSuspend,
  getSuspendedSvnNetworkUrls,
  isSvnNetworkSuspended,
  runSvn,
} from '../services/svn-executor';
import { getLiveSvnProcessCount, terminateAllSvnProcesses } from '../services/svn-runner';
import {
  beginWorkingCopyMutationShutdown,
  clearInterruptedWorkingCopyMutations,
  getActiveWorkingCopyMutations,
  markActiveWorkingCopyMutationsInterrupted,
  readInterruptedWorkingCopyMutations,
  runSerializedWorkingCopyMutation,
} from '../services/svn-mutation-queue';
import { realpathSync } from 'node:fs';

const REPO_URL = 'https://svn.example.com/repo/trunk';

async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

async function startSvn(args: string[], options: Record<string, unknown> = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvn(args, options);
  for (let index = 0; index < 500 && mockState.spawn.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
  }
  return { proc, promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  if (isSvnNetworkSuspended()) endSvnNetworkSuspend();
});

afterEach(() => {
  if (isSvnNetworkSuspended()) endSvnNetworkSuspend();
});

describe('mutation interruption journal (item #24)', () => {
  let journalPath: string;
  let workingCopyRoot: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'shelly-journal-'));
    journalPath = join(base, 'svn-mutation-journal.json');
    workingCopyRoot = join(base, 'wc');
    mkdirSync(join(workingCopyRoot, '.svn'), { recursive: true });
  });

  it('persists in-flight mutations and preserves them for the next launch', async () => {
    let releaseTask: (() => void) | undefined;
    const task = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const mutation = runSerializedWorkingCopyMutation(workingCopyRoot, () => task);
    await vi.waitFor(() => expect(getActiveWorkingCopyMutations().length).toBeGreaterThan(0));

    const marked = markActiveWorkingCopyMutationsInterrupted(journalPath, 'quit-cancelled');
    // The queue reports both the resolved root and the requested key; the
    // canonical root entry is what recovery flows key off.
    expect(marked).toBeGreaterThanOrEqual(1);

    const entries = readInterruptedWorkingCopyMutations(journalPath);
    expect(entries.length).toBe(marked);
    expect(entries).toContainEqual(
      expect.objectContaining({
        workingCopyPath: realpathSync.native(workingCopyRoot),
        reason: 'quit-cancelled',
      })
    );
    for (const entry of entries) {
      expect(typeof entry.interruptedAt).toBe('string');
    }

    releaseTask?.();
    await mutation;
    expect(getActiveWorkingCopyMutations()).toHaveLength(0);

    // A later clean shutdown must not erase the unresolved record.
    expect(markActiveWorkingCopyMutationsInterrupted(journalPath, 'shutdown')).toBe(0);
    expect(readInterruptedWorkingCopyMutations(journalPath)).toHaveLength(entries.length);
  });

  it('writes nothing when no mutation is in flight', () => {
    expect(markActiveWorkingCopyMutationsInterrupted(journalPath)).toBe(0);
    expect(readInterruptedWorkingCopyMutations(journalPath)).toEqual([]);
  });

  it('reads corrupt or unknown-version journals as empty (backward compatible)', () => {
    writeFileSync(journalPath, 'not json at all', 'utf-8');
    expect(readInterruptedWorkingCopyMutations(journalPath)).toEqual([]);

    writeFileSync(
      journalPath,
      JSON.stringify({ version: 99, entries: [{ workingCopyPath: '/tmp/x' }] }),
      'utf-8'
    );
    expect(readInterruptedWorkingCopyMutations(journalPath)).toEqual([]);
  });

  it('clears the journal on acknowledgement', async () => {
    runSerializedWorkingCopyMutation(workingCopyRoot, () => new Promise<void>(() => {})).catch(
      () => undefined
    );
    await vi.waitFor(() => expect(getActiveWorkingCopyMutations().length).toBeGreaterThan(0));
    markActiveWorkingCopyMutationsInterrupted(journalPath);
    expect(readInterruptedWorkingCopyMutations(journalPath).length).toBeGreaterThan(0);

    clearInterruptedWorkingCopyMutations(journalPath);
    expect(readInterruptedWorkingCopyMutations(journalPath)).toEqual([]);
  });

  it('still rejects new mutations once shutdown began (queue integration)', async () => {
    beginWorkingCopyMutationShutdown();
    await expect(
      runSerializedWorkingCopyMutation(workingCopyRoot, async () => undefined)
    ).rejects.toThrow(/shutting down/i);
  });
});

describe('live SVN process registry + shutdown kill (item #24)', () => {
  it('terminates only still-running children with a bounded grace period', async () => {
    const first = await startSvn(['status', '/tmp/wc']);
    const second = await startSvn(['status', '/tmp/other-wc']);
    await vi.waitFor(() => expect(mockState.spawn).toHaveBeenCalledTimes(2));
    expect(getLiveSvnProcessCount()).toBe(2);

    first.proc.emit('close', 1);
    await expect(first.promise).rejects.toThrow(); // nonzero exit settles the first op
    expect(getLiveSvnProcessCount()).toBe(1);

    mockState.terminateProcessTree.mockClear();
    const terminated = await terminateAllSvnProcesses(50);

    expect(terminated).toBe(1);
    expect(mockState.terminateProcessTree).toHaveBeenCalledTimes(1);
    expect(mockState.terminateProcessTree).toHaveBeenCalledWith(second.proc, 50);
    expect(getLiveSvnProcessCount()).toBe(0);
    await expect(terminateAllSvnProcesses()).resolves.toBe(0);
  });
});

describe('suspend/resume network gate (item #25)', () => {
  it('resolves immediately while the gate is open', async () => {
    const { proc, promise } = await startSvn(['info', '--xml', REPO_URL]);
    proc.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ code: 0 });
  });

  it('queues repository-bound commands while suspended and releases them after', async () => {
    beginSvnNetworkSuspend();
    expect(isSvnNetworkSuspended()).toBe(true);

    const { proc, promise } = await startSvn(['info', '--xml', REPO_URL]);
    await flushMicrotasks();
    expect(mockState.spawn).not.toHaveBeenCalled();

    endSvnNetworkSuspend();
    await vi.waitFor(() => expect(mockState.spawn).toHaveBeenCalledTimes(1));
    proc.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ code: 0 });
  });

  it('aborts in-flight network operations on suspend', async () => {
    const { proc, promise } = await startSvn(['log', '--xml', REPO_URL, '-l', '10']);
    expect(mockState.spawn).toHaveBeenCalledTimes(1);

    const aborted = beginSvnNetworkSuspend();
    expect(aborted).toBe(1);
    expect(getSuspendedSvnNetworkUrls()).toContain(REPO_URL);

    await expect(promise).rejects.toThrow(/suspended while the system sleeps/i);
    expect(mockState.terminateProcessTree).toHaveBeenCalledWith(proc);
    endSvnNetworkSuspend();
    expect(getSuspendedSvnNetworkUrls()).toEqual([]);
  });

  it('keeps local-only commands running during suspension', async () => {
    beginSvnNetworkSuspend();
    const { proc, promise } = await startSvn(['status', '/tmp/wc']);
    await vi.waitFor(() => expect(mockState.spawn).toHaveBeenCalledTimes(1));
    proc.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ code: 0 });
  });

  it('keeps the historical message for external cancellation of network operations', async () => {
    const controller = new AbortController();
    const { proc, promise } = await startSvn(['checkout', REPO_URL, '/tmp/wc'], {
      signal: controller.signal,
    });
    expect(mockState.spawn).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(promise).rejects.toThrow('SVN operation cancelled');
    expect(mockState.terminateProcessTree).toHaveBeenCalledWith(proc);
  });
});
