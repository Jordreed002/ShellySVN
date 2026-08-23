/**
 * Per-working-copy recall of recently used commit messages (#73a).
 *
 * The global history in `hooks/useCommitMessageHistory.ts` keeps every message
 * the app has ever committed (capped at 50); this store answers the narrower
 * "what did I commit *here* last week?" question. Only the working copies that
 * actually committed something are kept (at most `MAX_TRACKED_WORKING_COPIES`,
 * least-recently-used evicted first) so the payload stays bounded no matter
 * how many checkouts the user touches.
 *
 * Persisted through the same `window.api.store` bridge and the same
 * parse/normalize/persist split as `lib/shortcutStore.ts`.
 */

export const RECENT_COMMIT_MESSAGES_KEY = 'shellysvn:recent-commit-messages:v1';

/** Mission cap: at most 20 remembered messages per working copy. */
export const MAX_RECENT_MESSAGES_PER_WC = 20;
/** Bound on how many working copies keep a recall list. */
export const MAX_TRACKED_WORKING_COPIES = 50;

export interface RecentCommitMessageEntry {
  message: string;
  timestamp: number;
}

export type RecentCommitMessageStore = Record<string, RecentCommitMessageEntry[]>;

function normalizeWorkingCopyKey(workingCopyPath: string): string {
  return workingCopyPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function parseEntry(value: unknown): RecentCommitMessageEntry | null {
  if (!value || typeof value !== 'object') return null;
  const { message, timestamp } = value as { message?: unknown; timestamp?: unknown };
  if (typeof message !== 'string' || !message.trim()) return null;
  const parsedTimestamp = Number(timestamp);
  return {
    message: message.trim(),
    timestamp: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : 0,
  };
}

/** Validate an unknown payload as the v1 store; anything else is empty. */
export function parseRecentMessageStore(value: unknown): RecentCommitMessageStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: RecentCommitMessageStore = {};
  for (const [key, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const parsed = entries
      .map(parseEntry)
      .filter((entry): entry is RecentCommitMessageEntry => entry !== null);
    if (parsed.length > 0) {
      result[key] = parsed.toSorted((a, b) => b.timestamp - a.timestamp).slice(0, MAX_RECENT_MESSAGES_PER_WC);
    }
  }
  return result;
}

/** Dedupe by trimmed message (keeping the newest timestamp) and cap at N=20. */
export function trimRecentMessages(
  entries: RecentCommitMessageEntry[]
): RecentCommitMessageEntry[] {
  const byMessage = new Map<string, RecentCommitMessageEntry>();
  for (const entry of entries) {
    const key = entry.message.trim();
    if (!key) continue;
    const existing = byMessage.get(key);
    if (!existing || existing.timestamp < entry.timestamp) byMessage.set(key, entry);
  }
  return [...byMessage.values()]
    .toSorted((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_RECENT_MESSAGES_PER_WC);
}

/** Evict least-recently-used working copies beyond the tracking cap. */
export function pruneWorkingCopies(store: RecentCommitMessageStore): RecentCommitMessageStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_TRACKED_WORKING_COPIES) return store;

  const lastUsed = (key: string): number => {
    const entries = store[key] ?? [];
    return entries.reduce((max, entry) => Math.max(max, entry.timestamp), 0);
  };

  const kept = keys
    .toSorted((a, b) => lastUsed(b) - lastUsed(a))
    .slice(0, MAX_TRACKED_WORKING_COPIES);
  return Object.fromEntries(kept.map((key) => [key, store[key]]));
}

/** Pure insertion used by the hook and the tests. */
export function addRecentMessageToStore(
  store: RecentCommitMessageStore,
  workingCopyPath: string,
  message: string,
  now = Date.now()
): RecentCommitMessageStore {
  const trimmed = message.trim();
  if (!trimmed) return store;
  const key = normalizeWorkingCopyKey(workingCopyPath);
  if (!key) return store;

  const next: RecentCommitMessageStore = {
    ...store,
    [key]: trimRecentMessages([{ message: trimmed, timestamp: now }, ...(store[key] ?? [])]),
  };
  return pruneWorkingCopies(next);
}

/** Load the recall list for one working copy; storage failures degrade to []. */
export async function loadRecentMessages(
  workingCopyPath: string
): Promise<RecentCommitMessageEntry[]> {
  try {
    const stored = await window.api?.store?.get<unknown>(RECENT_COMMIT_MESSAGES_KEY);
    return trimRecentMessages(parseRecentMessageStore(stored)[normalizeWorkingCopyKey(workingCopyPath)] ?? []);
  } catch {
    return [];
  }
}

/** Persist the whole store; callers surface failures. */
export async function saveRecentMessageStore(store: RecentCommitMessageStore): Promise<void> {
  await window.api?.store?.set(RECENT_COMMIT_MESSAGES_KEY, store);
}
