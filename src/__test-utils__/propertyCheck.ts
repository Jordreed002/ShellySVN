/**
 * Tiny seeded property-testing harness (item #130).
 *
 * `fast-check` cannot be added (package.json is frozen), so this implements
 * the small subset the test-suite needs, with no dependencies and no
 * `Math.random` anywhere: every value is derived from an integer seed.
 *
 * - Deterministic PRNG: mulberry32 (`Rng`).
 * - Generator combinators: `genInt`, `genBoolean`, `genConstant`, `genPick`,
 *   `genWeighted`, `genOneOf`, `genMap`, `genOptional`, `genRecord`,
 *   `genArray`, `genAsciiString`, `genUnicodeString`. Lengths and array sizes
 *   are bounded by a `size` parameter (default 20, capped at 200) so nested
 *   generators cannot blow up.
 * - `forAll(generator, predicate, options)`: runs the predicate on `runs`
 *   generated values. On failure (or predicate throw) it best-effort shrinks
 *   the counterexample (halve strings/arrays, drop elements/keys, walk
 *   numbers toward small values — one candidate accepted per round, bounded
 *   rounds) and throws an `Error` carrying the original and shrunk
 *   counterexamples plus the seed/run needed to reproduce.
 * - Default seed is fixed for CI stability; override for one debug run with
 *   the `SHELLYSVN_PROPERTY_SEED` env var or the `seed` option.
 *
 * Importable from both `src/**` and `packages/**` tests via the `@test-utils`
 * vitest alias (see vitest.config.ts).
 */

/** Env var that overrides the default property seed for local debugging. */
export const PROPERTY_SEED_ENV_VAR = 'SHELLYSVN_PROPERTY_SEED';

/** Fixed default seed so CI runs are byte-for-byte reproducible. */
export const DEFAULT_PROPERTY_SEED = 20260823;

/** Upper bound for the `size` hint passed to generators. */
export const MAX_SIZE = 200;

export function resolvePropertySeed(): number {
  const raw = process.env[PROPERTY_SEED_ENV_VAR];
  if (raw === undefined) return DEFAULT_PROPERTY_SEED;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PROPERTY_SEED;
}

/* ─────────────────────────────── PRNG ─────────────────────────────── */

/** Seeded mulberry32 PRNG. Deterministic for a given seed. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalize to uint32; never allow the all-zero state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Random integer, both bounds inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Random boolean, true with `probability` (default 1/2). */
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Element picked by non-negative weights. */
  weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T {
    if (entries.length === 0) throw new Error('Rng.weighted: empty entries');
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) return entries[0].value;
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= Math.max(0, entry.weight);
      if (roll < 0) return entry.value;
    }
    return entries[entries.length - 1].value;
  }

  /** Shuffled copy (Fisher-Yates); the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }
}

/** Decorrelate per-run streams inside one `forAll` invocation. */
function runSeed(seed: number, run: number): number {
  return (seed + Math.imul(run + 1, 0x9e3779b9)) >>> 0;
}

/* ───────────────────────────── generators ───────────────────────────── */

export type Generator<T> = (rng: Rng, size: number) => T;

const clampSize = (size: number): number => Math.max(1, Math.min(MAX_SIZE, Math.floor(size) || 1));

/** Always yields the same value. */
export function genConstant<T>(value: T): Generator<T> {
  return () => value;
}

/** Random integer in `[min, max]` (defaults 0..1000), independent of `size`. */
export function genInt(options?: { min?: number; max?: number }): Generator<number> {
  const min = options?.min ?? 0;
  const max = options?.max ?? 1000;
  return (rng) => rng.int(min, max);
}

/** Random boolean. */
export function genBoolean(): Generator<boolean> {
  return (rng) => rng.bool();
}

/** Uniform choice among literal values. */
export function genPick<T>(values: readonly T[]): Generator<T> {
  return (rng) => rng.pick(values);
}

/** Weighted choice among literal values. */
export function genWeighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): Generator<T> {
  return (rng) => rng.weighted(entries);
}

/** Uniform choice among generators (runs the chosen one). */
export function genOneOf<T>(...generators: ReadonlyArray<Generator<T>>): Generator<T> {
  return (rng, size) => rng.pick(generators)(rng, size);
}

/** Transform generated values. */
export function genMap<T, U>(generator: Generator<T>, transform: (value: T) => U): Generator<U> {
  return (rng, size) => transform(generator(rng, size));
}

/** `undefined` with `probability`, otherwise the inner generator's value. */
export function genOptional<T>(
  generator: Generator<T>,
  probability = 0.25
): Generator<T | undefined> {
  return (rng, size) => (rng.bool(probability) ? undefined : generator(rng, size));
}

/** Fixed-shape record of independent generators. */
export function genRecord<S extends Record<string, Generator<unknown>>>(
  spec: S
): Generator<{ [K in keyof S]: S[K] extends Generator<infer V> ? V : never }> {
  return (rng, size) => {
    const result: Record<string, unknown> = {};
    for (const [key, generator] of Object.entries(spec)) {
      result[key] = generator(rng, size);
    }
    return result as { [K in keyof S]: S[K] extends Generator<infer V> ? V : never };
  };
}

/** Array of generated values; length bounded by `[min, max ?? min + size]`. */
export function genArray<T>(
  generator: Generator<T>,
  options?: { min?: number; max?: number }
): Generator<T[]> {
  const min = options?.min ?? 0;
  return (rng, size) => {
    const max = options?.max ?? min + clampSize(size);
    const length = rng.int(min, Math.max(min, max));
    const items: T[] = [];
    for (let i = 0; i < length; i += 1) {
      items.push(generator(rng, Math.max(1, Math.floor(clampSize(size) / 2))));
    }
    return items;
  };
}

/** String over a custom alphabet (no newline unless included in `chars`). */
export function genAsciiString(options?: {
  minLen?: number;
  maxLen?: number;
  chars?: string;
}): Generator<string> {
  const minLen = options?.minLen ?? 0;
  const chars =
    options?.chars ??
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./ ';
  return (rng, size) => {
    const maxLen = options?.maxLen ?? minLen + clampSize(size);
    const length = rng.int(minLen, Math.max(minLen, maxLen));
    let result = '';
    for (let i = 0; i < length; i += 1) {
      result += chars[rng.int(0, chars.length - 1)];
    }
    return result;
  };
}

/**
 * Unicode strings composed of whole code points (never lone surrogates) drawn
 * from a friendly pool: printable ASCII, Latin-1, Latin Extended, currency and
 * punctuation symbols, Cyrillic, CJK, and emoji.
 */
const UNICODE_POOLS: ReadonlyArray<{ first: number; last: number; weight: number }> = [
  { first: 0x20, last: 0x7e, weight: 8 }, // printable ASCII
  { first: 0xa0, last: 0xff, weight: 3 }, // Latin-1 supplement
  { first: 0x100, last: 0x17f, weight: 2 }, // Latin Extended-A
  { first: 0x400, last: 0x4ff, weight: 2 }, // Cyrillic
  { first: 0x2018, last: 0x201f, weight: 1 }, // quotes
  { first: 0x20a0, last: 0x20bf, weight: 1 }, // currency symbols
  { first: 0x4e00, last: 0x4e7f, weight: 2 }, // CJK sample
  { first: 0x1f300, last: 0x1f32f, weight: 1 }, // emoji (astral)
];

export function genUnicodeString(options?: { minLen?: number; maxLen?: number }): Generator<string> {
  const minLen = options?.minLen ?? 0;
  return (rng, size) => {
    const maxLen = options?.maxLen ?? minLen + clampSize(size);
    const length = rng.int(minLen, Math.max(minLen, maxLen));
    const pool = rng.weighted(UNICODE_POOLS.map((p) => ({ value: p, weight: p.weight })));
    let result = '';
    for (let i = 0; i < length; i += 1) {
      // Mostly stay in the chosen pool, occasionally hop to another one.
      const range =
        rng.bool(0.85)
          ? pool
          : rng.weighted(UNICODE_POOLS.map((p) => ({ value: p, weight: p.weight })));
      result += String.fromCodePoint(rng.int(range.first, range.last));
    }
    return result;
  };
}

/* ────────────────────────── forAll + shrinking ────────────────────────── */

export interface ForAllOptions {
  /** Seed for this run; defaults to the resolved env/default seed. */
  seed?: number;
  /** Number of generated cases (default 100). */
  runs?: number;
  /** Size hint for generators (default 20, capped at 200). */
  size?: number;
}

/** Generate `runs` sample values (handy for debugging a generator). */
export function sample<T>(generator: Generator<T>, options?: ForAllOptions): T[] {
  const seed = options?.seed ?? resolvePropertySeed();
  const runs = options?.runs ?? 100;
  const size = options?.size ?? 20;
  const values: T[] = [];
  for (let run = 0; run < runs; run += 1) {
    values.push(generator(new Rng(runSeed(seed, run)), size));
  }
  return values;
}

/**
 * Rough "how big is this value" metric used to order shrink candidates:
 * recursive, with number magnitude and per-element/per-key overheads so that
 * e.g. 760 counts as strictly smaller than 761 and `[1,1]` than `[1,1,1]`.
 */
function complexity(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.abs(value) + 1 : Number.MAX_SAFE_INTEGER;
  }
  if (typeof value === 'string') return value.length + 1;
  if (typeof value === 'boolean') return 1;
  if (value === null || value === undefined) return 1;
  if (Array.isArray(value)) {
    return 2 + value.reduce((sum, item) => sum + 1 + complexity(item), 0);
  }
  if (isPlainObject(value)) {
    return 2 + Object.entries(value).reduce((sum, [key, inner]) => sum + 2 + key.length + complexity(inner), 0);
  }
  return String(value).length + 1;
}

function tryStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Best-effort smaller neighbors of a value. Structural only (JSON-shaped
 * data): strings/arrays get halves and trimmed ends, objects get one key
 * shrunk or dropped at a time, numbers walk toward small values. The
 * predicate decides which candidate actually still fails.
 */
function shrinkCandidates(value: unknown): unknown[] {
  if (typeof value === 'string') {
    const half = Math.floor(value.length / 2);
    return unique([
      value.slice(0, half),
      value.slice(value.length - half),
      value.slice(1),
      value.slice(0, -1),
      '',
    ]).filter((candidate) => candidate !== value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return [];
    const candidates = [0, Math.trunc(value / 2)];
    if (Number.isInteger(value)) {
      candidates.push(value > 0 ? value - 1 : value + 1);
    } else {
      candidates.push(Math.round(value));
    }
    return unique(candidates).filter((candidate) => candidate !== value);
  }
  if (Array.isArray(value)) {
    const half = Math.floor(value.length / 2);
    const candidates: unknown[][] = [
      value.slice(0, half),
      value.slice(value.length - half),
      value.slice(1),
      value.slice(0, -1),
    ];
    // Drop one element at a time (bounded, largest indexes first — usually
    // the "most recently appended" decorations).
    for (let i = Math.min(value.length, 8) - 1; i >= 0; i -= 1) {
      candidates.push([...value.slice(0, i), ...value.slice(i + 1)]);
    }
    return unique(candidates).filter((candidate) => candidate !== value);
  }
  if (isPlainObject(value)) {
    const candidates: Array<Record<string, unknown>> = [];
    for (const [key, inner] of Object.entries(value)) {
      for (const shrunkInner of shrinkCandidates(inner)) {
        candidates.push({ ...value, [key]: shrunkInner });
      }
      const withoutKey = { ...value };
      delete withoutKey[key];
      candidates.push(withoutKey);
    }
    return unique(candidates).filter((candidate) => candidate !== value);
  }
  if (typeof value === 'boolean') return [!value];
  return [];
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = tryStringify(value) ?? String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Run `predicate` against `runs` generated values. Throws an `Error` whose
 * message contains the original counterexample, the shrunk counterexample
 * and the seed/run needed to reproduce — vitest renders it as the assertion
 * failure. A predicate that throws counts as a failing run.
 *
 * Convention for predicates (important for shrinking): generated values come
 * from a constrained domain, but shrink candidates are structurally smaller
 * and may leave it (empty strings, dropped keys, …). Guard the domain first
 * and `return true` for out-of-domain candidates — never `expect`/throw for
 * them — otherwise the shrinker happily "minimizes" into the degenerate case
 * you excluded on purpose.
 */
export function forAll<T>(
  generator: Generator<T>,
  predicate: (value: T) => boolean,
  options?: ForAllOptions
): void {
  const seed = options?.seed ?? resolvePropertySeed();
  const runs = options?.runs ?? 100;
  const size = options?.size ?? 20;

  const passes = (value: T): boolean => {
    try {
      return predicate(value) === true;
    } catch {
      return false;
    }
  };

  for (let run = 0; run < runs; run += 1) {
    const value = generator(new Rng(runSeed(seed, run)), size);
    if (passes(value)) continue;

    // Best-effort one-pass shrink: repeatedly accept the first strictly
    // smaller candidate that still fails, for at most 200 rounds.
    let shrunk = value;
    for (let round = 0; round < 200; round += 1) {
      const baseComplexity = complexity(shrunk);
      let improved = false;
      for (const candidate of shrinkCandidates(shrunk)) {
        if (complexity(candidate) >= baseComplexity) continue;
        if (!passes(candidate as T)) {
          shrunk = candidate as T;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }

    let predicateError = '';
    try {
      predicate(value);
    } catch (error) {
      predicateError = `\nPredicate threw: ${error instanceof Error ? error.message : String(error)}`;
    }

    throw new Error(
      [
        `Property failed after ${run + 1} of ${runs} runs (seed=${seed}, run=${run}, size=${size})`,
        `Counterexample: ${tryStringify(value) ?? String(value)}`,
        `Shrunk:         ${tryStringify(shrunk) ?? String(shrunk)}`,
        `Reproduce with: forAll(gen, pred, { seed: ${seed}, runs: ${run + 1} })`,
      ].join('\n') + predicateError
    );
  }
}
