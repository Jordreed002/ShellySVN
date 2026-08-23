import { describe, expect, it } from 'vitest';
import {
  fuzzyScoreCommand,
  fuzzyScoreText,
  rankCommands,
  recentUsageBoost,
} from '../commandPaletteFuzzy';

const items = [
  { id: 'update', title: 'Update working copy', category: 'SVN', keywords: ['pull'] },
  { id: 'commit', title: 'Commit changes', category: 'SVN', keywords: ['checkin'] },
  { id: 'home', title: 'Go to Home', category: 'Navigation' },
  { id: 'log', title: 'Show log', category: 'SVN', keywords: ['history'] },
];

describe('fuzzyScoreText', () => {
  it('scores exact above prefix above substring above subsequence', () => {
    const exact = fuzzyScoreText('commit changes', 'Commit changes');
    const prefix = fuzzyScoreText('commit', 'Commit changes');
    const wordStart = fuzzyScoreText('chan', 'Commit changes');
    const substring = fuzzyScoreText('mit c', 'Commit changes');
    const subsequence = fuzzyScoreText('cmg', 'Commit changes');

    expect(exact).not.toBeNull();
    expect(prefix).not.toBeNull();
    expect(wordStart).not.toBeNull();
    expect(substring).not.toBeNull();
    expect(subsequence).not.toBeNull();

    expect(exact!).toBeGreaterThan(prefix!);
    expect(prefix!).toBeGreaterThan(wordStart!);
    expect(wordStart!).toBeGreaterThan(substring!);
    expect(substring!).toBeGreaterThan(subsequence!);
  });

  it('matches case-insensitively', () => {
    expect(fuzzyScoreText('ShOw', 'show log')).toBeGreaterThan(0);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScoreText('zzz', 'Commit changes')).toBeNull();
    expect(fuzzyScoreText('commit', '')).toBeNull();
  });

  it('caps subsequence scores below the substring tier', () => {
    // A long, dense subsequence must not outrank a late substring hit.
    const subsequence = fuzzyScoreText('cmitchange', 'Commit changes');
    const substring = fuzzyScoreText('ges', 'Commit changes');
    expect(subsequence!).toBeLessThan(substring!);
  });
});

describe('fuzzyScoreCommand', () => {
  it('prefers title matches over keyword and category matches', () => {
    const title = fuzzyScoreCommand('log', items[3]);
    const category = fuzzyScoreCommand('svn', items[3]);
    expect(title!).toBeGreaterThan(category!);
  });

  it('matches keywords and descriptions, not just titles', () => {
    expect(fuzzyScoreCommand('pull', items[0])).not.toBeNull();
    expect(fuzzyScoreCommand('history', items[3])).not.toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(fuzzyScoreCommand('zzz', items[2])).toBeNull();
  });
});

describe('recentUsageBoost', () => {
  it('boosts the most recent execution highest and older ones less', () => {
    const usage = { a: 100, b: 50, c: 10 };
    const boostA = recentUsageBoost('a', usage);
    const boostB = recentUsageBoost('b', usage);
    const boostC = recentUsageBoost('c', usage);
    expect(boostA).toBeGreaterThan(boostB);
    expect(boostB).toBeGreaterThan(boostC);
    expect(recentUsageBoost('unused', usage)).toBe(0);
  });
});

describe('rankCommands', () => {
  it('returns registration order for an empty query', () => {
    expect(rankCommands(items, '   ')).toEqual(items);
  });

  it('ranks exact matches above prefix matches', () => {
    const ranked = rankCommands(
      [
        { id: 'exact', title: 'Update' },
        { id: 'prefix', title: 'Update working copy' },
      ],
      'update'
    );
    expect(ranked.map((item) => item.id)).toEqual(['exact', 'prefix']);
  });

  it('supports subsequence queries that contain no adjacent substring', () => {
    // "cmmt" is a subsequence of "Commit changes" but not a substring.
    const ranked = rankCommands(items, 'cmmt');
    expect(ranked.map((item) => item.id)).toContain('commit');
    expect(ranked.map((item) => item.id)).not.toContain('home');
  });

  it('drops non-matching entries entirely', () => {
    expect(rankCommands(items, 'quantum')).toEqual([]);
  });

  it('lets recent usage lift a lower-tier match above a plain competitor', () => {
    // "o" is an early substring of "Commit changes" (index 1) and a later one
    // of "Update working copy" (index 8), so commit wins without a boost…
    const withoutBoost = rankCommands(items, 'o');
    expect(withoutBoost[0].id).toBe('commit');

    // …and a fresh execution of update flips the order.
    const withBoost = rankCommands(items, 'o', { update: Date.now() });
    expect(withBoost[0].id).toBe('update');
  });
});
