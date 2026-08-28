import type { InterruptedMutationRecord } from '@shared/types';
import { readFileSync, rmSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, join, normalize, parse, win32 } from 'node:path';
import { writeSecureJsonSync } from '../utils/secure-json';

interface MutationQueueEntry {
  paths: string[];
  tail: Promise<void>;
}

interface MutationInterruptionJournal {
  version: 1;
  entries: InterruptedMutationRecord[];
}

/**
 * Journal file (inside the Electron userData directory) that survives the
 * shutdown that interrupted the mutations, so the next launch can surface and
 * recover them. The mutation queue itself is intentionally in-memory only;
 * this journal is the single persisted artifact and its shape is
 * forward-compatible: unknown versions or malformed files read as "nothing
 * interrupted" instead of failing startup.
 */
export const MUTATION_INTERRUPTION_JOURNAL_FILE_NAME = 'svn-mutation-journal.json';

const mutationQueues = new Map<string, MutationQueueEntry>();
const listeners = new Set<(paths: string[]) => void>();
let mutationShutdownRequested = false;
let mutationResolutionTail: Promise<void> = Promise.resolve();

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
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkingCopyMutationPath(path: string): Promise<string> {
  const requested = path.trim();
  const pathApi = isWindowsPath(requested) ? win32 : { dirname, join, parse };
  let current = requested;
  try {
    if ((await stat(current)).isFile()) current = pathApi.dirname(current);
  } catch {
    current = pathApi.dirname(current);
  }

  const root = pathApi.parse(current).root;
  while (current) {
    if (await pathExists(pathApi.join(current, '.svn'))) {
      try {
        return await realpath(current);
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
  // Preserve invocation order while roots are resolved asynchronously. Without
  // this short gate, a later filesystem lookup could finish first and invert
  // FIFO ordering before either mutation reaches the per-working-copy queue.
  const resolvedRoot = mutationResolutionTail.then(() =>
    resolveWorkingCopyMutationPath(workingCopyKey)
  );
  mutationResolutionTail = resolvedRoot.then(
    () => undefined,
    () => undefined
  );
  const workingCopyRoot = await resolvedRoot;
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

export function getMutationInterruptionJournalPath(userDataPath: string): string {
  return join(userDataPath, MUTATION_INTERRUPTION_JOURNAL_FILE_NAME);
}

/**
 * Record the currently in-flight mutations as interrupted (backlog item #24).
 * Called right before shutdown cancels them, so the next launch can offer
 * recovery (e.g. `svn cleanup`) for those working copies. Prior unresolved
 * entries are preserved; when nothing is in flight the journal is left
 * untouched — a clean shutdown must not erase an earlier session's record.
 */
export function markActiveWorkingCopyMutationsInterrupted(
  journalPath: string,
  reason = 'shutdown'
): number {
  const active = getActiveWorkingCopyMutations();
  if (active.length === 0) return 0;

  const entries = new Map(
    readInterruptedWorkingCopyMutations(journalPath).map((entry) => [entry.workingCopyPath, entry])
  );
  const interruptedAt = new Date().toISOString();
  for (const workingCopyPath of active) {
    entries.set(workingCopyPath, { workingCopyPath, interruptedAt, reason });
  }

  const journal: MutationInterruptionJournal = {
    version: 1,
    entries: Array.from(entries.values()),
  };
  writeSecureJsonSync(journalPath, journal);
  return active.length;
}

export function readInterruptedWorkingCopyMutations(journalPath: string): InterruptedMutationRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath, 'utf-8')) as unknown;
  } catch {
    return [];
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as MutationInterruptionJournal).version !== 1 ||
    !Array.isArray((parsed as MutationInterruptionJournal).entries)
  ) {
    return [];
  }
  return (parsed as MutationInterruptionJournal).entries.filter(
    (entry): entry is InterruptedMutationRecord =>
      typeof entry?.workingCopyPath === 'string' &&
      entry.workingCopyPath.length > 0 &&
      typeof entry.interruptedAt === 'string' &&
      typeof entry.reason === 'string'
  );
}

/** Drop the journal after the renderer acknowledges recovery. */
export function clearInterruptedWorkingCopyMutations(journalPath: string): void {
  try {
    rmSync(journalPath, { force: true });
  } catch {
    // A missing or already-cleared journal is the desired end state.
  }
}
