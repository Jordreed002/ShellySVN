export interface IssueTrackerConfig {
  enabled: boolean;
  issueIdPattern: string;
  issueUrlTemplate: string;
}

export const DEFAULT_ISSUE_TRACKER_CONFIG: IssueTrackerConfig = {
  enabled: false,
  issueIdPattern: '[A-Z]+-\\d+',
  issueUrlTemplate: '',
};

export interface IssueLink {
  id: string;
  url?: string;
}

export function normalizeIssueTrackerConfig(
  config?: Partial<IssueTrackerConfig> | null
): IssueTrackerConfig {
  return {
    enabled: Boolean(config?.enabled),
    issueIdPattern: config?.issueIdPattern?.trim() || DEFAULT_ISSUE_TRACKER_CONFIG.issueIdPattern,
    issueUrlTemplate: config?.issueUrlTemplate?.trim() || '',
  };
}

export function extractIssueIds(message: string, pattern: string): string[] {
  if (!message.trim() || !pattern.trim()) return [];

  try {
    const regex = new RegExp(pattern, 'g');
    return Array.from(new Set(Array.from(message.matchAll(regex), (match) => match[0])));
  } catch {
    return [];
  }
}

export function isValidIssuePattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function buildIssueUrl(issueId: string, template: string): string | undefined {
  const trimmedTemplate = template.trim();
  if (!trimmedTemplate) return undefined;

  return trimmedTemplate
    .replaceAll('{id}', encodeURIComponent(issueId))
    .replaceAll('{issue}', encodeURIComponent(issueId));
}

export function extractIssueLinks(
  message: string,
  config: IssueTrackerConfig
): IssueLink[] {
  if (!config.enabled) return [];

  return extractIssueIds(message, config.issueIdPattern).map((id) => ({
    id,
    url: buildIssueUrl(id, config.issueUrlTemplate),
  }));
}
