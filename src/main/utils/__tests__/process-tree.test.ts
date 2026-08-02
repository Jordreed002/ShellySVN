// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process.spawn so the Windows taskkill path can be exercised on
// any host platform without invoking a real binary. The POSIX branch never
// calls spawn (it uses process.kill), so this mock is inert for those tests.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from 'node:child_process';
import { terminateProcessTree } from '../process-tree';

describe.skipIf(process.platform === 'win32')('POSIX process-tree termination', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('escalates from SIGTERM to SIGKILL for a surviving process group', async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const termination = terminateProcessTree({ pid: 4242, exitCode: null, killed: false });

    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(2_000);
    await termination;

    expect(kill).toHaveBeenCalledWith(-4242, 0);
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('is a no-op for an already-exited child', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    await terminateProcessTree({ pid: 4242, exitCode: 0, killed: true });
    expect(kill).not.toHaveBeenCalled();
  });
});

/**
 * Windows termination path. The host platform is forced to win32 so the
 * taskkill.exe branch runs regardless of where the suite executes. spawn is
 * mocked, so no real process is touched.
 */
describe('Windows process-tree termination', () => {
  const originalPlatform = process.platform;
  const mockedSpawn = vi.mocked(spawn);

  function makeFakeChild(): EventEmitter {
    // taskkill() registers 'error' then 'close' handlers and resolves on
    // whichever fires first. Emitting 'close' on the next tick lets the
    // promise settle deterministically.
    const child = new EventEmitter();
    const once = child.once.bind(child);
    child.once = ((event: string, listener: (...args: unknown[]) => void) => {
      once(event as any, listener as any);
      if (event === 'close') {
        queueMicrotask(() => listener(0, null));
      }
      return child;
    }) as typeof child.once;
    return child;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockedSpawn.mockReset();
    mockedSpawn.mockImplementation(() => makeFakeChild() as any);
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('escalates from graceful taskkill to /T /F when the child survives', async () => {
    const termination = terminateProcessTree({ pid: 4321, exitCode: null, killed: false });

    // First (graceful) taskkill fires immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedSpawn).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '4321', '/T'],
      expect.objectContaining({ shell: false, windowsHide: true, stdio: 'ignore' })
    );

    // After the grace window, the still-live child is force-killed.
    await vi.advanceTimersByTimeAsync(2_000);
    await termination;

    expect(mockedSpawn).toHaveBeenCalledWith('taskkill.exe', ['/PID', '4321', '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('does not force-kill when the graceful taskkill already terminated the child', async () => {
    // The child resolves to exited once the grace delay elapses.
    const child = { pid: 9001, exitCode: null as number | null, killed: false };
    const termination = terminateProcessTree(child);

    await vi.advanceTimersByTimeAsync(0);
    // Simulate taskkill having killed the process before the grace window ends.
    child.exitCode = 0;
    await vi.advanceTimersByTimeAsync(2_000);
    await termination;

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn).toHaveBeenCalledWith('taskkill.exe', ['/PID', '9001', '/T'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
  });

  it('is a no-op for an already-exited child', async () => {
    await terminateProcessTree({ pid: 7, exitCode: 1, killed: true });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('is a no-op when no pid is present', async () => {
    await terminateProcessTree({ pid: undefined, exitCode: null, killed: false });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('passes through a caller-supplied grace window', async () => {
    const termination = terminateProcessTree({ pid: 55, exitCode: null, killed: false }, 5_000);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);

    // Force-kill must not happen before the longer grace window elapses.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    await termination;
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });
});
