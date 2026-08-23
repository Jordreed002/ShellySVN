import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PROPERTY_SEED,
  PROPERTY_SEED_ENV_VAR,
  Rng,
  forAll,
  genArray,
  genAsciiString,
  genBoolean,
  genConstant,
  genInt,
  genMap,
  genOneOf,
  genOptional,
  genPick,
  genRecord,
  genUnicodeString,
  genWeighted,
  resolvePropertySeed,
  sample,
} from '../propertyCheck';

const HIGH_SURROGATE_START = '\ud800';
const HIGH_SURROGATE_END = '\udfff';

/** A string is well-formed when it contains no unpaired surrogate half. */
function isWellFormed(text: string): boolean {
  return Array.from(text).every(
    (char) => !(char.length === 1 && char >= HIGH_SURROGATE_START && char <= HIGH_SURROGATE_END)
  );
}

describe('propertyCheck harness', () => {
  const originalSeedEnv = process.env[PROPERTY_SEED_ENV_VAR];

  afterEach(() => {
    if (originalSeedEnv === undefined) {
      delete process.env[PROPERTY_SEED_ENV_VAR];
    } else {
      process.env[PROPERTY_SEED_ENV_VAR] = originalSeedEnv;
    }
  });

  describe('seed resolution', () => {
    it('uses the fixed default seed when the env var is unset', () => {
      delete process.env[PROPERTY_SEED_ENV_VAR];
      expect(resolvePropertySeed()).toBe(DEFAULT_PROPERTY_SEED);
    });

    it('accepts an integer override via the env var', () => {
      process.env[PROPERTY_SEED_ENV_VAR] = '12345';
      expect(resolvePropertySeed()).toBe(12345);
    });

    it('falls back to the default seed for garbage env values', () => {
      process.env[PROPERTY_SEED_ENV_VAR] = 'not-a-number';
      expect(resolvePropertySeed()).toBe(DEFAULT_PROPERTY_SEED);
    });
  });

  describe('Rng (mulberry32)', () => {
    it('produces identical streams for identical seeds', () => {
      const a = new Rng(42);
      const b = new Rng(42);
      const left = Array.from({ length: 16 }, () => a.next());
      const right = Array.from({ length: 16 }, () => b.next());
      expect(left).toEqual(right);
    });

    it('produces different streams for different seeds', () => {
      const a = Array.from({ length: 16 }, () => new Rng(1).next());
      const b = Array.from({ length: 16 }, () => new Rng(2).next());
      expect(a).not.toEqual(b);
    });

    it('next() stays within [0, 1) and int() within its bounds', () => {
      const rng = new Rng(7);
      for (let i = 0; i < 1000; i += 1) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        const integer = rng.int(5, 9);
        expect(integer).toBeGreaterThanOrEqual(5);
        expect(integer).toBeLessThanOrEqual(9);
      }
    });

    it('int() with reversed bounds still returns in-range values', () => {
      const rng = new Rng(9);
      for (let i = 0; i < 100; i += 1) {
        const value = rng.int(9, 3);
        expect(value).toBeGreaterThanOrEqual(3);
        expect(value).toBeLessThanOrEqual(9);
      }
    });
  });

  describe('generator combinators', () => {
    it('genInt respects bounds and samples vary', () => {
      const values = sample(genInt({ min: -5, max: 5 }), { seed: 1, runs: 200 });
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(-5);
        expect(value).toBeLessThanOrEqual(5);
      }
      expect(new Set(values).size).toBeGreaterThan(1);
    });

    it('genBoolean, genPick and genWeighted only return members', () => {
      const pickGen = genPick(['a', 'b', 'c'] as const);
      const weightedGen = genWeighted([
        { value: 'x', weight: 3 },
        { value: 'y', weight: 1 },
      ]);
      for (const seed of [1, 2, 3]) {
        for (const value of sample(genBoolean(), { seed, runs: 50 })) {
          expect(typeof value).toBe('boolean');
        }
        for (const value of sample(pickGen, { seed, runs: 50 })) {
          expect(['a', 'b', 'c']).toContain(value);
        }
        for (const value of sample(weightedGen, { seed, runs: 50 })) {
          expect(['x', 'y']).toContain(value);
        }
      }
    });

    it('genOptional yields both defined and undefined', () => {
      const values = sample(genOptional(genConstant(1), 0.5), { seed: 11, runs: 100 });
      expect(values).toContain(undefined);
      expect(values).toContain(1);
    });

    it('genOneOf runs one of the given generators', () => {
      const gen = genOneOf(genConstant('left'), genConstant('right'));
      const values = sample(gen, { seed: 3, runs: 100 });
      expect(new Set(values)).toEqual(new Set(['left', 'right']));
    });

    it('genMap transforms values', () => {
      const gen = genMap(genInt({ min: 0, max: 9 }), (n) => n * 2);
      for (const value of sample(gen, { seed: 4, runs: 50 })) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(18);
      }
    });

    it('genRecord builds the declared shape with per-field generators', () => {
      const gen = genRecord({
        name: genAsciiString({ minLen: 1, maxLen: 5 }),
        count: genInt({ min: 0, max: 3 }),
        nested: genRecord({ flag: genBoolean() }),
      });
      for (const value of sample(gen, { seed: 5, runs: 50 })) {
        expect(typeof value.name).toBe('string');
        expect(value.name.length).toBeGreaterThanOrEqual(1);
        expect(value.name.length).toBeLessThanOrEqual(5);
        expect(typeof value.count).toBe('number');
        expect(typeof value.nested.flag).toBe('boolean');
        expect(Object.keys(value).toSorted()).toEqual(['count', 'name', 'nested']);
      }
    });

    it('genArray respects length bounds and element generator', () => {
      const gen = genArray(genInt({ min: 10, max: 20 }), { min: 2, max: 6 });
      for (const value of sample(gen, { seed: 6, runs: 60 })) {
        expect(value.length).toBeGreaterThanOrEqual(2);
        expect(value.length).toBeLessThanOrEqual(6);
        for (const element of value) {
          expect(element).toBeGreaterThanOrEqual(10);
          expect(element).toBeLessThanOrEqual(20);
        }
      }
    });

    it('genArray default max length grows with size and never exceeds it', () => {
      for (const size of [1, 10, 200]) {
        const gen = genArray(genConstant(0));
        for (const value of sample(gen, { seed: 8, runs: 40, size })) {
          expect(value.length).toBeLessThanOrEqual(Math.max(1, size));
        }
      }
    });

    it('genAsciiString respects length bounds and alphabet', () => {
      const alphabet = 'ab.';
      const gen = genAsciiString({ minLen: 3, maxLen: 12, chars: alphabet });
      for (const value of sample(gen, { seed: 9, runs: 60 })) {
        expect(value.length).toBeGreaterThanOrEqual(3);
        expect(value.length).toBeLessThanOrEqual(12);
        for (const char of value) {
          expect(alphabet).toContain(char);
        }
      }
    });

    it('genUnicodeString yields well-formed strings within length bounds', () => {
      const gen = genUnicodeString({ minLen: 2, maxLen: 30 });
      const values = sample(gen, { seed: 10, runs: 100 });
      for (const value of values) {
        expect(Array.from(value).length).toBeGreaterThanOrEqual(2);
        expect(Array.from(value).length).toBeLessThanOrEqual(30);
        expect(isWellFormed(value)).toBe(true);
      }
      // Unicode variety actually shows up (not just ASCII).
      const joined = values.join('');
      expect(/\P{ASCII}/u.test(joined)).toBe(true);
    });

    it('sampling is deterministic for a fixed seed and differs across seeds', () => {
      const gen = genRecord({
        a: genInt({ min: 0, max: 1_000_000 }),
        b: genUnicodeString({ minLen: 0, maxLen: 12 }),
        c: genArray(genInt({ min: 0, max: 999 }), { min: 0, max: 6 }),
      });
      const first = sample(gen, { seed: 77, runs: 25 });
      const again = sample(gen, { seed: 77, runs: 25 });
      const other = sample(gen, { seed: 78, runs: 25 });
      expect(first).toEqual(again);
      expect(first).not.toEqual(other);
    });
  });

  describe('forAll', () => {
    it('passes (returns without throwing) for a true predicate', () => {
      expect(() =>
        forAll(genInt({ min: 0, max: 100 }), (n) => n >= 0 && n <= 100, {
          seed: 1,
          runs: 200,
        })
      ).not.toThrow();
    });

    it('treats a thrown predicate as a failing run and reports the error', () => {
      expect(() =>
        forAll(
          genInt({ min: 0, max: 9 }),
          (n) => {
            if (n > 5) throw new Error(`boom on ${n}`);
            return true;
          },
          { seed: 2, runs: 50 }
        )
      ).toThrow(/boom on/);
    });

    it('fails with seed, run and counterexample in the message', () => {
      let caught: Error | undefined;
      try {
        forAll(genInt({ min: 0, max: 100 }), () => false, { seed: 3, runs: 5 });
      } catch (error) {
        caught = error as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toContain('seed=3');
      expect(caught?.message).toContain('run=0');
      expect(caught?.message).toContain('Counterexample:');
    });

    it('shrinks a failing integer counterexample to the minimal failing value', () => {
      // Fails exactly when n >= 751; shrinking must walk down to 751.
      let caught: Error | undefined;
      try {
        forAll(genInt({ min: 750, max: 800 }), (n) => n < 751, { seed: 4, runs: 40 });
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toContain('Shrunk:         751');
    });

    it('shrinks a failing string counterexample to minimal length', () => {
      // Fails when the string has 4+ characters; alphabet of two letters means
      // the shrunk case is any 4-letter string.
      let caught: Error | undefined;
      try {
        forAll(
          genAsciiString({ minLen: 4, maxLen: 24, chars: 'ab' }),
          (s) => s.length < 4,
          { seed: 5, runs: 40 }
        );
      } catch (error) {
        caught = error as Error;
      }
      const shrunkLine = caught?.message.split('\n').find((line) => line.startsWith('Shrunk:'));
      const shrunk = shrunkLine?.slice('Shrunk:'.length).trim().replace(/^"|"$/g, '');
      expect(shrunk?.length).toBe(4);
    });

    it('shrinks arrays toward fewer elements', () => {
      let caught: Error | undefined;
      try {
        forAll(genArray(genConstant(1), { min: 2, max: 12 }), (arr) => arr.length < 3, {
          seed: 6,
          runs: 40,
        });
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toContain('Shrunk:         [1,1,1]');
    });

    it('honors an explicit seed over the env var', () => {
      process.env[PROPERTY_SEED_ENV_VAR] = '999';
      const valuesA = sample(genInt({ min: 0, max: 1_000_000 }), { seed: 42, runs: 10 });
      const valuesB = sample(genInt({ min: 0, max: 1_000_000 }), { seed: 42, runs: 10 });
      const envSeeded = sample(genInt({ min: 0, max: 1_000_000 }), { runs: 10 });
      expect(valuesA).toEqual(valuesB);
      expect(envSeeded).not.toEqual(valuesA);
      expect(resolvePropertySeed()).toBe(999);
    });
  });
});
