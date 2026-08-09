import { describe, expect, it } from 'vitest';
import {
  captureResult,
  emptyReviewCenterWorkspace,
  exportReviewCenterMarkdown,
  parseReviewCenterWorkspace,
  setFindingState,
} from '../reviewCenterStore';
import { checksumReviewInput } from '../reviewCenterEvents';

const metadata = {
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  durationMs: 1250,
  truncated: false,
  redacted: true,
};

describe('AI review center store', () => {
  it('rejects an incompatible or cross-working-copy snapshot', () => {
    expect(parseReviewCenterWorkspace({ version: 2 }, '/wc')).toEqual(
      emptyReviewCenterWorkspace('/wc')
    );
    expect(parseReviewCenterWorkspace({ version: 1, workingCopyPath: '/other' }, '/wc')).toEqual(
      emptyReviewCenterWorkspace('/wc')
    );
  });

  it('captures findings, preserves triage state, and marks prior runs stale', () => {
    const initial = emptyReviewCenterWorkspace('/wc');
    const first = captureResult(
      initial,
      {
        kind: 'review',
        workingCopyPath: '/wc',
        checksum: 'one',
        result: {
          ...metadata,
          summary: 'One issue',
          findings: [
            {
              id: 'debug-log',
              severity: 'warning',
              category: 'debug',
              title: 'Debug output',
              detail: 'Remove the temporary log.',
              filePath: '/wc/src/app.ts',
              line: 12,
              confidence: 0.8,
              evidence: [
                {
                  filePath: '/wc/src/app.ts',
                  startLine: 12,
                  endLine: 12,
                  excerpt: 'secret source',
                },
              ],
            },
          ],
        },
      },
      '2026-01-01T00:00:00.000Z'
    );
    const dismissed = setFindingState(first, 'debug-log', 'dismissed');
    const second = captureResult(
      dismissed,
      {
        kind: 'review',
        workingCopyPath: '/wc',
        checksum: 'two',
        result: { ...metadata, summary: 'Still present', findings: first.findings },
      },
      '2026-01-02T00:00:00.000Z'
    );

    expect(second.findings[0].state).toBe('dismissed');
    expect(second.runs).toHaveLength(2);
    expect(second.runs[1].checksum).not.toBe(second.currentChecksum);
    expect(second.findings[0].evidence[0]?.excerpt).toBe('');
  });

  it('deduplicates file explanations and unresolved questions', () => {
    const capture = {
      kind: 'explanation' as const,
      workingCopyPath: '/wc',
      filePath: '/wc/app.ts',
      checksum: 'same',
      mode: 'risks' as const,
      result: {
        ...metadata,
        mode: 'risks' as const,
        summary: 'Changed retry handling',
        rationale: 'Avoids duplicate work',
        risks: ['Race condition'],
        reviewQuestions: ['Is cancellation tested?'],
        cached: false,
      },
    };
    const first = captureResult(emptyReviewCenterWorkspace('/wc'), capture);
    const second = captureResult(first, capture);

    expect(second.explanations).toHaveLength(1);
    expect(second.questions).toEqual(['Is cancellation tested?']);
  });

  it('exports a safe structured report without prompts or diffs', () => {
    const workspace = captureResult(emptyReviewCenterWorkspace('/wc'), {
      kind: 'plan',
      workingCopyPath: '/wc',
      checksum: 'plan',
      result: {
        ...metadata,
        summary: 'Two focused changes',
        groups: [
          {
            id: 'settings',
            title: 'Settings',
            description: 'Updates configuration.',
            paths: ['/wc/settings.ts'],
            suggestedMessage: 'feat: add settings controls',
          },
        ],
      },
    });
    const markdown = exportReviewCenterMarkdown(workspace);

    expect(markdown).toContain('## Commit groups (1)');
    expect(markdown).toContain('feat: add settings controls');
    expect(markdown).toContain('No raw diffs or prompts are included');
  });

  it('neutralizes raw HTML in exported provider text', () => {
    const workspace = emptyReviewCenterWorkspace('/wc/<script>alert(1)</script>');
    const markdown = exportReviewCenterMarkdown(workspace);
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('&lt;script&gt;');
  });

  it('produces stable checksums for review selections', () => {
    expect(checksumReviewInput('M:/wc/a.ts')).toBe(checksumReviewInput('M:/wc/a.ts'));
    expect(checksumReviewInput('M:/wc/a.ts')).not.toBe(checksumReviewInput('M:/wc/b.ts'));
  });
});
