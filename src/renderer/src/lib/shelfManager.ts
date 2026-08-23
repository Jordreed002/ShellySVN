/**
 * Shelf manager support library (#64).
 *
 * Persistence for the user's expiry-nudge preference plus pure age/staleness
 * helpers, kept out of the component for testing. The shelf list itself comes
 * from the existing `svn:shelve:list` IPC; rename / diff / portable
 * import-export have no backend channels yet (see the coordination notes in
 * `ShelfManagerDialog`).
 */

export const SHELF_MANAGER_CONFIG_KEY = 'shellysvn:shelf-manager:v1';

export interface ShelfManagerConfig {
  /** Age in days after which shelves get an expiry nudge; null disables it. */
  maxAgeDays: number | null;
}

export const DEFAULT_SHELF_MANAGER_CONFIG: ShelfManagerConfig = { maxAgeDays: 30 };

/** Validate an unknown stored payload; falls back to defaults. */
export function parseShelfManagerConfig(value: unknown): ShelfManagerConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SHELF_MANAGER_CONFIG };
  const { maxAgeDays } = value as Record<string, unknown>;
  if (maxAgeDays === null) return { maxAgeDays: null };
  if (typeof maxAgeDays === 'number' && Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    return { maxAgeDays: Math.floor(maxAgeDays) };
  }
  return { ...DEFAULT_SHELF_MANAGER_CONFIG };
}

export async function loadShelfManagerConfig(): Promise<ShelfManagerConfig> {
  try {
    return parseShelfManagerConfig(
      await window.api?.store?.get<unknown>(SHELF_MANAGER_CONFIG_KEY)
    );
  } catch {
    return { ...DEFAULT_SHELF_MANAGER_CONFIG };
  }
}

export async function saveShelfManagerConfig(config: ShelfManagerConfig): Promise<void> {
  await window.api?.store?.set(SHELF_MANAGER_CONFIG_KEY, config);
}

/** Whole days between now and the shelf's creation date (negative if future). */
export function shelfAgeDays(date: string, now: number | Date = Date.now()): number {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return 0;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return Math.floor((nowMs - parsed) / 86_400_000);
}

/** Whether a shelf is older than the configured maximum age. */
export function isShelfStale(
  date: string,
  maxAgeDays: number | null,
  now: number | Date = Date.now()
): boolean {
  if (maxAgeDays === null || maxAgeDays <= 0) return false;
  return shelfAgeDays(date, now) >= maxAgeDays;
}

/** Compact human age: "3 days", "2 weeks", "5 months" (rounded down). */
export function formatShelfAge(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  if (days < 730) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}
