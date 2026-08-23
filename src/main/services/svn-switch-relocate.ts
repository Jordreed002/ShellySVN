import type {
  SwitchRelocateInput,
  SwitchRelocateIssue,
  SwitchRelocateSummary,
  SwitchRelocateValidationResult,
} from '@shared/types';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseSvnInfoXml } from '../svn/parsers';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { classifySvnCommandError } from '../utils/svn-errors';
import { runSvnText } from './svn-executor';
import { getNetworkOptionsForUrl } from './svn-network-context';

// Backlog item #50 (backend half): pre-flight validation for `svn switch` /
// `svn relocate`. The dialog (IPC wiring lands with the integration agent)
// calls this BEFORE executing svn-repository-ops' switchWorkingCopy /
// relocateWorkingCopy so it can render a dry-run summary and block obviously
// invalid operations without touching the working copy.
//
// The SwitchRelocate* shapes live in @shared/types (they cross IPC); they are
// re-exported here for compatibility with existing main-process imports.

export type {
  SwitchRelocateInput,
  SwitchRelocateIssue,
  SwitchRelocateIssueCode,
  SwitchRelocateKind,
  SwitchRelocateSummary,
  SwitchRelocateValidationResult,
} from '@shared/types';

// Local pure URL validation. src/main/utils/svn-url.ts is being authored in
// parallel this round; once it lands, this can delegate to it. Rules mirror
// svn-intelligence-validation's repository URL checks without its IPC-path
// assertions, which do not apply to remote targets.
const ALLOWED_TARGET_PROTOCOLS = new Set(['https:', 'http:', 'svn:', 'svn+ssh:', 'file:']);
const MAX_TARGET_URL_LENGTH = 8 * 1024;
const MAX_ADMIN_DIR_ANCESTORS = 50;

function invalidUrlIssue(message: string): { issue: SwitchRelocateIssue } {
  return { issue: { code: 'INVALID_TARGET_URL', message, severity: 'error' } };
}

function validateTargetUrl(value: string): { url?: URL; issue?: SwitchRelocateIssue } {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidUrlIssue('Target URL is required.');
  }
  if (value.length > MAX_TARGET_URL_LENGTH) {
    return invalidUrlIssue('Target URL exceeds the maximum supported length.');
  }
  if (/[\u0000\r\n]/.test(value)) {
    return invalidUrlIssue('Target URL contains invalid control characters.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidUrlIssue('Target URL must be absolute (e.g. https://host/repo/trunk).');
  }
  if (!ALLOWED_TARGET_PROTOCOLS.has(url.protocol) || !url.pathname) {
    return invalidUrlIssue(
      `Target URL must use one of: ${[...ALLOWED_TARGET_PROTOCOLS].join(', ')}.`
    );
  }
  if (url.username || url.password) {
    return invalidUrlIssue('Target URL must not embed credentials.');
  }
  if (url.hash) return invalidUrlIssue('Target URL must not contain a fragment.');
  return { url };
}

function toUrlSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/** Longest shared path-segment prefix ("a/b" style, no scheme/host). */
function commonUrlRoot(current: URL, target: URL): { path: string; depth: number } {
  const currentSegments = toUrlSegments(current);
  const targetSegments = toUrlSegments(target);
  const shared: string[] = [];
  for (let index = 0; index < Math.min(currentSegments.length, targetSegments.length); index += 1) {
    if (currentSegments[index] !== targetSegments[index]) break;
    shared.push(currentSegments[index]);
  }
  return { path: shared.join('/'), depth: shared.length };
}

function normalizeUrlString(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase();
}

/** Locate the nearest ancestor (including `path`) that owns a `.svn` admin dir. */
async function findWorkingCopyRoot(path: string): Promise<string | null> {
  let current = path;
  for (let attempts = 0; attempts < MAX_ADMIN_DIR_ANCESTORS; attempts += 1) {
    try {
      if ((await stat(join(current, '.svn'))).isDirectory()) return current;
    } catch {
      // Not the admin root — try the parent.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function isTargetNotFoundError(error: unknown): boolean {
  const details = classifySvnCommandError(error);
  return (
    details.category === 'not-found' || /\b(?:E160013|E200009)\b/.test(details.message) === true
  );
}

export async function validateSwitchOrRelocate(
  input: SwitchRelocateInput
): Promise<SwitchRelocateValidationResult> {
  const { kind, workingCopyPath } = input;
  const issues: SwitchRelocateIssue[] = [];
  const summary: SwitchRelocateSummary = {
    kind,
    workingCopyPath,
    targetUrl: input.targetUrl,
  };

  const pushIssue = (issue: SwitchRelocateIssue) => {
    issues.push(issue);
  };

  // 1. Pure target URL validation — never hand an unvalidated URL to svn.
  const target = validateTargetUrl(input.targetUrl);
  if (target.issue) {
    pushIssue(target.issue);
  }

  // 2. Local working-copy existence check (the path or an ancestor owns .svn).
  validateSvnTargets([workingCopyPath], 'Working copy path');
  const adminRoot = await findWorkingCopyRoot(workingCopyPath);
  if (!adminRoot) {
    pushIssue({
      code: 'MISSING_WORKING_COPY',
      message: `${workingCopyPath} is not inside a working copy (no .svn directory found).`,
      severity: 'error',
    });
  }

  const hasErrors = () => issues.some((issue) => issue.severity === 'error');
  if (hasErrors()) {
    return { ok: false, issues, summary };
  }

  // 3. Read the current working-copy URL from `svn info` (mockable runner).
  const targetUrl = (target.url as URL).toString();
  summary.targetUrl = targetUrl;
  try {
    const infoXml = await runSvnText(withSvnTargets(['info', '--xml'], [workingCopyPath]));
    const info = parseSvnInfoXml(infoXml);
    if (!info.url) throw new Error('svn info returned no URL for the working copy.');
    summary.currentUrl = info.url;
    summary.repositoryRoot = info.repositoryRoot || undefined;
    summary.repositoryUuid = info.repositoryUuid || undefined;

    const currentUrl = new URL(info.url);
    const onTarget = normalizeUrlString(info.url) === normalizeUrlString(targetUrl);

    if (kind === 'relocate') {
      if (onTarget) {
        pushIssue({
          code: 'RELOCATE_TARGET_UNCHANGED',
          message: 'The working copy URL already matches the relocation target.',
          severity: 'error',
        });
      }
      const common = commonUrlRoot(currentUrl, target.url as URL);
      summary.commonRootPath = common.path;
      if (common.depth === 0) {
        pushIssue({
          code: 'NO_COMMON_ROOT',
          message:
            'The relocation target shares no path with the current URL. ' +
            'Cross-repository or unrelated targets require a fresh checkout, not relocate.',
          severity: 'error',
        });
      } else if (common.depth === 1) {
        pushIssue({
          code: 'SHALLOW_COMMON_ROOT',
          message:
            'The relocation target shares only one path segment with the current URL. ' +
            'Verify the new repository location before continuing.',
          severity: 'warning',
        });
      }
      const repositoryRoot = summary.repositoryRoot;
      if (repositoryRoot && !onTarget) {
        const normalizedRoot = normalizeUrlString(repositoryRoot);
        const normalizedTarget = normalizeUrlString(targetUrl);
        const sameOrigin =
          currentUrl.origin.toLowerCase() === (target.url as URL).origin.toLowerCase();
        if (sameOrigin && normalizedTarget.startsWith(`${normalizedRoot}/`)) {
          pushIssue({
            code: 'RELOCATE_WITHIN_REPOSITORY',
            message:
              'The target is inside the current repository. Moving within a repository ' +
              'is a switch, not a relocate.',
            severity: 'warning',
          });
        }
      }
    } else if (onTarget) {
      pushIssue({
        code: 'ALREADY_ON_TARGET',
        message: 'The working copy is already switched to the target URL.',
        severity: 'warning',
      });
    }
  } catch (error) {
    pushIssue({
      code: 'WORKING_COPY_INFO_UNAVAILABLE',
      message: `Unable to read working-copy info: ${
        classifySvnCommandError(error).message
      }`,
      severity: 'error',
    });
    return { ok: false, issues, summary };
  }

  // 4. Switch dry-run probe: the target's head revision + repository identity.
  if (kind === 'switch' && input.includeTargetRevision !== false && !hasErrors()) {
    try {
      const targetXml = await runSvnText(
        withSvnTargets(['info', '--xml'], [targetUrl]),
        await getNetworkOptionsForUrl(targetUrl)
      );
      const targetInfo = parseSvnInfoXml(targetXml);
      summary.targetHeadRevision = targetInfo.revision || undefined;
      summary.targetRepositoryRoot = targetInfo.repositoryRoot || undefined;
      summary.targetRepositoryUuid = targetInfo.repositoryUuid || undefined;

      if (
        summary.repositoryUuid &&
        targetInfo.repositoryUuid &&
        summary.repositoryUuid !== targetInfo.repositoryUuid
      ) {
        pushIssue({
          code: 'REPOSITORY_UUID_MISMATCH',
          message:
            'The target belongs to a different repository. svn switch only works ' +
            'within the working copy repository.',
          severity: 'error',
        });
      }
    } catch (error) {
      if (isTargetNotFoundError(error)) {
        pushIssue({
          code: 'TARGET_NOT_FOUND',
          message: `The target URL does not exist: ${classifySvnCommandError(error).message}`,
          severity: 'error',
        });
      } else {
        summary.targetHeadUnavailable = true;
        pushIssue({
          code: 'TARGET_INFO_UNAVAILABLE',
          message: `Could not read the target head revision: ${
            classifySvnCommandError(error).message
          }`,
          severity: 'warning',
        });
      }
    }
  }

  return { ok: !hasErrors(), issues, summary };
}
