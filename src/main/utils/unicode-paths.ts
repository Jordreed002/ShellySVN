/**
 * Unicode normalization (NFC/NFD) and case-collision detection for paths.
 *
 * macOS disks commonly store filenames decomposed (NFD — HFS+ normalizes on
 * write, APFS preserves whatever an app hands it) while Subversion
 * repositories conventionally store composed (NFC) text, and working copies
 * created on Linux arrive NFC. The byte difference makes otherwise identical
 * names compare unequal, surfacing as phantom "missing" or "unversioned"
 * statuses. Separately, on case-insensitive filesystems (the macOS and Windows
 * defaults) two versioned entries that differ only by case cannot both exist
 * on disk.
 *
 * Everything in this module is detection-only and pure: nothing renames or
 * "fixes" a path, and no helper performs I/O.
 */

// The UnicodeForm / NormalizationMismatch / CaseCollisionPair /
// UnicodePathWarnings shapes live in @shared/types (they cross IPC on status
// results); they are re-exported here so existing main-process imports keep
// working.
export type {
  CaseCollisionPair,
  NormalizationMismatch,
  UnicodeForm,
  UnicodePathWarnings,
} from '@shared/types';
import type {
  CaseCollisionPair,
  NormalizationMismatch,
  UnicodeForm,
} from '@shared/types';

/** Upper bound on emitted collision pairs so pathological inputs cannot bloat payloads. */
const MAX_CASE_COLLISION_PAIRS = 500;

/** Fast pre-filter: strings without non-ASCII code points cannot differ by normalization form. */
const NON_ASCII_PATTERN = /[^\x00-\x7f]/;

export function isNfcNormalized(path: string): boolean {
  return path === path.normalize('NFC');
}

/** Canonical comparison key for normalization-sensitive path comparison: the NFC form. */
export function normalizePathForComparison(path: string): string {
  return path.normalize('NFC');
}

/**
 * Best-effort form classification. Every string that equals its NFC form
 * counts as NFC (pure ASCII is trivially NFC); otherwise a string that equals
 * its NFD form is NFD, and anything else mixes forms ("mixed").
 */
export function detectUnicodeForm(path: string): UnicodeForm {
  if (isNfcNormalized(path)) return 'NFC';
  return path === path.normalize('NFD') ? 'NFD' : 'mixed';
}

/**
 * Cheap pre-filter for callers scanning large entry sets: only strings
 * containing non-ASCII code points can differ between NFC and NFD (or carry
 * combining marks), so pure-ASCII inputs can skip all normalization work.
 */
export function mayDifferByUnicodeNormalization(path: string): boolean {
  return NON_ASCII_PATTERN.test(path);
}

/**
 * Detects that `expected` and `onDisk` name the same text but differ by
 * Unicode normalization form (canonically equivalent, not byte-identical).
 * Returns null when the strings are identical, genuinely different, or both
 * pure ASCII.
 */
export function detectNormalizationMismatch(
  expected: string,
  onDisk: string
): NormalizationMismatch | null {
  if (expected === onDisk) return null;
  if (!mayDifferByUnicodeNormalization(expected) && !mayDifferByUnicodeNormalization(onDisk)) {
    return null;
  }
  if (normalizePathForComparison(expected) !== normalizePathForComparison(onDisk)) return null;
  return {
    expected,
    onDisk,
    expectedForm: detectUnicodeForm(expected),
    onDiskForm: detectUnicodeForm(onDisk),
  };
}

/**
 * Case-folding key for collision detection.
 *
 * Choice of fold: `toLowerCase()` with no locale argument applies the Unicode
 * Default Case Conversion — locale-insensitive (no Turkic dotless-i), which is
 * what case-insensitive filesystems approximate. Full Unicode case folding
 * (NFKC_Casefold / "scfold") is not exposed by JavaScript, so `toLowerCase()`
 * serves as the cheap, allocation-light approximation and errs toward
 * reporting a collision. Separators are unified ('\' → '/') and trailing
 * separators are stripped so Windows-style spellings of the same path fold
 * identically. NFC is deliberately NOT applied first: names differing only by
 * normalization form belong to the normalization detector above, not to case
 * collisions.
 */
export function foldPathForCaseComparison(path: string): string {
  let folded = path;
  if (folded.includes('\\')) folded = folded.replace(/\\/g, '/');
  if (folded.length > 1 && folded.endsWith('/')) folded = folded.replace(/\/+$/, '');
  return folded.toLowerCase();
}

/**
 * Single pass over a case-folded map: returns every pair of paths that differ
 * exactly but collide under case-insensitive comparison — i.e. pairs that
 * cannot coexist on macOS/Windows filesystems. Identical paths never pair,
 * and a folded key holding k distinct spellings yields k*(k-1)/2 pairs,
 * capped at {@link MAX_CASE_COLLISION_PAIRS}. Pure: callers gate on platform.
 */
export function detectCaseCollisions(paths: Iterable<string>): CaseCollisionPair[] {
  const variantsByFoldedPath = new Map<string, string[]>();
  let keysWithVariants = 0;

  for (const path of paths) {
    if (!path) continue;
    const folded = foldPathForCaseComparison(path);
    const variants = variantsByFoldedPath.get(folded);
    if (!variants) {
      variantsByFoldedPath.set(folded, [path]);
      continue;
    }
    if (!variants.includes(path)) {
      variants.push(path);
      keysWithVariants += 1;
    }
  }

  if (keysWithVariants === 0) return [];

  const pairs: CaseCollisionPair[] = [];
  for (const variants of variantsByFoldedPath.values()) {
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) {
        pairs.push({ pathA: variants[i], pathB: variants[j] });
        if (pairs.length >= MAX_CASE_COLLISION_PAIRS) return pairs;
      }
    }
  }
  return pairs;
}
