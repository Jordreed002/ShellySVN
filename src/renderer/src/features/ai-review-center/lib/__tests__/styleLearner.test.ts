import { describe, expect, it } from 'vitest';
import {
  analyzeCommitStyle,
  describeStyleHints,
  splitCommitMessage,
} from '../styleLearner';

const NOW = new Date('2026-01-15T12:00:00.000Z');

describe('splitCommitMessage', () => {
  it('splits on the first newline and trims', () => {
    expect(splitCommitMessage('Fix crash\n\nLong explanation\nsecond line')).toEqual({
      subject: 'Fix crash',
      body: 'Long explanation\nsecond line',
    });
  });

  it('returns no body for subject-only messages', () => {
    expect(splitCommitMessage('Only a subject')).toEqual({ subject: 'Only a subject' });
    expect(splitCommitMessage('Subject\n   \n')).toEqual({ subject: 'Subject' });
  });

  it('normalizes CRLF and tolerates empty input', () => {
    expect(splitCommitMessage('S\r\nB')).toEqual({ subject: 'S', body: 'B' });
    expect(splitCommitMessage('')).toEqual({ subject: '' });
    expect(splitCommitMessage(undefined as unknown as string)).toEqual({ subject: '' });
  });
});

describe('analyzeCommitStyle', () => {
  it('computes lengths, ratios, and stamps learnedAt from the injected clock', () => {
    const hints = analyzeCommitStyle(
      [
        { subject: 'Add settings panel', body: '- one\n- two' },
        { subject: 'Fix login redirect' },
        { subject: 'Remove dead code', body: 'Explains why.' },
        { subject: 'Update readme' },
      ],
      { now: NOW }
    );
    expect(hints.sampledCommits).toBe(4);
    expect(hints.averageSubjectLength).toBe(16.3); // (18 + 18 + 16 + 13) / 4 = 16.25
    expect(hints.maxSubjectLength).toBe(18);
    expect(hints.imperativeMoodRatio).toBe(1);
    expect(hints.includesBodyRatio).toBe(0.5);
    expect(hints.bodyBulletStyle).toBe('dash');
    expect(hints.learnedAt).toBe(NOW.toISOString());
  });

  it('computes the exact average subject length', () => {
    const hints = analyzeCommitStyle(
      [{ subject: 'Add settings panel' }, { subject: 'Fix login redirect' }],
      { now: NOW }
    );
    // "Add settings panel" = 18, "Fix login redirect" = 18 -> 18
    expect(hints.averageSubjectLength).toBe(18);
    expect(hints.maxSubjectLength).toBe(18);
  });

  it('detects imperative mood, ignoring prefixes', () => {
    const hints = analyzeCommitStyle(
      [
        { subject: 'feat: Add settings panel' },
        { subject: 'fix(core): Fix login redirect' },
        { subject: 'Added legacy note' },
        { subject: 'Updates the config' },
      ],
      { now: NOW }
    );
    expect(hints.imperativeMoodRatio).toBe(0.5);
  });

  it('counts prefixes and picks a dominant one only when repeated', () => {
    const hints = analyzeCommitStyle(
      [
        { subject: 'feat: Add settings' },
        { subject: 'feat: Add export' },
        { subject: 'fix: Repair crash' },
        { subject: 'No prefix here' },
      ],
      { now: NOW }
    );
    expect(hints.prefixCounts).toEqual({ feat: 2, fix: 1 });
    expect(hints.dominantPrefix).toBe('feat');
    const single = analyzeCommitStyle([{ subject: 'fix: only one' }], { now: NOW });
    expect(single.dominantPrefix).toBeUndefined();
  });

  it('measures body usage and bullet style', () => {
    const dashy = analyzeCommitStyle(
      [
        { subject: 'One', body: '- first\n- second' },
        { subject: 'Two', body: '- only dash' },
        { subject: 'Three' },
      ],
      { now: NOW }
    );
    expect(dashy.includesBodyRatio).toBe(0.7);
    expect(dashy.bodyBulletStyle).toBe('dash');

    const starry = analyzeCommitStyle(
      [
        { subject: 'One', body: '* first' },
        { subject: 'Two', body: '* second' },
      ],
      { now: NOW }
    );
    expect(starry.bodyBulletStyle).toBe('asterisk');

    const plain = analyzeCommitStyle([{ subject: 'One', body: 'Prose only.' }], { now: NOW });
    expect(plain.bodyBulletStyle).toBe('none');
  });

  it('matches issue IDs with the provided pattern or the generic default', () => {
    const withIds = analyzeCommitStyle(
      [
        { subject: 'PROJ-123 Add thing' },
        { subject: 'feat: Remove thing ABC-9' },
        { subject: 'No id' },
        { subject: 'No id either' },
      ],
      { now: NOW }
    );
    expect(withIds.issueIdRatio).toBe(0.5);

    const custom = analyzeCommitStyle(
      [{ subject: 'Issue #42 fix' }, { subject: 'nope' }],
      { issueIdPattern: '#\\d+', now: NOW }
    );
    expect(custom.issueIdRatio).toBe(0.5);
  });

  it('falls back to the generic issue pattern when the custom one is invalid', () => {
    const hints = analyzeCommitStyle([{ subject: 'PROJ-1 valid' }], {
      issueIdPattern: '([unclosed',
      now: NOW,
    });
    expect(hints.issueIdRatio).toBe(1);
  });

  it('returns a zeroed, well-shaped result for empty input', () => {
    const hints = analyzeCommitStyle([], { now: NOW });
    expect(hints).toEqual({
      sampledCommits: 0,
      averageSubjectLength: 0,
      maxSubjectLength: 0,
      imperativeMoodRatio: 0,
      prefixCounts: {},
      dominantPrefix: undefined,
      includesBodyRatio: 0,
      bodyBulletStyle: 'none',
      issueIdRatio: 0,
      learnedAt: NOW.toISOString(),
    });
  });

  it('ignores malformed samples instead of throwing', () => {
    const hints = analyzeCommitStyle(
      [
        undefined,
        null,
        { subject: '' },
        { subject: '   ' },
        { subject: 'Valid one' },
      ] as unknown as Parameters<typeof analyzeCommitStyle>[0],
      { now: NOW }
    );
    expect(hints.sampledCommits).toBe(1);
  });
});

describe('describeStyleHints', () => {
  it('summarizes the learned hints in one line', () => {
    const summary = describeStyleHints(
      analyzeCommitStyle(
        [
          { subject: 'feat: Add settings', body: '- detail' },
          { subject: 'feat: Add export', body: '- detail' },
        ],
        { now: NOW }
      )
    );
    expect(summary).toContain('2 commits sampled');
    expect(summary).toContain('dominant prefix feat:');
    expect(summary).toContain('% imperative');
  });
});
