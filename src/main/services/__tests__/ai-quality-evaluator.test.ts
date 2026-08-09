import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateCommitMessage,
  evaluateConflictProposal,
  evaluateReleaseTraceability,
  evaluateReviewFindings,
  validateStructuredOutput,
} from './support/ai-quality-evaluator';
import { aiReviewOutputSchema, prepareDiffForAi } from '../ai-commit-message-utils';

interface Fixture {
  id: string;
  kind: string;
  paths: string[];
  diff?: string;
  omittedBinaryFiles?: string[];
  revisions?: number[];
}
const fixtureFile = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/ai-quality/fixtures.json'), 'utf8')
) as { version: number; fixtures: Fixture[] };
const fixture = (id: string): Fixture => fixtureFile.fixtures.find((value) => value.id === id)!;

describe('sanitized AI quality fixtures', () => {
  it('covers every required deterministic scenario without real repository paths', () => {
    expect(fixtureFile.version).toBe(1);
    expect(fixtureFile.fixtures.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'focused-change',
        'unrelated-generated-config-todo-missing-test',
        'synthetic-secret-redaction',
        'binary-omission',
        'repository-style',
        'ambiguous-conflict',
        'breaking-release-range',
      ])
    );
    expect(JSON.stringify(fixtureFile)).not.toMatch(/\/Users\/|C:\\Users\\|BEGIN .*PRIVATE KEY/);
  });

  it('validates strict structured review output schemas', () => {
    const valid = {
      summary: 'One supported finding.',
      findings: [
        {
          severity: 'warning',
          category: 'Debug',
          title: 'Logging',
          detail: 'Remove logging.',
          filePath: 'src/login.ts',
          line: 4,
          confidence: 0.9,
          evidence: [
            {
              filePath: 'src/login.ts',
              startLine: 4,
              endLine: 4,
              excerpt: "+console.log('login');",
            },
          ],
        },
      ],
    };
    expect(validateStructuredOutput(aiReviewOutputSchema(), valid)).toEqual([]);
    expect(
      validateStructuredOutput(aiReviewOutputSchema(), { ...valid, unexpected: true })
    ).toContainEqual(expect.objectContaining({ code: 'schema-additional' }));
  });

  it('rejects unsupported finding paths and evidence absent from bounded input', () => {
    const source = fixture('unrelated-generated-config-todo-missing-test');
    const issues = evaluateReviewFindings(
      [
        {
          filePath: '../private.txt',
          confidence: 1,
          evidence: [{ filePath: 'src/login.ts', excerpt: 'invented line' }],
        },
      ],
      source.paths,
      source.diff!
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unsupported-path', 'unsupported-evidence'])
    );
    expect(
      evaluateReviewFindings(
        [
          {
            filePath: 'src/login.ts',
            confidence: 0.8,
            evidence: [{ filePath: 'src/login.ts', excerpt: "+console.log('login');" }],
          },
        ],
        source.paths,
        source.diff!
      )
    ).toEqual([]);
  });

  it('enforces commit subject and repository-style limits', () => {
    expect(
      evaluateCommitMessage('SVN-123 fix status refresh', '', {
        subjectMaxLength: 60,
        prefixes: ['SVN-123 fix'],
      })
    ).toEqual([]);
    expect(
      evaluateCommitMessage('Unscoped and excessively long '.repeat(4), '', {
        subjectMaxLength: 60,
        prefixes: ['SVN-123 fix'],
      }).map((issue) => issue.code)
    ).toEqual(expect.arrayContaining(['subject-length', 'repository-style']));
  });

  it('detects unsafe conflict markers and missing ambiguity questions', () => {
    expect(
      evaluateConflictProposal(
        { proposedMergedText: '<<<<<<< mine\n=======\n>>>>>>> theirs', unresolvedQuestions: [] },
        { allowConflictMarkers: false, expectUnresolvedQuestions: true }
      ).map((issue) => issue.code)
    ).toEqual(['conflict-marker', 'missing-question']);
  });

  it('requires release references to be complete and non-invented', () => {
    expect(
      evaluateReleaseTraceability(['r41 breaking endpoint', 'r42 upgrade guide'], [41, 42])
    ).toEqual([]);
    expect(
      evaluateReleaseTraceability(['r41', 'r99'], [41, 42]).map((issue) => issue.code)
    ).toEqual(expect.arrayContaining(['unsupported-revision', 'missing-revision']));
  });

  it('proves synthetic secrets are redacted and binary sections omitted', () => {
    const secret = prepareDiffForAi(fixture('synthetic-secret-redaction').diff!, 64 * 1024);
    expect(secret.redacted).toBe(true);
    expect(secret.text).not.toContain('EXAMPLE-NOT-A-REAL-CREDENTIAL');
    const binary = prepareDiffForAi(fixture('binary-omission').diff!, 64 * 1024);
    expect(binary.omittedBinaryFiles).toEqual(fixture('binary-omission').omittedBinaryFiles);
    expect(binary.text).not.toContain('Cannot display');
  });
});
