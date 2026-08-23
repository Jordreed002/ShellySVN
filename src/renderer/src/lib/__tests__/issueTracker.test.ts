import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  GITHUB_ISSUE_PATTERN,
  ISSUE_TRACKER_PRESET_KEY,
  JIRA_ISSUE_PATTERN,
  buildGitHubUrlTemplate,
  buildJiraUrlTemplate,
  buildPresetConfig,
  isSafeExternalUrl,
  linkifyIssueKeys,
  loadTrackerPresetSelection,
  normalizeJiraBaseUrl,
  parseGitHubRepository,
  saveTrackerPresetSelection,
} from '../issueTracker';

describe('preset URL builders', () => {
  it('normalizes Jira base URLs idempotently', () => {
    expect(normalizeJiraBaseUrl('https://jira.example.com/')).toBe('https://jira.example.com');
    expect(normalizeJiraBaseUrl('https://jira.example.com/browse')).toBe(
      'https://jira.example.com'
    );
    expect(normalizeJiraBaseUrl('https://jira.example.com/browse/{id}')).toBe(
      'https://jira.example.com'
    );
    expect(normalizeJiraBaseUrl('jira.example.com')).toBe('https://jira.example.com');
  });

  it('derives a Jira URL template', () => {
    expect(buildJiraUrlTemplate('https://jira.acme.com')).toBe(
      'https://jira.acme.com/browse/{id}'
    );
    expect(buildJiraUrlTemplate('')).toBe('');
  });

  it('parses GitHub repository inputs in every accepted spelling', () => {
    expect(parseGitHubRepository('https://github.com/org/repo')).toEqual({
      root: 'https://github.com',
      org: 'org',
      repo: 'repo',
    });
    expect(parseGitHubRepository('github.com/org/repo/')).toEqual({
      root: 'https://github.com',
      org: 'org',
      repo: 'repo',
    });
    expect(parseGitHubRepository('org/repo')).toEqual({
      root: 'https://github.com',
      org: 'org',
      repo: 'repo',
    });
    expect(parseGitHubRepository('https://github.com')).toEqual({ root: 'https://github.com' });
    expect(parseGitHubRepository('https://github.com/org/repo/issues/12#x')).toEqual({
      root: 'https://github.com',
      org: 'org',
      repo: 'repo',
    });
    expect(parseGitHubRepository('')).toBeNull();
    expect(parseGitHubRepository('not a url at all://')).toBeNull();
  });

  it('derives GitHub URL templates with and without repository context', () => {
    expect(buildGitHubUrlTemplate('https://github.com/org/repo')).toBe(
      'https://github.com/org/repo/issues/{id}'
    );
    expect(buildGitHubUrlTemplate('org/repo')).toBe('https://github.com/org/repo/issues/{id}');
    expect(buildGitHubUrlTemplate('https://github.com')).toBe('https://github.com/issues/{id}');
  });

  it('builds preset configs and rejects invalid custom patterns', () => {
    expect(buildPresetConfig('jira', 'https://jira.acme.com')).toEqual({
      issueIdPattern: JIRA_ISSUE_PATTERN,
      issueUrlTemplate: 'https://jira.acme.com/browse/{id}',
    });
    expect(buildPresetConfig('github', 'https://github.com/org/repo')).toEqual({
      issueIdPattern: GITHUB_ISSUE_PATTERN,
      issueUrlTemplate: 'https://github.com/org/repo/issues/{id}',
    });
    expect(
      buildPresetConfig('custom', '', {
        issueIdPattern: 'ABC-\\d+',
        issueUrlTemplate: 'https://t.example.com/{id}',
      })
    ).toEqual({
      issueIdPattern: 'ABC-\\d+',
      issueUrlTemplate: 'https://t.example.com/{id}',
    });
    expect(
      buildPresetConfig('custom', '', { issueIdPattern: '([unclosed', issueUrlTemplate: 'x/{id}' })
    ).toEqual({ issueIdPattern: '', issueUrlTemplate: 'x/{id}' });
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts http(s) URLs only', () => {
    expect(isSafeExternalUrl('https://example.com/browse/PROJ-1')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/i/1')).toBe(true);
  });

  it('rejects hostile and malformed URLs', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('javascript://%0aalert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('https://exa mple.com/x')).toBe(false);
    expect(isSafeExternalUrl('https://example.com/x\nHeader: injected')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);
  });
});

describe('linkifyIssueKeys', () => {
  it('splits text and link segments for a Jira-style pattern', () => {
    const segments = linkifyIssueKeys('fix PROJ-12 and PROJ-13 now', {
      pattern: JIRA_ISSUE_PATTERN,
      urlTemplate: 'https://jira.acme.com/browse/{id}',
    });
    expect(segments).toEqual([
      { type: 'text', text: 'fix ' },
      { type: 'link', text: 'PROJ-12', url: 'https://jira.acme.com/browse/PROJ-12' },
      { type: 'text', text: ' and ' },
      { type: 'link', text: 'PROJ-13', url: 'https://jira.acme.com/browse/PROJ-13' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('URL-encodes issue IDs interpolated into the template', () => {
    const segments = linkifyIssueKeys('id A 1 here', {
      pattern: 'A\\s\\d+',
      urlTemplate: 'https://t.example.com/q?id={id}&ref=x',
    });
    expect(segments[1]).toEqual({
      type: 'link',
      text: 'A 1',
      url: 'https://t.example.com/q?id=A%201&ref=x',
    });
  });

  it('keeps segments without a URL when no template is configured', () => {
    const segments = linkifyIssueKeys('see PROJ-9', {
      pattern: JIRA_ISSUE_PATTERN,
      urlTemplate: '',
    });
    expect(segments).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'PROJ-9', url: undefined },
    ]);
  });

  it('degrades invalid and empty patterns to plain text', () => {
    expect(linkifyIssueKeys('PROJ-1', { pattern: '([bad', urlTemplate: 'https://x/{id}' })).toEqual([
      { type: 'text', text: 'PROJ-1' },
    ]);
    expect(linkifyIssueKeys('PROJ-1', { pattern: '', urlTemplate: 'https://x/{id}' })).toEqual([
      { type: 'text', text: 'PROJ-1' },
    ]);
    expect(linkifyIssueKeys('', { pattern: JIRA_ISSUE_PATTERN, urlTemplate: 'https://x/{id}' })).toEqual(
      []
    );
  });

  it('drops link URLs that a hostile template turns unsafe', () => {
    const segments = linkifyIssueKeys('PROJ-1', {
      pattern: JIRA_ISSUE_PATTERN,
      urlTemplate: 'javascript:alert("{id}")',
    });
    expect(segments).toEqual([
      { type: 'link', text: 'PROJ-1', url: undefined },
    ]);
  });

  it('resolves GitHub references, with org/repo overriding the base', () => {
    const template = buildGitHubUrlTemplate('https://github.com/base/repo');
    const segments = linkifyIssueKeys('bare #12 and cross other/repo#34 end', {
      pattern: GITHUB_ISSUE_PATTERN,
      urlTemplate: template,
      preset: 'github',
    });

    expect(segments).toEqual([
      { type: 'text', text: 'bare ' },
      { type: 'link', text: '#12', url: 'https://github.com/base/repo/issues/12' },
      { type: 'text', text: ' and cross ' },
      { type: 'link', text: 'other/repo#34', url: 'https://github.com/other/repo/issues/34' },
      { type: 'text', text: ' end' },
    ]);
  });

  it('matches zero-width and boundary-hostile text without crashing', () => {
    const segments = linkifyIssueKeys('#0 #99999999999999999999 nope #abc 12#34', {
      pattern: GITHUB_ISSUE_PATTERN,
      urlTemplate: 'https://github.com/o/r/issues/{id}',
      preset: 'github',
    });
    expect(segments.filter((segment) => segment.type === 'link')).toEqual([
      { type: 'link', text: '#0', url: 'https://github.com/o/r/issues/0' },
      {
        type: 'link',
        text: '#99999999999999999999',
        url: 'https://github.com/o/r/issues/99999999999999999999',
      },
      { type: 'link', text: '#34', url: 'https://github.com/o/r/issues/34' },
    ]);
  });
});

describe('preset selection persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a per-working-copy selection with global fallback', async () => {
    let stored: Record<string, unknown> = {};
    window.api = {
      store: {
        get: vi.fn().mockImplementation((key: string) => Promise.resolve(stored[key])),
        set: vi.fn().mockImplementation((key: string, value: unknown) => {
          stored[key] = value;
          return Promise.resolve();
        }),
      },
    } as unknown as Window['api'];

    await saveTrackerPresetSelection('/Repo/A', { preset: 'jira', baseUrl: 'https://jira.x' });
    expect(stored[ISSUE_TRACKER_PRESET_KEY]).toEqual({
      workingCopies: { '/repo/a': { preset: 'jira', baseUrl: 'https://jira.x' } },
    });

    await saveTrackerPresetSelection(null, { preset: 'github', baseUrl: 'org/repo' });
    await expect(loadTrackerPresetSelection('/Repo/A/')).resolves.toEqual({
      preset: 'jira',
      baseUrl: 'https://jira.x',
    });
    await expect(loadTrackerPresetSelection('/other')).resolves.toEqual({
      preset: 'github',
      baseUrl: 'org/repo',
    });
    await expect(loadTrackerPresetSelection(null)).resolves.toEqual({
      preset: 'github',
      baseUrl: 'org/repo',
    });
  });

  it('clears the slot on a null selection and rejects junk payloads', async () => {
    let stored: Record<string, unknown> = {
      [ISSUE_TRACKER_PRESET_KEY]: {
        global: { preset: 'nope', baseUrl: 'x' },
        workingCopies: { '/repo': 'junk' },
      },
    };
    window.api = {
      store: {
        get: vi.fn().mockImplementation(() => Promise.resolve(stored[ISSUE_TRACKER_PRESET_KEY])),
        set: vi.fn().mockImplementation((_key: string, value: unknown) => {
          stored[ISSUE_TRACKER_PRESET_KEY] = value;
          return Promise.resolve();
        }),
      },
    } as unknown as Window['api'];

    await expect(loadTrackerPresetSelection('/repo')).resolves.toBeNull();
    await saveTrackerPresetSelection('/repo', { preset: 'custom', baseUrl: '' });
    await expect(loadTrackerPresetSelection('/repo')).resolves.toEqual({
      preset: 'custom',
      baseUrl: '',
    });
    await saveTrackerPresetSelection('/repo', null);
    await expect(loadTrackerPresetSelection('/repo')).resolves.toBeNull();
  });

  it('degrades to null when storage throws', async () => {
    window.api = {
      store: {
        get: vi.fn().mockRejectedValue(new Error('boom')),
        set: vi.fn(),
      },
    } as unknown as Window['api'];
    await expect(loadTrackerPresetSelection('/repo')).resolves.toBeNull();
    await expect(
      saveTrackerPresetSelection('/repo', { preset: 'jira', baseUrl: 'x' })
    ).resolves.toBeUndefined();
  });
});
