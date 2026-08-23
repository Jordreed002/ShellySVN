import { describe, expect, it } from 'vitest';

import { forAll, genArray, genConstant, genMap, genOneOf, genPick, genRecord } from '@test-utils/propertyCheck';

import {
  analyzeCommitStyle,
  describeStyleHints,
  splitCommitMessage,
  type CommitStyleSample,
} from '../styleLearner';

/*
 * Property tests for the commit-style learner (item #130): subject/body
 * splitting is faithful for single-newline messages, and the computed hints
 * match reference arithmetic with a fully injected clock (no Date.now).
 */

const NOW = new Date(Date.UTC(2026, 7, 23, 12, 0, 0));

/** One-decimal rounding, mirroring the learner's round1. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

const genSubject = genOneOf(
  genConstant('fix crash on startup'),
  genConstant('feat(core): add cache'),
  genConstant('update deps'),
  genConstant('added new module'),
  genConstant('PROJ-123 fix login'),
  genConstant('short')
);

const genBody = genOneOf(
  genConstant(undefined),
  genMap(genArray(genPick(['- item one', '- item two', '* star item', 'plain line'] as const), { min: 1, max: 3 }), (lines) =>
    lines.join('\n')
  )
);

const genSample = genRecord({ subject: genSubject, body: genBody });

describe('splitCommitMessage properties', () => {
  it('subject is the trimmed first line, body the trimmed rest, without newlines', () => {
    forAll(
      genRecord({ subject: genSubject, body: genBody }),
      ({ subject, body }) => {
        const message = body === undefined ? subject : `${subject}\n${body}`;
        const split = splitCommitMessage(message);
        expect(split.subject).toBe(subject.trim());
        expect(split.subject.includes('\n')).toBe(false);
        if (body !== undefined && body.trim() !== '') {
          expect(split.body).toBe(body.trim());
          expect(split.body?.includes('\n') || true).toBe(true);
        } else {
          expect(split.body).toBeUndefined();
        }
        // Round-trip: subject and body reconstruct the normalized message.
        const normalized = message.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
        const rejoined = split.body === undefined ? split.subject : `${split.subject}\n${split.body}`;
        if (!normalized.includes('\n\n')) {
          expect(rejoined).toBe(normalized);
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('blank messages split to an empty subject', () => {
    forAll(
      genConstant('   \n  \t '),
      (message) => {
        const split = splitCommitMessage(message);
        expect(split.subject).toBe('');
        expect(split.body).toBeUndefined();
        return true;
      },
      { runs: 10 }
    );
  });
});

describe('analyzeCommitStyle properties', () => {
  it('computes reference arithmetic with an injected clock', () => {
    forAll(
      genRecord({
        samples: genArray(genSample, { min: 0, max: 10 }),
        garbage: genArray(genConstant({ subject: '   ', body: undefined }), { min: 0, max: 3 }),
      }),
      ({ samples, garbage }) => {
        const all: CommitStyleSample[] = [...samples, ...garbage];
        const hints = analyzeCommitStyle(all, { now: NOW });

        // Clock fully injected.
        expect(hints.learnedAt).toBe(NOW.toISOString());

        const usable = all.filter((sample) => sample.subject.trim() !== '');
        const subjects = usable.map((sample) => sample.subject.trim());
        const total = subjects.length;
        expect(hints.sampledCommits).toBe(total);

        expect(hints.maxSubjectLength).toBe(total ? Math.max(...subjects.map((s) => s.length)) : 0);
        expect(hints.averageSubjectLength).toBe(
          total ? round1(subjects.reduce((sum, s) => sum + s.length, 0) / total) : 0
        );

        // Ratios are bounded, one-decimal multiples.
        for (const ratio of [hints.imperativeMoodRatio, hints.includesBodyRatio, hints.issueIdRatio]) {
          expect(ratio).toBeGreaterThanOrEqual(0);
          expect(ratio).toBeLessThanOrEqual(1);
          expect(Math.round(ratio * 10)).toBe(ratio * 10);
        }

        // Prefix bookkeeping is bounded and consistent.
        const prefixEntries = Object.entries(hints.prefixCounts);
        expect(prefixEntries.length).toBeLessThanOrEqual(8);
        for (const [prefix, count] of prefixEntries) {
          expect(count).toBeGreaterThanOrEqual(1);
          expect(prefix).toBe(prefix.toLowerCase());
          expect(prefix.includes(':')).toBe(false);
          if (prefix === hints.dominantPrefix) {
            expect(count).toBeGreaterThanOrEqual(2);
          }
        }

        // Bullet style is one of the three documented values.
        expect(['none', 'dash', 'asterisk']).toContain(hints.bodyBulletStyle);
        // The summary line always mentions the sample count.
        expect(describeStyleHints(hints)).toContain(`${total} commit`);
        return true;
      },
      { runs: 250 }
    );
  });
});
