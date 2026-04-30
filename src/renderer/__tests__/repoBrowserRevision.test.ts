import { describe, expect, it } from 'vitest';
import { normalizeRepoBrowserRevision } from '../src/routes/repo-browser/-repoBrowserRevision';

describe('repo browser revision selector', () => {
  it('uses HEAD when the revision selector is empty', () => {
    expect(normalizeRepoBrowserRevision('')).toBe('HEAD');
    expect(normalizeRepoBrowserRevision('   ')).toBe('HEAD');
  });

  it.each(['123', 'HEAD', '{2026-04-30}', 'BASE'])('preserves explicit revision %s', (revision) => {
    expect(normalizeRepoBrowserRevision(` ${revision} `)).toBe(revision);
  });
});
