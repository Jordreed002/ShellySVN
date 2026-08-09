import { describe, expect, it } from 'vitest';
import { hashNormalizedAiDiff, IncrementalAiReviewCache } from './support/ai-incremental-review';

describe('IncrementalAiReviewCache', () => {
  it('normalizes line endings and trailing whitespace before hashing', () => {
    expect(hashNormalizedAiDiff('+hello  \r\n-world\r\n')).toBe(
      hashNormalizedAiDiff('+hello\n-world\n')
    );
  });

  it('sends changed paths only and preserves findings whose evidence is unchanged', () => {
    const cache = new IncrementalAiReviewCache();
    const initial = new Map([
      ['a.ts', '+a'],
      ['b.ts', '+b'],
    ]);
    cache.save('repo', initial, [
      { id: 'a', filePath: 'a.ts', evidence: [{ filePath: 'a.ts', excerpt: '+a' }] },
      { id: 'b', filePath: 'b.ts', evidence: [{ filePath: 'b.ts', excerpt: '+b' }] },
    ]);
    const plan = cache.plan(
      'repo',
      new Map([
        ['a.ts', '+a'],
        ['b.ts', '+changed'],
      ])
    );
    expect(plan.changedPaths).toEqual(['b.ts']);
    expect(plan.preservedFindings.map((finding) => finding.id)).toEqual(['a']);
    expect(plan.staleFindings.map((finding) => finding.id)).toEqual(['b']);
  });

  it('expires snapshots and evicts the least-recently saved snapshot', () => {
    const cache = new IncrementalAiReviewCache(1, 100);
    cache.save('old', new Map([['a', 'a']]), [], 0);
    cache.save('new', new Map([['b', 'b']]), [], 50);
    expect(cache.plan('old', new Map([['a', 'a']]), 50).changedPaths).toEqual(['a']);
    expect(cache.plan('new', new Map([['b', 'b']]), 200).changedPaths).toEqual(['b']);
  });
});
