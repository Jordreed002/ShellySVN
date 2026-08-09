import type { AiTaskKind, AiUsageEntry } from '@shared/types';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeSecureJson } from '../utils/secure-json';

const FILE_NAME = 'ai-usage-history.json';
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const MAX_HISTORY_ENTRIES = 1_000;
const TASKS = new Set<AiTaskKind>([
  'commit-message',
  'draft-transformation',
  'pre-commit-review',
  'commit-plan',
  'diff-explanation',
  'release-notes',
  'conflict-resolution',
]);

function boundedSettings(retentionDays: number, maxEntries: number): [number, number] {
  const retention = Number.isFinite(retentionDays)
    ? Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(retentionDays)))
    : DEFAULT_RETENTION_DAYS;
  const entries = Number.isFinite(maxEntries)
    ? Math.min(MAX_HISTORY_ENTRIES, Math.max(1, Math.floor(maxEntries)))
    : DEFAULT_MAX_ENTRIES;
  return [retention, entries];
}

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

function isSafeEntry(value: unknown): value is AiUsageEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AiUsageEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.task === 'string' &&
    TASKS.has(entry.task as AiTaskKind) &&
    (entry.provider === 'codex' || entry.provider === 'claude') &&
    typeof entry.startedAt === 'string' &&
    Number.isFinite(Date.parse(entry.startedAt)) &&
    typeof entry.durationMs === 'number' &&
    Number.isFinite(entry.durationMs) &&
    entry.durationMs >= 0 &&
    typeof entry.inputBytes === 'number' &&
    Number.isFinite(entry.inputBytes) &&
    entry.inputBytes >= 0 &&
    typeof entry.truncated === 'boolean' &&
    typeof entry.redacted === 'boolean' &&
    ['success', 'error', 'cancelled'].includes(entry.status ?? '')
  );
}

export async function readAiUsageHistory(
  retentionDays = DEFAULT_RETENTION_DAYS,
  maxEntries = DEFAULT_MAX_ENTRIES
): Promise<AiUsageEntry[]> {
  const [safeRetentionDays, safeMaxEntries] = boundedSettings(retentionDays, maxEntries);
  let values: unknown = [];
  try {
    values = JSON.parse(await readFile(filePath(), 'utf8'));
  } catch {
    return [];
  }
  const cutoff = Date.now() - safeRetentionDays * 86_400_000;
  return (Array.isArray(values) ? values : [])
    .filter(isSafeEntry)
    .filter((entry) => Date.parse(entry.startedAt) >= cutoff)
    .slice(0, safeMaxEntries);
}

export async function appendAiUsageEntry(
  entry: Omit<AiUsageEntry, 'id'>,
  retentionDays = DEFAULT_RETENTION_DAYS,
  maxEntries = DEFAULT_MAX_ENTRIES
): Promise<void> {
  const [, safeMaxEntries] = boundedSettings(retentionDays, maxEntries);
  const existing = await readAiUsageHistory(retentionDays, safeMaxEntries);
  // This object is intentionally allow-listed. It cannot contain paths, prompts,
  // diffs, provider output, or generated text.
  const safe: AiUsageEntry = {
    id: randomUUID(),
    task: entry.task,
    provider: entry.provider,
    model: entry.model?.slice(0, 100),
    startedAt: entry.startedAt,
    durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.floor(entry.durationMs)) : 0,
    status: entry.status,
    errorCode: entry.errorCode,
    inputBytes: Number.isFinite(entry.inputBytes) ? Math.max(0, Math.floor(entry.inputBytes)) : 0,
    truncated: entry.truncated,
    redacted: entry.redacted,
  };
  await writeSecureJson(filePath(), [safe, ...existing].slice(0, safeMaxEntries));
}

export async function clearAiUsageHistory(): Promise<void> {
  await rm(filePath(), { force: true });
}
