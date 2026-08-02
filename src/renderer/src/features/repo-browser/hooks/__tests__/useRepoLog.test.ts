import { describe, expect, it } from 'vitest';

import { buildBugtraqUrl, extractIssueReference } from '../useRepoLog';

/**
 * J7 / J12 — Issue-tracker integration.
 *
 * Subversion repos link commits to issues via the `bugtraq:` properties
 * (`bugtraq:logregex` + `bugtraq:url`). These two pure helpers turn a commit
 * message into an issue id and then into a clickable tracker URL. A regression
 * silently breaks the link for every repo that relies on it, so the contract is
 * pinned here — including the two-regex form and graceful handling of malformed
 * properties.
 */
describe('extractIssueReference', () => {
  it('returns undefined when there is no logregex', () => {
    expect(extractIssueReference('PROJ-123 fix', null)).toBeUndefined();
    expect(extractIssueReference('PROJ-123 fix', undefined)).toBeUndefined();
    expect(extractIssueReference('PROJ-123 fix', '')).toBeUndefined();
    expect(extractIssueReference('PROJ-123 fix', '  \n  ')).toBeUndefined();
  });

  it('uses the whole match for a single regex with no capture group', () => {
    expect(extractIssueReference('fix: PROJ-123 crash', '[A-Z]+-\\d+')).toBe('PROJ-123');
  });

  it('prefers the first capture group when present', () => {
    expect(extractIssueReference('fix: PROJ-123 crash', '([A-Z]+)-(\\d+)')).toBe('PROJ');
  });

  it('returns undefined when the single regex does not match', () => {
    expect(extractIssueReference('just a message', '[A-Z]+-\\d+')).toBeUndefined();
  });

  it('extracts the id from a block using the two-regex form', () => {
    // First regex isolates the "issues: …" block; second pulls the bare id.
    const logregex = ['issues?:\\s*(.*)', '([A-Z]+-\\d+)'].join('\n');
    expect(extractIssueReference('issues: PROJ-123, PROJ-456', logregex)).toBe('PROJ-123');
  });

  it('returns undefined when the two-regex block is absent', () => {
    const logregex = ['issues?:\\s*(.*)', '([A-Z]+-\\d+)'].join('\n');
    expect(extractIssueReference('no issues mentioned here', logregex)).toBeUndefined();
  });

  it('trims surrounding whitespace from the extracted reference', () => {
    expect(extractIssueReference('  PROJ-123  ', '[A-Z]+-\\d+')).toBe('PROJ-123');
  });

  it('returns undefined for a malformed regex instead of throwing', () => {
    expect(extractIssueReference('msg', '(')).toBeUndefined();
  });
});

describe('buildBugtraqUrl', () => {
  it('returns null when there is no url template', () => {
    expect(buildBugtraqUrl(null, 'PROJ-123')).toBeNull();
    expect(buildBugtraqUrl('', 'PROJ-123')).toBeNull();
  });

  it('substitutes the %BUGID% placeholder with the issue id', () => {
    expect(buildBugtraqUrl('https://jira.example.com/browse/%BUGID%', 'PROJ-123')).toBe(
      'https://jira.example.com/browse/PROJ-123'
    );
  });

  it('URL-encodes special characters in the issue id', () => {
    expect(buildBugtraqUrl('https://tracker/%BUGID%', 'a b&c')).toBe(
      'https://tracker/a%20b%26c'
    );
  });

  it('leaves a template without the placeholder unchanged', () => {
    expect(buildBugtraqUrl('https://tracker/issues', 'PROJ-123')).toBe(
      'https://tracker/issues'
    );
  });
});
