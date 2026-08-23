/**
 * Pseudo-localization (#134): the layout-stress test locale.
 *
 * `pseudoLocalize` rewrites message text the way pseudo-locales conventionally
 * do — bracket-wrapped, vowel-accented, and padded ~30% longer — so English UI
 * developed under `en` can be reviewed for truncation, overflow, and hard-coded
 * strings before any real translation exists. `pseudoLocaleCatalog` derives a
 * complete `'pseudo'` catalog from the `en` catalog.
 *
 * The transform is deterministic for a given seed (default 134) and exactly
 * invertible by `depseudoLocalize`, which the tests exploit as a round-trip
 * property. `{placeholder}` tokens are passed through untouched so parametrized
 * messages stay parametrized.
 */

import type { FlatCatalog, MessageCatalog } from './types';
import { flattenCatalog } from './types';

/** The pseudo locale's tag. Register a catalog under it to activate. */
export const PSEUDO_LOCALE = 'pseudo';

/** Distinct padding character — never produced by accenting, never in source text. */
const PAD_CHAR = '¤';

/** Trailing punctuation pads are inserted before, so sentences still end properly. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'”]+$/;

/** Accent candidates per (lowercase) vowel; every char NFD-decomposes back to ASCII. */
const ACCENTS: Record<string, string[]> = {
  a: ['á', 'à', 'â', 'ä'],
  e: ['é', 'è', 'ê', 'ë'],
  i: ['í', 'ì', 'î', 'ï'],
  o: ['ó', 'ò', 'ô', 'ö'],
  u: ['ú', 'ù', 'û', 'ü'],
};

export interface PseudoLocalizeOptions {
  /** RNG seed; same seed ⇒ same output (default 134). */
  seed?: number;
  /** Average per-word length growth from padding (0.3 ⇒ ~30% longer). */
  expansion?: number;
  /** Accent vowels (default true). Disable to isolate pure layout stress. */
  accents?: boolean;
}

/** Small deterministic PRNG (mulberry32) — no dependencies, stable across runs. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Accent one character if it is a vowel; deterministic pick from the candidates. */
function accentChar(char: string, rng: () => number): string {
  const candidates = ACCENTS[char.toLowerCase()];
  if (!candidates) return char;
  const pick = candidates[Math.floor(rng() * candidates.length)];
  return char === char.toLowerCase() ? pick : pick.toUpperCase();
}

/** Pad one word by ~`expansion` × its length, keeping trailing punctuation last. */
function padWord(word: string, expansion: number, rng: () => number): string {
  const punctMatch = word.match(TRAILING_PUNCTUATION);
  const punct = punctMatch ? punctMatch[0] : '';
  const stem = punct ? word.slice(0, word.length - punct.length) : word;
  if (!stem) return word;
  // Jitter ±50% around the target so padding is not uniformly mechanical.
  const growth = expansion * (0.5 + rng());
  const pads = Math.max(1, Math.round(stem.length * growth));
  return stem + PAD_CHAR.repeat(pads) + punct;
}

/** Transform one whitespace-delimited word: accents + padding. */
function pseudoWord(word: string, options: Required<PseudoLocalizeOptions>, rng: () => number): string {
  const accented = options.accents
    ? [...word].map((char) => accentChar(char, rng)).join('')
    : word;
  return padWord(accented, options.expansion, rng);
}

/**
 * Pseudo-localize a message: `[` + accent + pad each word + `]`.
 * `{placeholder}` tokens and whitespace structure are preserved; empty/blank
 * input passes through unchanged.
 */
export function pseudoLocalize(text: string, options: PseudoLocalizeOptions = {}): string {
  const resolved: Required<PseudoLocalizeOptions> = {
    seed: options.seed ?? 134,
    expansion: options.expansion ?? 0.3,
    accents: options.accents ?? true,
  };
  if (!text.trim()) return text;

  const rng = createRng(resolved.seed);
  // Protect {placeholders} from accenting/padding; transform around them.
  const out = text.split(/(\{[^}]+\})/).map((segment) =>
    segment.startsWith('{') && segment.endsWith('}')
      ? segment
      : segment
          .split(/(\s+)/)
          .map((part) => (part.trim() ? pseudoWord(part, resolved, rng) : part))
          .join('')
  );
  return `[${out.join('')}]`;
}

/**
 * Exact inverse of `pseudoLocalize`: unwrap brackets, drop padding, and fold
 * accented characters back to ASCII via Unicode NFD. `depseudo(pseudo(s)) === s`
 * for any text that does not itself contain brackets or `¤`.
 */
export function depseudoLocalize(text: string): string {
  const unwrapped = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return unwrapped
    .split(/(\{[^}]+\})/)
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? segment
        : segment
            .split(PAD_CHAR)
            .join('')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
    )
    .join('');
}

/**
 * Derive a complete `'pseudo'` catalog from a (nested or flat) source catalog:
 * every key kept, every message transformed with the same options. Register
 * the result to stress the whole UI at once:
 *
 * ```ts
 * registerCatalog(PSEUDO_LOCALE, pseudoLocaleCatalog(en));
 * await setLocale(PSEUDO_LOCALE, { persist: false });
 * ```
 */
export function pseudoLocaleCatalog(
  catalog: MessageCatalog | FlatCatalog,
  options: PseudoLocalizeOptions = {}
): FlatCatalog {
  const flat: FlatCatalog = {};
  for (const [key, message] of Object.entries(flattenCatalog(catalog))) {
    flat[key] = pseudoLocalize(message, options);
  }
  return flat;
}
