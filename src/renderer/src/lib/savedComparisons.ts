/**
 * Persistence for the diff wizard's saved comparisons (#49).
 *
 * Same pattern as `lib/shortcutStore.ts`: a versioned key on the
 * `window.api.store` bridge, strict validation of whatever comes back (storage
 * is untyped at rest), and graceful degradation to an empty list.
 */

export const SAVED_COMPARISONS_KEY = 'shellysvn:saved-diff-comparisons:v1';

/** One side of a saved comparison. */
export interface DiffComparisonSide {
  /** `working-copy` resolves a checkout path to its repository URL; `url` is used verbatim. */
  kind: 'working-copy' | 'url';
  /** Checkout path or repository URL, as typed. */
  target: string;
  /** SVN revision spec: `HEAD`, `BASE` (working copy only), or a number. */
  revision: string;
}

export interface SavedDiffComparison {
  id: string;
  name: string;
  left: DiffComparisonSide;
  right: DiffComparisonSide;
  createdAt: string;
}

export function isDiffComparisonSide(value: unknown): value is DiffComparisonSide {
  if (!value || typeof value !== 'object') return false;
  const { kind, target, revision } = value as Record<string, unknown>;
  return (
    (kind === 'working-copy' || kind === 'url') &&
    typeof target === 'string' &&
    target.length > 0 &&
    typeof revision === 'string' &&
    revision.length > 0
  );
}

/** Validate an unknown payload as the saved list; malformed entries are dropped. */
export function parseSavedComparisons(value: unknown): SavedDiffComparison[] {
  if (!Array.isArray(value)) return [];
  const result: SavedDiffComparison[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, left, right, createdAt } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (!isDiffComparisonSide(left) || !isDiffComparisonSide(right)) continue;
    result.push({
      id,
      name,
      left,
      right,
      createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
    });
  }
  return result;
}

export async function loadSavedComparisons(): Promise<SavedDiffComparison[]> {
  try {
    const stored = await window.api?.store?.get<unknown>(SAVED_COMPARISONS_KEY);
    return parseSavedComparisons(stored);
  } catch {
    return [];
  }
}

export async function saveSavedComparisons(comparisons: SavedDiffComparison[]): Promise<void> {
  await window.api?.store?.set(SAVED_COMPARISONS_KEY, comparisons);
}

/** Stable-enough id without pulling in a uuid dependency. */
export function newComparisonId(): string {
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
