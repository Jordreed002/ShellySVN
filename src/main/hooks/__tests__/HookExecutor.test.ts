// @vitest-environment node

/**
 * HookExecutor runs user-configured hook scripts around SVN operations. It has
 * Windows-specific executable validation and delegates timed-out process cleanup
 * to the shared descendant-safe process-tree terminator. These tests pin that
 * behaviour plus the core argv/exit-code contract without invoking OS processes.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
const terminateProcessTree = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('child_process', () => ({ spawn }));
vi.mock('../../utils/process-tree', () => ({ terminateProcessTree }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    accessSync: vi.fn(),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
});

vi.mock('../../utils/approved-paths', () => ({
  // Passthrough: return the path unchanged so the hook can run.
  assertPathApprovedForIpc: vi.fn((path: string) => path),
}));

vi.mock('../../utils/safe-renderer-send', () => ({ sendToRenderer: vi.fn() }));

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));

import { accessSync, statSync } from 'fs';
import { executeHook, type HookScript, type HookContext } from '../HookExecutor';

function makeChild(): EventEmitter & {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

const baseHook: HookScript = {
  id: 'h1',
  name: 'pre-commit',
  type: 'pre-commit',
  path: '/wc/.shelly/hooks/pre-commit',
  enabled: true,
  waitForResult: true,
  showConsole: false,
};

const baseContext: HookContext = {
  workingCopyPath: '/wc',
  files: ['src/a.ts', 'src/b.ts'],
  message: 'ship it',
  revision: 42,
  force: true,
};

afterEach(() => {
  // restoreAllMocks undoes vi.spyOn (e.g. process.kill) but does NOT clear the
  // mock.calls history of the fs module mocks (accessSync/statSync). Without
  // clearAllMocks that history leaks across tests, so the Windows test — which
  // asserts accessSync is never called — sees stale calls from the POSIX tests.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('executeHook — argv and exit code', () => {
  it('builds the hook argv from context and reports success on exit 0', async () => {
    const child = makeChild();
    spawn.mockReturnValue(child);

    const promise = executeHook(baseHook, baseContext);
    child.emit('close', 0);
    const result = await promise;

    expect(spawn).toHaveBeenCalledWith(
      baseHook.path,
      [
        '/wc',
        '--files',
        'src/a.ts,src/b.ts',
        '--message',
        'ship it',
        '--revision',
        '42',
        '--force',
      ],
      expect.objectContaining({ detached: true })
    );
    expect(result).toMatchObject({ success: true, exitCode: 0 });
  });

  it('reports failure with stderr when the hook exits non-zero', async () => {
    const child = makeChild();
    spawn.mockReturnValue(child);

    const promise = executeHook(baseHook, baseContext);
    child.stderr?.emit('data', Buffer.from('blocked by policy'));
    child.emit('close', 1);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('blocked by policy');
  });
});

describe('executeHook — Windows executable validation', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(statSync).mockReturnValue({ isFile: () => true } as never);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('skips the execute-bit (X_OK) check on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    });
    const child = makeChild();
    spawn.mockReturnValue(child);

    const promise = executeHook(baseHook, baseContext);
    child.emit('close', 0);
    await promise;

    expect(accessSync).not.toHaveBeenCalled();
  });

  it('checks X_OK on POSIX', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
    const child = makeChild();
    spawn.mockReturnValue(child);

    const promise = executeHook(baseHook, baseContext);
    child.emit('close', 0);
    await promise;

    expect(accessSync).toHaveBeenCalled();
  });
});

describe('executeHook — process-tree termination on timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminateProcessTree.mockResolvedValue(undefined);
  });

  it('waits for descendant-safe termination before resolving the timeout', async () => {
    const child = makeChild();
    spawn.mockReturnValue(child);
    let completeTermination!: () => void;
    terminateProcessTree.mockReturnValue(
      new Promise<void>((resolve) => {
        completeTermination = resolve;
      })
    );

    // Minimum allowed timeout is 1s.
    const promise = executeHook({ ...baseHook, timeoutMs: 1000 }, baseContext);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(terminateProcessTree).toHaveBeenCalledWith(child, 1000);
    expect(resolved).toBe(false);

    // A close event caused by termination must not win the race and report a normal exit.
    child.emit('close', 0);
    await Promise.resolve();
    expect(resolved).toBe(false);

    completeTermination();
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('still resolves as timed out if process-tree termination cannot inspect the child', async () => {
    const child = makeChild();
    spawn.mockReturnValue(child);
    terminateProcessTree.mockRejectedValue(new Error('process already disappeared'));

    const promise = executeHook({ ...baseHook, timeoutMs: 1000 }, baseContext);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toMatchObject({
      success: false,
      error: 'Hook timed out after 1 seconds.',
    });
  });
});
