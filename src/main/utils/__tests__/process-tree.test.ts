// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
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
