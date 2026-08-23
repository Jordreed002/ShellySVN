import type {
  RevpropConfirmation,
  RevpropEditResult,
  RevpropValueResult,
} from '@shared/types';
import { getSvnReadError } from '../utils/svn-errors';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { runSvnText } from './svn-executor';
import { getNetworkOptionsForUrl } from './svn-network-context';

// Backlog item #70 (backend): revision-property editing with an explicit
// confirmation gate. Revprop writes (svn:log, svn:author, ...) are history
// rewrites: every edit is logged by the repository's pre-revprop-change hook,
// so the caller must obtain both a plain confirmation AND an explicit
// acknowledgement that the server keeps an audit trail.
//
// The RevpropConfirmation / RevpropEditResult / RevpropValueResult shapes
// live in @shared/types (they cross IPC); they are re-exported here for
// compatibility with existing main-process imports.

export type {
  RevpropConfirmation,
  RevpropEditResult,
  RevpropRejectionReason,
  RevpropValueResult,
} from '@shared/types';

// Local pure URL validation (src/main/utils/svn-url.ts is authored in
// parallel this round; delegate once it lands). Revprop targets are always
// remote URLs — a working-copy path has no revprops of its own.
const ALLOWED_REVPROP_PROTOCOLS = /^(?:https?|svn(?:\+ssh)?|file):\/\//i;
const MAX_REVPROP_URL_LENGTH = 8 * 1024;
const MAX_REVPROP_VALUE_LENGTH = 1024 * 1024;

function validateRevpropUrl(value: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'Repository URL is required.';
  if (value.length > MAX_REVPROP_URL_LENGTH) return 'Repository URL exceeds the maximum length.';
  if (/[\u0000\r\n]/.test(value)) return 'Repository URL contains invalid control characters.';
  if (!ALLOWED_REVPROP_PROTOCOLS.test(value)) {
    return 'Revision properties are addressed by absolute repository URL.';
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) return 'Repository URL must not embed credentials.';
    if (url.hash) return 'Repository URL must not contain a fragment.';
  } catch {
    return 'Repository URL is not a well-formed absolute URL.';
  }
  return undefined;
}

/** Locale-independent revision form for revprop addressing: a number or HEAD. */
function normalizeRevision(revision: number | string): string | undefined {
  const value = typeof revision === 'number' ? String(revision) : String(revision ?? '').trim();
  return /^(?:\d+|HEAD)$/i.test(value) ? value.toUpperCase() : undefined;
}

function validatePropertyName(name: string): string | undefined {
  if (typeof name !== 'string') return 'Property name must be a string.';
  const trimmed = name.trim();
  if (!trimmed) return 'Property name is required.';
  if (/[\u0000\r\n]/.test(name)) return 'Property name contains invalid control characters.';
  if (trimmed.startsWith('-')) return 'Property name must not begin with an option prefix.';
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(trimmed)) {
    return 'Property name must begin with a letter or underscore and contain only letters, numbers, ".", "-", "_", or ":".';
  }
  return undefined;
}

function validatePropertyValue(value: string): string | undefined {
  if (typeof value !== 'string') return 'Property value must be a string.';
  if (value.length > MAX_REVPROP_VALUE_LENGTH) {
    return 'Property value exceeds the maximum supported length.';
  }
  if (/\u0000/.test(value)) return 'Property value contains invalid control characters.';
  return undefined;
}

/** Read one revision property (`svn propget --revprop`). */
export async function getRevprop(
  url: string,
  revision: number | string,
  propName: string
): Promise<RevpropValueResult> {
  const urlIssue = validateRevpropUrl(url);
  const normalizedRevision = normalizeRevision(revision);
  const nameIssue = validatePropertyName(propName);
  try {
    if (urlIssue) throw new Error(urlIssue);
    if (!normalizedRevision) throw new Error('Revision must be a positive integer or HEAD.');
    if (nameIssue) throw new Error(nameIssue);
    validateSvnTargets([url], 'Revision property target');
    const value = await runSvnText(
      withSvnTargets(['propget', '--revprop', '-r', normalizedRevision, propName.trim()], [url]),
      await getNetworkOptionsForUrl(url)
    );
    return { value };
  } catch (error) {
    return { ...getSvnReadError(error, { command: 'propget --revprop', target: url }) };
  }
}

/**
 * Edit one revision property (`svn propset --revprop`). Requires the full
 * confirmation payload — both `confirmed` and `acknowledgedServerLogging`
 * literal true — or the call is rejected without touching the repository.
 *
 * `svn propset --revprop` needs no `--with-revprop` propagation (that flag is
 * for log/info retrieval); the repository's pre-revprop-change hook governs
 * the server side and provides the audit trail the acknowledgement refers to.
 */
export async function editRevprop(
  url: string,
  revision: number | string,
  propName: string,
  newValue: string,
  confirmation?: RevpropConfirmation
): Promise<RevpropEditResult> {
  const base = {
    url,
    revision: String(revision ?? ''),
    propName: typeof propName === 'string' ? propName.trim() : '',
  };

  if (!confirmation || confirmation.confirmed !== true) {
    return {
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      ...base,
      error: 'Revision property edits require explicit user confirmation.',
    };
  }
  if (confirmation.acknowledgedServerLogging !== true) {
    return {
      success: false,
      reason: 'SERVER_LOGGING_NOT_ACKNOWLEDGED',
      ...base,
      error:
        'The user must acknowledge that the repository logs every revision-property change ' +
        '(pre-revprop-change hook) before editing.',
    };
  }

  const urlIssue = validateRevpropUrl(url);
  if (urlIssue) {
    return { success: false, reason: 'INVALID_URL', ...base, error: urlIssue };
  }
  const normalizedRevision = normalizeRevision(revision);
  if (!normalizedRevision) {
    return {
      success: false,
      reason: 'INVALID_REVISION',
      ...base,
      error: 'Revision must be a positive integer or HEAD.',
    };
  }
  const nameIssue = validatePropertyName(propName);
  if (nameIssue) {
    return { success: false, reason: 'INVALID_PROPERTY_NAME', ...base, error: nameIssue };
  }
  const valueIssue = validatePropertyValue(newValue);
  if (valueIssue) {
    return { success: false, reason: 'INVALID_VALUE', ...base, error: valueIssue };
  }
  validateSvnTargets([url], 'Revision property target');

  try {
    await runSvnText(
      withSvnTargets(
        ['propset', '--revprop', '-r', normalizedRevision, propName.trim(), newValue],
        [url]
      ),
      await getNetworkOptionsForUrl(url)
    );
    return { success: true, url, revision: normalizedRevision, propName: propName.trim() };
  } catch (error) {
    return {
      success: false,
      reason: 'SVN_ERROR',
      url,
      revision: normalizedRevision,
      propName: propName.trim(),
      ...getSvnReadError(error, { command: 'propset --revprop', target: url }),
    };
  }
}
