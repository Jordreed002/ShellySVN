/**
 * Tag-name templates and dry-run preview for the tag/release wizard (#51).
 *
 * Pure helpers: presets, `{version}`/`{rev}` substitution, semver validation,
 * increment-bumping against the last detected tag, the pre-filled commit
 * message, and the exact `svn copy` command line the wizard will run. The
 * TagWizard component owns all IPC (svn list/copy, repo browsing).
 */

export interface TagTemplatePreset {
  id: string;
  /** Template with `{version}`/`{rev}` placeholders; empty for custom. */
  template: string;
  /** Shown in the preset picker, using the x.y.z/# conventions. */
  label: string;
  /** True when the `{version}` slot must be a valid semver version. */
  requiresSemver: boolean;
}

export const TAG_TEMPLATE_PRESETS: readonly TagTemplatePreset[] = [
  { id: 'release-semver', template: 'release/{version}', label: 'release/x.y.z', requiresSemver: true },
  { id: 'plain-semver', template: '{version}', label: 'x.y.z', requiresSemver: true },
  { id: 'revision', template: 'tags/#{rev}', label: 'tags/#{rev}', requiresSemver: false },
  { id: 'custom', template: '', label: 'Custom…', requiresSemver: false },
];

/** Placeholder names recognized inside custom templates. */
export type TemplatePlaceholder = 'version' | 'rev';

export interface TemplateContext {
  version?: string;
  rev?: number | string;
}

/** Substitute `{version}`/`{rev}` (any casing) into a template. */
export function applyTagTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{(version|rev)\}/gi, (_match, placeholder: string) => {
    const key = placeholder.toLowerCase() as TemplatePlaceholder;
    const value = context[key];
    return value === undefined ? '' : String(value);
  });
}

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

const SEMVER_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Parse `1.2.3`, `v1.2.3`, `1.2.3-rc.1+build` → parts, or null. */
export function parseSemver(input: string): SemverParts | null {
  const match = SEMVER_PATTERN.exec(input.trim());
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    build: match[5],
  };
}

export function formatSemver(parts: SemverParts): string {
  let result = `${parts.major}.${parts.minor}.${parts.patch}`;
  if (parts.prerelease) result += `-${parts.prerelease}`;
  if (parts.build) result += `+${parts.build}`;
  return result;
}

export type SemverBump = 'major' | 'minor' | 'patch';

/** Bump one component; any prerelease/build metadata is dropped (a bump is a new release). */
export function bumpSemver(version: string, bump: SemverBump): string | null {
  const parts = parseSemver(version);
  if (!parts) return null;
  const next: SemverParts = { major: parts.major, minor: parts.minor, patch: parts.patch };
  if (bump === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (bump === 'minor') {
    next.minor += 1;
    next.patch = 0;
  } else {
    next.patch += 1;
  }
  return formatSemver(next);
}

export interface TagNameValidation {
  valid: boolean;
  error?: string;
  /** The version embedded in the name, when the template has a version slot. */
  version?: string;
}

/**
 * Validate a rendered tag name against its template: shape rules for every
 * template plus semver rules for version-slot templates.
 */
export function validateTagName(
  template: string,
  name: string,
  context: TemplateContext
): TagNameValidation {
  const trimmed = name.trim();
  if (trimmed === '') return { valid: false, error: 'Enter a tag name' };
  if (/\s/.test(trimmed)) return { valid: false, error: 'Tag names cannot contain spaces' };
  if (trimmed.includes('..') || trimmed.includes('//')) {
    return { valid: false, error: 'Tag name has an empty path segment' };
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return { valid: false, error: 'Tag name cannot start or end with /' };
  }
  if (trimmed.includes('://')) {
    return { valid: false, error: 'Tag name cannot contain a URL' };
  }

  const preset = TAG_TEMPLATE_PRESETS.find((entry) => entry.template === template);
  const requiresSemver = preset?.requiresSemver ?? template.includes('{version}');
  if (!requiresSemver) {
    return { valid: true, version: context.version };
  }

  // Extract the version from the rendered name using the template shape.
  const version = extractVersionFromRenderedName(template, trimmed) ?? context.version ?? '';
  if (version === '') {
    return { valid: false, error: 'This template needs a x.y.z version', version: undefined };
  }
  if (parseSemver(version) === null) {
    return {
      valid: false,
      error: `'${version}' is not a valid semver version (use x.y.z, e.g. 1.4.0)`,
      version,
    };
  }
  return { valid: true, version };
}

/**
 * Pull the `{version}` slot back out of a rendered name by turning the
 * template into a regex (`release/{version}` → `^release/(.+)$`). Returns null
 * when the template has no version slot or the name does not match the shape.
 */
export function extractVersionFromRenderedName(template: string, name: string): string | null {
  if (!template.includes('{version}')) return null;
  const pattern = new RegExp(
    `^${template
      .split('{version}')
      .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('(.+?)')}$`
  );
  const match = pattern.exec(name);
  return match ? match[1] : null;
}

/**
 * Highest semver version detectable in existing tag names for a template
 * (e.g. `release/1.2.0` under `release/{version}`), for the increment buttons.
 */
export function detectLatestVersion(tagNames: readonly string[], template: string): string | null {
  let latest: SemverParts | null = null;
  let latestText: string | null = null;
  for (const name of tagNames) {
    const base = name.split('/').pop() ?? name;
    const candidates = [extractVersionFromRenderedName(template, name), base, name];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parts = parseSemver(candidate);
      if (!parts) continue;
      if (
        latest === null ||
        parts.major !== latest.major ||
        parts.minor !== latest.minor ||
        parts.patch !== latest.patch
      ) {
        const isNewer =
          latest === null ||
          parts.major > latest.major ||
          (parts.major === latest.major && parts.minor > latest.minor) ||
          (parts.major === latest.major &&
            parts.minor === latest.minor &&
            parts.patch > latest.patch);
        if (isNewer) {
          latest = parts;
          latestText = candidate;
        }
      }
      break;
    }
  }
  return latestText;
}

/**
 * Suggest the next name for a bump: bump the latest detected version (or
 * 0.0.0/1.0.0 when none) and re-render the template.
 */
export function suggestBumpedName(
  template: string,
  latestVersion: string | null,
  rev: number | string | undefined,
  bump: SemverBump
): string {
  const base = latestVersion && parseSemver(latestVersion) ? latestVersion : '0.0.0';
  const bumped = bumpSemver(base, bump) ?? base;
  return applyTagTemplate(template, { version: bumped, rev });
}

/** Join a tags-directory URL with a relative tag name without double slashes. */
export function joinTagUrl(destinationUrl: string, name: string): string {
  const base = destinationUrl.replace(/\/+$/, '');
  const relative = name.replace(/^\/+/, '');
  return relative === '' ? base : `${base}/${relative}`;
}

/** The pre-filled log message: "Tag {version} from {source}@r{rev}". */
export function defaultTagCommitMessage(
  version: string,
  source: string,
  rev: number | string | undefined
): string {
  const atRev = rev === undefined || rev === '' ? '' : `@r${rev}`;
  return `Tag ${version} from ${source}${atRev}`;
}

export interface SvnCopyCommandInput {
  source: string;
  /** Peg/operative revision; HEAD when undefined. */
  revision?: number | string;
  destinationUrl: string;
  message: string;
  /** "Working copy" copies uncommitted local edits too (svn copy PATH URL). */
  fromWorkingCopy: boolean;
}

function escapeShellArgument(value: string): string {
  return /[^\w/:._@-]/.test(value) ? `"${value}"` : value;
}

/**
 * The exact `svn copy` command the wizard will run, for the dry-run summary.
 * Mirrors how the IPC backend builds the real invocation (src URL[@rev] dst).
 */
export function buildSvnCopyCommand(input: SvnCopyCommandInput): string {
  const source = input.source;
  const revisionSuffix =
    input.revision === undefined || input.revision === '' || String(input.revision).toUpperCase() === 'HEAD'
      ? ''
      : `@${input.revision}`;
  return [
    'svn copy',
    escapeShellArgument(`${source}${revisionSuffix}`),
    escapeShellArgument(input.destinationUrl),
    '-m',
    escapeShellArgument(input.message),
  ].join(' ');
}
