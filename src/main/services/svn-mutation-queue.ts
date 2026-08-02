import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, normalize, parse, win32 } from 'node:path';

interface MutationQueueEntry {
  paths: string[];
  tail: Promise<void>;
}

const mutationQueues = new Map<string, MutationQueueEntry>();
const listeners = new Set<(paths: string[]) => void>();
let mutationShutdownRequested = false;

function emitMutationState(): void {
  const paths = getActiveWorkingCopyMutations();
  for (const listener of listeners) {
    try {
      listener(paths);
    } catch {
      // Observers must not be able to interrupt mutation serialization.
    }
  }
}

export function hasActiveWorkingCopyMutations(): boolean {
  return mutationQueues.size > 0;
}

export function getActiveWorkingCopyMutations(): string[] {
  return Array.from(new Set(Array.from(mutationQueues.values()).flatMap((entry) => entry.paths)));
}

export function subscribeToWorkingCopyMutations(listener: (paths: string[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginWorkingCopyMutationShutdown(): void {
  mutationShutdownRequested = true;
}

export async function waitForWorkingCopyMutations(): Promise<void> {
  while (mutationQueues.size > 0) {
    await Promise.all(
      Array.from(mutationQueues.values(), (entry) => entry.tail.catch(() => undefined))
    );
  }
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function normalizeMutationPath(path: string): string {
  const trimmed = path.trim();
  if (isWindowsPath(trimmed)) return win32.normalize(trimmed).toLowerCase();
  return normalize(trimmed);
}

/** Resolve a file or nested directory to the administrative root that owns it. */
function resolveWorkingCopyMutationPath(path: string): string {
  const requested = path.trim();
  const pathApi = isWindowsPath(requested) ? win32 : { dirname, join, parse };
  let current = requested;
  try {
    if (existsSync(current) && statSync(current).isFile()) current = pathApi.dirname(current);
  } catch {
    current = pathApi.dirname(current);
  }

  const root = pathApi.parse(current).root;
  while (current) {
    if (existsSync(pathApi.join(current, '.svn'))) {
      try {
        return realpathSync.native(current);
      } catch {
        return current;
      }
    }
    if (current === root) break;
    const parent = pathApi.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return requested;
}

export async function runSerializedWorkingCopyMutation<T>(
  workingCopyKey: string,
  task: () => Promise<T>
): Promise<T> {
  if (mutationShutdownRequested)
    throw new Error('Application is shutting down; SVN mutation cancelled');
  const workingCopyRoot = resolveWorkingCopyMutationPath(workingCopyKey);
  const key = normalizeMutationPath(workingCopyRoot);
  const previous = mutationQueues.get(key)?.tail ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  mutationQueues.set(key, {
    paths: Array.from(new Set([workingCopyRoot, workingCopyKey])),
    tail,
  });
  emitMutationState();

  await previous.catch(() => undefined);

  try {
    if (mutationShutdownRequested)
      throw new Error('Application is shutting down; SVN mutation cancelled');
    return await task();
  } finally {
    release();
    if (mutationQueues.get(key)?.tail === tail) {
      mutationQueues.delete(key);
      emitMutationState();
    }
  }
}

export function getMutationQueueStateForTests(): { keys: string[] } {
  return { keys: Array.from(mutationQueues.keys()) };
}
