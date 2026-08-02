import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

const DEFAULT_GRACE_MS = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function taskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve) => {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    const child = spawn('taskkill.exe', args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

export async function terminateProcessTree(
  child: Pick<ChildProcess, 'pid' | 'exitCode' | 'killed'>,
  graceMs = DEFAULT_GRACE_MS
): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await taskkill(pid, false);
    await delay(graceMs);
    if (child.exitCode === null) await taskkill(pid, true);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  await delay(graceMs);
  if (processGroupAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The process group exited between the liveness check and the signal.
    }
  }
}
