/**
 * Pseudo-localization (#134): bracket-wrapping, ~30% padding, vowel accents,
 * placeholder preservation, seeded determinism, and the exact round trip
 * through `depseudoLocalize` — swept over every string in the real `en`
 * catalog so the layout-stress locale is provably lossless.
 */

import { describe, expect, it } from 'vitest';
import { PSEUDO_LOCALE, depseudoLocalize, pseudoLocalize, pseudoLocaleCatalog } from '../pseudo';
import { registerCatalog, translate } from '../index';
import { flattenCatalog } from '../types';
import { en } from '../locales/en';

const EN_MESSAGES = Object.entries(flattenCatalog(en));

describe('pseudoLocalize', () => {
  it('bracket-wraps and pads every word', () => {
    const out = pseudoLocalize('Commit to keep');
    expect(out.startsWith('[')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    // Word structure survives: same word count, no padding inside whitespace.
    expect(out.trim().split(/\s+/)).toHaveLength(3);
    // Each word grew by at least one padding character.
    for (const word of out.slice(1, -1).split(/\s+/)) {
      expect(word.length).toBeGreaterThan(0);
      expect(word).toMatch(/¤/);
    }
  });

  it('round-trips exactly through depseudoLocalize', () => {
    const samples = [
      'Hello world',
      'What the status colors mean',
      'Versioned, unmodified, and in step with BASE — nothing to do.',
      'Resolve (pick a side or merge by hand), then Commit.',
      'trailing punctuation, stays; last! really?',
      'UPPER and MiXeD CaSe vowels',
      'a',
      ' ',
      '',
    ];
    for (const text of samples) {
      expect(depseudoLocalize(pseudoLocalize(text))).toBe(text);
    }
  });

  it('round-trips every string in the en catalog (growth included)', () => {
    expect(EN_MESSAGES.length).toBeGreaterThanOrEqual(28);
    for (const [key, message] of EN_MESSAGES) {
      const pseudo = pseudoLocalize(message);
      expect(depseudoLocalize(pseudo), key).toBe(message);
      expect(pseudo.length, key).toBeGreaterThan(message.length);
      // Placeholders are parametrized message syntax; they must survive verbatim.
      expect(pseudo).not.toMatch(/\{[^}]*¤/);
    }
  });

  it('preserves {placeholder} tokens untouched', () => {
    const out = pseudoLocalize('{name} has {count} new files');
    expect(out).toContain('{name}');
    expect(out).toContain('{count}');
    expect(depseudoLocalize(out)).toBe('{name} has {count} new files');
  });

  it('stresses layout: strings grow ~30% on average, more with higher expansion', () => {
    const totalEn = EN_MESSAGES.reduce((sum, [, s]) => sum + s.length, 0);
    const totalPseudo = EN_MESSAGES.reduce((sum, [, s]) => sum + pseudoLocalize(s).length, 0);
    const ratio = totalPseudo / totalEn;
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.6);

    // expansion 1 ⇒ growth ∈ [0.5, 1.5] × length ⇒ a 20-char word gains ≥ 10 pads.
    const expanded = pseudoLocalize('internationalization', { expansion: 1 });
    expect(expanded.length).toBeGreaterThanOrEqual(20 + 10 + 2); // word + pads + brackets
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const a = pseudoLocalize('Changed locally against BASE', { seed: 7 });
    const b = pseudoLocalize('Changed locally against BASE', { seed: 7 });
    const c = pseudoLocalize('Changed locally against BASE', { seed: 8 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // Default seed is stable across calls.
    expect(pseudoLocalize('Diff to review')).toBe(pseudoLocalize('Diff to review'));
  });

  it('can disable accents to isolate pure layout stress', () => {
    const out = pseudoLocalize('plain ascii words', { accents: false });
    expect(out).toMatch(/^\[plain¤+ ascii¤+ words¤+\]$/);
  });
});

describe('pseudoLocaleCatalog', () => {
  it('derives a complete pseudo catalog from en: same keys, every string transformed', () => {
    const pseudo = pseudoLocaleCatalog(en);
    expect(Object.keys(pseudo).toSorted()).toEqual(Object.keys(flattenCatalog(en)).toSorted());
    for (const [key, message] of EN_MESSAGES) {
      expect(pseudo[key], key).toMatch(/^\[.*\]$/);
      expect(pseudo[key].length, key).toBeGreaterThan(message.length);
    }
  });

  it('registers as a working locale that every t() consumer can switch to', () => {
    registerCatalog(PSEUDO_LOCALE, pseudoLocaleCatalog(en));
    const title = translate('statusLegend.title', undefined, PSEUDO_LOCALE);
    expect(title).toMatch(/^\[/);
    expect(depseudoLocalize(title)).toBe('What the status colors mean');
  });
});
