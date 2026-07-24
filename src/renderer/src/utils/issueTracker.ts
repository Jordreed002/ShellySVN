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

export interface SvnProperty {
  name: string;
  value: string;
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
    RegExp(pattern);
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

export function extractIssueLinks(message: string, config: IssueTrackerConfig): IssueLink[] {
  if (!config.enabled) return [];

  return extractIssueIds(message, config.issueIdPattern).map((id) => ({
    id,
    url: buildIssueUrl(id, config.issueUrlTemplate),
  }));
}

export function issueTrackerConfigFromBugtraqProperties(
  properties: SvnProperty[]
): IssueTrackerConfig | null {
  const propertyMap = new Map(
    properties.map((property) => [property.name.toLowerCase(), property.value.trim()])
  );
  const bugtraqUrl = propertyMap.get('bugtraq:url') || '';
  const bugtraqLogRegex = propertyMap.get('bugtraq:logregex') || '';
  const bugtraqNumber = propertyMap.get('bugtraq:number')?.toLowerCase() === 'true';

  if (!bugtraqUrl && !bugtraqLogRegex && !bugtraqNumber) {
    return null;
  }

  return normalizeIssueTrackerConfig({
    enabled: true,
    issueIdPattern: getBugtraqIssuePattern(bugtraqLogRegex, bugtraqNumber),
    issueUrlTemplate: bugtraqUrl.replace(/%BUGID%/gi, '{id}'),
  });
}

export function getInheritedPropertyLookupPaths(
  targetPath: string,
  workingCopyRoot: string
): string[] {
  const rootPath = trimTrailingSeparators(workingCopyRoot);
  const firstPath = trimTrailingSeparators(targetPath || rootPath);

  if (!firstPath) return [];
  if (!rootPath) return [firstPath];

  const rootKey = normalizePathKey(rootPath);
  const lookupPaths: string[] = [];
  let currentPath = firstPath;

  for (let depth = 0; depth < 100 && currentPath; depth++) {
    const currentKey = normalizePathKey(currentPath);
    const isInsideRoot = currentKey === rootKey || currentKey.startsWith(rootKey + '/');

    if (isInsideRoot && !lookupPaths.some((path) => normalizePathKey(path) === currentKey)) {
      lookupPaths.push(currentPath);
    }

    if (currentKey === rootKey) break;

    const parentPath = getParentPath(currentPath);
    if (!parentPath || parentPath === currentPath) break;
    currentPath = parentPath;
  }

  if (!lookupPaths.some((path) => normalizePathKey(path) === rootKey)) {
    lookupPaths.push(rootPath);
  }

  return lookupPaths;
}

function getBugtraqIssuePattern(logRegex: string, numericOnly: boolean): string {
  const regexLines = logRegex
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (regexLines.length > 0) {
    return regexLines.at(-1) || DEFAULT_ISSUE_TRACKER_CONFIG.issueIdPattern;
  }

  return numericOnly ? '\\d+' : DEFAULT_ISSUE_TRACKER_CONFIG.issueIdPattern;
}

function normalizePathKey(path: string): string {
  return trimTrailingSeparators(path).replace(/\\/g, '/').toLowerCase();
}

function trimTrailingSeparators(path: string): string {
  return path.trim().replace(/[\\/]+$/, '');
}

function getParentPath(path: string): string | null {
  const trimmedPath = trimTrailingSeparators(path);
  const separatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'));

  if (separatorIndex <= 0) return null;
  return trimmedPath.slice(0, separatorIndex);
}
