import { describe, expect, it } from 'vitest';
import {
  buildIssueUrl,
  extractIssueIds,
  extractIssueLinks,
  normalizeIssueTrackerConfig,
} from '../issueTracker';

describe('issueTracker', () => {
  it('extracts unique issue ids with a configured pattern', () => {
    expect(extractIssueIds('SVN-123 fixes SVN-123 and APP-9', '[A-Z]+-\\d+')).toEqual([
      'SVN-123',
      'APP-9',
    ]);
  });

  it('returns no ids for invalid regex patterns', () => {
    expect(extractIssueIds('SVN-123', '[')).toEqual([]);
  });

  it('builds issue urls from supported placeholders', () => {
    expect(buildIssueUrl('SVN-123', 'https://tracker.local/browse/{id}')).toBe(
      'https://tracker.local/browse/SVN-123'
    );
    expect(buildIssueUrl('SVN-123', 'https://tracker.local/issues/{issue}')).toBe(
      'https://tracker.local/issues/SVN-123'
    );
  });

  it('extracts linked issues when tracker integration is enabled', () => {
    const config = normalizeIssueTrackerConfig({
      enabled: true,
      issueIdPattern: '[A-Z]+-\\d+',
      issueUrlTemplate: 'https://tracker.local/browse/{id}',
    });

    expect(extractIssueLinks('SVN-123 Fix status cache', config)).toEqual([
      { id: 'SVN-123', url: 'https://tracker.local/browse/SVN-123' },
    ]);
  });
});
