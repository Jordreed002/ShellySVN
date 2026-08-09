import { randomUUID } from 'node:crypto';
import type { SvnCommandTimelineEntry } from '@shared/types';

const MAX_ENTRIES = 200;
const entries: SvnCommandTimelineEntry[] = [];

function safeOperation(value: string | undefined): string {
  const operation = value?.toLowerCase() ?? 'unknown';
  return /^[a-z][a-z0-9-]{0,40}$/.test(operation) ? operation : 'unknown';
}

function countTargets(args: string[]): number {
  let count = 0;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      count += args.length - index - 1;
      break;
    }
    if (!argument.startsWith('-') && !/^(?:https?|svn(?:\+ssh)?):\/\//i.test(argument)) {
      count += 1;
    }
  }
  return count;
}

function classifyFailure(error: unknown, aborted: boolean): string {
  if (aborted || (error instanceof Error && error.name === 'AbortError')) return 'cancelled';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('authentication') || message.includes('authorization'))
    return 'authentication';
  if (message.includes('certificate') || message.includes('ssl')) return 'certificate';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('not found') || message.includes('enoent')) return 'client-unavailable';
  if (message.includes('working copy')) return 'working-copy';
  if (message.includes('conflict')) return 'conflict';
  return 'svn-error';
}

export function beginSvnTimelineEntry(args: string[]): string {
  const id = randomUUID();
  entries.unshift({
    id,
    operation: safeOperation(args[0]),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: 'running',
    affectedPathCount: countTargets(args),
  });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return id;
}

export function completeSvnTimelineEntry(
  id: string,
  startedAtMs: number,
  result: { code?: number | null },
  aborted = false
): void {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.durationMs = Math.max(0, Date.now() - startedAtMs);
  entry.exitCode = result.code ?? undefined;
  entry.status = aborted ? 'cancelled' : 'success';
}

export function failSvnTimelineEntry(
  id: string,
  startedAtMs: number,
  error: unknown,
  aborted = false
): void {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.durationMs = Math.max(0, Date.now() - startedAtMs);
  entry.status =
    aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'failed';
  entry.safeDiagnostic = classifyFailure(error, aborted);
}

export function getSvnCommandTimeline(): SvnCommandTimelineEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearSvnCommandTimeline(): void {
  entries.length = 0;
}
