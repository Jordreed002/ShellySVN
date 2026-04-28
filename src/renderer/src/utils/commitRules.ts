import { extractIssueIds, isValidIssuePattern } from './issueTracker';

export interface CommitRules {
  minMessageLength: number;
  requireIssueId: boolean;
  issueIdPattern: string;
}

export const DEFAULT_COMMIT_RULES: CommitRules = {
  minMessageLength: 0,
  requireIssueId: false,
  issueIdPattern: '[A-Z]+-\\d+',
};

export function normalizeCommitRules(rules?: Partial<CommitRules> | null): CommitRules {
  return {
    minMessageLength: Math.max(0, Math.floor(Number(rules?.minMessageLength) || 0)),
    requireIssueId: Boolean(rules?.requireIssueId),
    issueIdPattern: rules?.issueIdPattern?.trim() || DEFAULT_COMMIT_RULES.issueIdPattern,
  };
}

export function validateCommitRules(message: string, rules: CommitRules): string[] {
  const errors: string[] = [];
  const trimmedMessage = message.trim();

  if (rules.minMessageLength > 0 && trimmedMessage.length < rules.minMessageLength) {
    errors.push(`Commit message must be at least ${rules.minMessageLength} characters.`);
  }

  if (rules.requireIssueId) {
    if (!isValidIssuePattern(rules.issueIdPattern)) {
      errors.push('Commit issue ID pattern is invalid.');
    } else if (extractIssueIds(trimmedMessage, rules.issueIdPattern).length === 0) {
      errors.push(`Commit message must include an issue ID matching ${rules.issueIdPattern}.`);
    }
  }

  return errors;
}
