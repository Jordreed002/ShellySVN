import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMIT_RULES,
  normalizeCommitRules,
  validateCommitRules,
} from '../commitRules';

describe('commitRules', () => {
  it('normalizes missing rules to defaults', () => {
    expect(normalizeCommitRules(null)).toEqual(DEFAULT_COMMIT_RULES);
  });

  it('rejects messages shorter than the configured minimum', () => {
    const errors = validateCommitRules('short', {
      minMessageLength: 10,
      requireIssueId: false,
      issueIdPattern: '[A-Z]+-\\d+',
    });

    expect(errors).toContain('Commit message must be at least 10 characters.');
  });

  it('requires an issue id when enabled', () => {
    const errors = validateCommitRules('Fix checkout flow', {
      minMessageLength: 0,
      requireIssueId: true,
      issueIdPattern: '[A-Z]+-\\d+',
    });

    expect(errors).toContain('Commit message must include an issue ID matching [A-Z]+-\\d+.');
  });

  it('accepts messages that satisfy all rules', () => {
    const errors = validateCommitRules('SVN-123 Fix checkout flow', {
      minMessageLength: 10,
      requireIssueId: true,
      issueIdPattern: '[A-Z]+-\\d+',
    });

    expect(errors).toEqual([]);
  });
});
