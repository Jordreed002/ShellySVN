/**
 * Recent-usage tracking for the command palette (#77).
 *
 * The palette boosts recently executed entries, so recall of the last few
 * commands feels instant. Only ids and timestamps are persisted — no command
 * payloads — via the same `window.api.store` bridge the rest of the shell uses.
 */

const PALETTE_USAGE_KEY = 'shellysvn:palette-recent-usage';
const MAX_TRACKED = 12;

/** Parse a persisted usage payload into a validated `id -> last-used-at` map. */
export function parsePaletteUsage(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [id, timestamp] of Object.entries(value as Record<string, unknown>)) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      result[id] = timestamp;
    }
  }
  return result;
}

/** Pure update: record one execution, evicting the stalest entries past the cap. */
export function recordPaletteUsage(
  previous: Record<string, number>,
  commandId: string,
  now = Date.now()
): Record<string, number> {
  const next = { ...previous, [commandId]: now };
  const ids = Object.keys(next);
  if (ids.length <= MAX_TRACKED) return next;

  return Object.fromEntries(
    ids
      .toSorted((a, b) => next[b] - next[a])
      .slice(0, MAX_TRACKED)
      .map((id) => [id, next[id]])
  );
}

/** Load the persisted usage map; failures degrade to "no boosting". */
export async function loadPaletteUsage(): Promise<Record<string, number>> {
  try {
    const stored = await window.api?.store?.get<unknown>(PALETTE_USAGE_KEY);
    return parsePaletteUsage(stored);
  } catch {
    return {};
  }
}

/** Persist the usage map; failures are non-fatal by design. */
export async function savePaletteUsage(usage: Record<string, number>): Promise<void> {
  try {
    await window.api?.store?.set(PALETTE_USAGE_KEY, usage);
  } catch {
    // Boosting is a nicety; never surface persistence problems for it.
  }
}
