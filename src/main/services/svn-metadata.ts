import type {
  SvnChangelistResult,
  SvnExternal,
  SvnExternalsResult,
  SvnListResult,
  SvnMutationResult,
  SvnPropertyGetOptions,
  SvnPropertyListResult,
  SvnPropertyValueResult,
  SvnRepoLayout,
  SvnRepoLayoutDir,
  SvnRepoLayoutKind,
  SvnShelveListResult,
} from '@shared/types';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseSvnExternals, parseSvnInfoXml, parseSvnListXml } from '../svn/parsers';
import {
  parseSvnPropertiesXml,
  parseSvnShelvesXml,
  parseSvnStatusEntriesXml,
} from '../utils/svn-xml';
import { debug } from '../utils/debug';
import { getSvnReadError } from '../utils/svn-errors';
import { requireSvnRevision, SvnRevisionError } from '../utils/svn-revision';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { joinRepoUrl, normalizeRepoUrl } from '../utils/svn-url';
import { runSvnMuccText, runSvnText } from './svn-executor';
import { isNativeShelvingSupported } from './svn-capabilities';
import { getNetworkOptionsForWorkingCopyPath } from './svn-network-context';

const SHELVING_UNSUPPORTED_MESSAGE =
  'SVN shelving is not available from the active SVN binary. Use an SVN client build with shelve/unshelve support to enable this workflow.';

function assertSafeName(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (/[\u0000\r\n]/.test(value)) throw new Error(`${label} contains invalid control characters`);
  if (value.startsWith('-')) throw new Error(`${label} must not begin with an option prefix`);
}

function metadataFailure(error: unknown, fallback?: string): SvnMutationResult {
  const detail = getSvnReadError(error);
  return {
    success: false,
    ...detail,
    ...(!detail.error && fallback ? { error: fallback } : {}),
  };
}

function assertPropertyName(name: string): void {
  assertSafeName(name, 'Property name');
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name.trim())) {
    throw new Error(
      'Property name must begin with a letter or underscore and contain only letters, numbers, ".", "-", "_", or ":"'
    );
  }
}

function assertRelativeExternalPath(path: string): void {
  assertSafeName(path, 'External local path');
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('External local path must stay within the selected working copy');
  }
}

/**
 * Recognizes the different ways an SVN client reports missing shelving
 * support. Some clients answer `svn help shelve` with an unknown-command
 * error, and TortoiseSVN's CLI additionally validates options before it
 * resolves the subcommand, so `shelve --list` there fails with
 * `invalid option: --list` instead of anything naming the command — the
 * caller's args disambiguate that case.
 */
function getShelvingUnsupportedReason(
  error: unknown,
  args: string[] = []
): string | null {
  const message = error instanceof Error ? error.message : String(error || '');
  const shelvingCommand = args[0] === 'shelve' || args[0] === 'unshelve';
  const unknownCommand =
    /unknown (?:command|subcommand)/i.test(message) &&
    /\b(?:shelve|unshelve)\b/i.test(message);
  const rejectedOption = shelvingCommand && /invalid option/i.test(message);
  return unknownCommand || rejectedOption ? SHELVING_UNSUPPORTED_MESSAGE : null;
}

function isMissingPropertyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /\bW200017\b|\bE200000\b|property ['"].*['"] (?:not found|does not exist)/i.test(message);
}

export async function listRepository(
  url: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  credentials?: { username: string; password: string }
): Promise<SvnListResult> {
  // Canonicalize the listing root (IDN/IPv6 hosts, percent-encoded segments,
  // trailing slashes) so children are joined onto a stable base and cache
  // keys derived from `path` match across browsing sessions.
  const rootUrl = normalizeRepoUrl(url);
  try {
    const args = ['list', '--xml', '--non-interactive'];
    if (revision) args.push('-r', assertRevision(revision, 'list revision'));
    if (depth) args.push('--depth', depth);
    const xml = await runSvnText(withSvnTargets(args, [rootUrl]), { credentials });
    return parseRepositoryListing(xml, rootUrl);
  } catch (error) {
    return {
      path: rootUrl,
      entries: [],
      ...getSvnReadError(error, { command: 'list', target: rootUrl }),
    };
  }
}

/**
 * Parse `svn list --xml` output into entries whose child URLs are built with
 * the shared URL utilities. `svn list --xml` emits DECODED entry names
 * (`Répo Dir`, a literal `a%20b.txt`), so naive `baseUrl + '/' + name`
 * concatenation produces URLs that SVN resolves to different paths; each
 * name is re-encoded exactly once here.
 */
export function parseRepositoryListing(xml: string, rootUrl: string): SvnListResult {
  const canonicalRoot = normalizeRepoUrl(rootUrl);
  const parsed = parseSvnListXml(xml, canonicalRoot);
  const entries = parsed.entries.map((entry) => {
    const childUrl = joinRepoUrl(canonicalRoot, entry.name.replace(/\/+$/, ''));
    return { ...entry, path: childUrl, url: childUrl };
  });
  return { ...parsed, path: canonicalRoot, entries };
}

// ============================================
// Repository layout detection (data-only; the renderer decides presentation)
// ============================================
//
// The SvnRepoLayoutKind / SvnRepoLayoutDir / SvnRepoLayout shapes live in
// @shared/types (the layout crosses IPC); re-exported here for compatibility
// with existing main-process imports.

export type { SvnRepoLayout, SvnRepoLayoutDir, SvnRepoLayoutKind } from '@shared/types';

const LAYOUT_DIR_NAMES = new Set(['trunk', 'branches', 'tags']);

/**
 * Classify repository root entries into a layout description without
 * assuming a trunk URL: 'standard' (trunk+branches+tags), 'trunk-only',
 * 'custom' (any other shape, including empty folders), or 'empty' (r0
 * repository — a root with no entries at youngest revision 0).
 */
export function classifyRepoLayout(
  rootUrl: string,
  entries: Array<{ name: string; kind: 'file' | 'dir' }>,
  youngestRevision: number
): Omit<SvnRepoLayout, 'error' | 'errorCode' | 'cancelled' | 'partial' | 'commandError'> {
  const canonicalRoot = normalizeRepoUrl(rootUrl);
  const empty = youngestRevision === 0 && entries.length === 0;

  const layoutDirs = new Map<string, string>();
  const customDirs: SvnRepoLayoutDir[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\/+$/, '');
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (entry.kind === 'dir' && LAYOUT_DIR_NAMES.has(lowerName) && !layoutDirs.has(lowerName)) {
      layoutDirs.set(lowerName, joinRepoUrl(canonicalRoot, name));
    } else {
      customDirs.push({ name, url: joinRepoUrl(canonicalRoot, name), kind: entry.kind });
    }
  }

  const kind: SvnRepoLayoutKind = empty
    ? 'empty'
    : layoutDirs.has('trunk') && layoutDirs.has('branches') && layoutDirs.has('tags')
      ? 'standard'
      : layoutDirs.has('trunk')
        ? 'trunk-only'
        : 'custom';

  return {
    kind,
    rootUrl: canonicalRoot,
    ...(layoutDirs.has('trunk') && { trunk: layoutDirs.get('trunk') }),
    ...(layoutDirs.has('branches') && { branches: layoutDirs.get('branches') }),
    ...(layoutDirs.has('tags') && { tags: layoutDirs.get('tags') }),
    customDirs,
    empty,
    youngestRevision,
  };
}

/**
 * Detect the trunk/branches/tags layout of a repository root. Runs
 * `svn info` (youngest revision; r0 repositories answer revision 0) and
 * `svn list --depth immediates`, then returns structured layout data —
 * never throws and never assumes a trunk URL for non-conventional layouts.
 * When either command fails the result carries the structured error with
 * `empty: false` (emptiness is only claimed from successful answers).
 */
export async function getRepositoryLayout(
  url: string,
  credentials?: { username: string; password: string }
): Promise<SvnRepoLayout> {
  const rootUrl = normalizeRepoUrl(url);
  let youngestRevision = 0;
  let infoFailure: ReturnType<typeof getSvnReadError> | null = null;
  try {
    const infoXml = await runSvnText(
      withSvnTargets(['info', '--xml', '--non-interactive'], [rootUrl]),
      { credentials }
    );
    const info = parseSvnInfoXml(infoXml);
    if (info.parseError) throw new Error(info.parseError);
    youngestRevision = info.revision;
  } catch (error) {
    infoFailure = getSvnReadError(error, { command: 'info', target: rootUrl });
  }

  const listing = await listRepository(rootUrl, undefined, 'immediates', credentials);
  if (listing.error || listing.commandError) {
    // The listing is the classification input; without it no layout (and no
    // emptiness) can be claimed — report the structured failure as data.
    return {
      kind: 'custom',
      rootUrl,
      customDirs: [],
      empty: false,
      youngestRevision,
      error: listing.error,
      errorCode: listing.errorCode,
      cancelled: listing.cancelled,
      partial: listing.partial,
      commandError: listing.commandError,
    };
  }
  if (infoFailure?.error) {
    const layout = classifyRepoLayout(rootUrl, listing.entries, youngestRevision);
    return {
      // An unknown youngest revision cannot prove an r0 repository.
      ...(layout.empty ? { ...layout, kind: 'custom' as const, empty: false } : layout),
      error: infoFailure.error,
      errorCode: infoFailure.errorCode,
      cancelled: infoFailure.cancelled,
      commandError: infoFailure.commandError,
    };
  }
  return classifyRepoLayout(rootUrl, listing.entries, youngestRevision);
}

export async function changelistAdd(
  paths: string[],
  changelist: string
): Promise<SvnMutationResult> {
  assertSafeName(changelist, 'Changelist name');
  validateSvnTargets(paths, 'Changelist target');
  await runSvnText(withSvnTargets(['changelist', changelist], paths));
  return { success: true };
}

export async function changelistRemove(paths: string[]): Promise<SvnMutationResult> {
  validateSvnTargets(paths, 'Changelist target');
  await runSvnText(withSvnTargets(['changelist', '--remove'], paths));
  return { success: true };
}

export async function changelistList(path: string): Promise<SvnChangelistResult> {
  try {
    const xml = await runSvnText(withSvnTargets(['status', '--xml'], [path]));
    const changelists: Map<string, string[]> = new Map();
    const defaultFiles: string[] = [];

    for (const entry of parseSvnStatusEntriesXml(xml)) {
      if (entry.changelist) {
        if (!changelists.has(entry.changelist)) {
          changelists.set(entry.changelist, []);
        }
        changelists.get(entry.changelist)!.push(entry.path);
      } else {
        defaultFiles.push(entry.path);
      }
    }

    return {
      changelists: Array.from(changelists.entries()).map(([name, files]) => ({ name, files })),
      defaultFiles,
    };
  } catch (error) {
    debug.error('[SVN] Changelist list error:', error);
    return { changelists: [], defaultFiles: [], ...getSvnReadError(error) };
  }
}

export async function changelistDelete(name: string, path: string): Promise<SvnMutationResult> {
  assertSafeName(name, 'Changelist name');
  validateSvnTargets([path], 'Changelist target');
  try {
    const xml = await runSvnText(withSvnTargets(['status', '--xml'], [path]));
    const filesToRemove = parseSvnStatusEntriesXml(xml)
      .filter((entry) => entry.changelist === name)
      .map((entry) => entry.path);

    if (filesToRemove.length > 0) {
      validateSvnTargets(filesToRemove, 'Changelist target');
      await runSvnText(withSvnTargets(['changelist', '--remove'], filesToRemove));
    }

    return { success: true };
  } catch (error) {
    debug.error('[SVN] Changelist delete error:', error);
    return metadataFailure(error);
  }
}

export async function shelveList(path: string): Promise<SvnShelveListResult> {
  const runPortable = async (): Promise<SvnShelveListResult> => {
    const { portableShelfList } = await import('./svn-portable-shelves');
    return portableShelfList(path);
  };
  const args = ['shelve', '--list', '--xml'];
  // TortoiseSVN's CLI ships no shelving commands at all; probe before
  // spawning so it goes straight to the portable-shelf store.
  if (!(await isNativeShelvingSupported())) return runPortable();
  try {
    return { shelves: parseSvnShelvesXml(await runSvnText(withSvnTargets(args, [path]))) };
  } catch (error) {
    if (getShelvingUnsupportedReason(error, args)) return runPortable();
    return { shelves: [], ...getSvnReadError(error) };
  }
}

export async function shelveSave(
  name: string,
  path: string,
  message?: string
): Promise<SvnMutationResult> {
  assertSafeName(name, 'Shelf name');
  validateSvnTargets([path], 'Shelf target');
  const runPortable = async (): Promise<SvnMutationResult> => {
    const { portableShelfSave } = await import('./svn-portable-shelves');
    return portableShelfSave(name, path, message);
  };
  const args = ['shelve', name];
  if (message) args.push('-m', message);
  if (!(await isNativeShelvingSupported())) return runPortable();
  try {
    await runSvnText(withSvnTargets(args, [path]));
    return { success: true };
  } catch (error) {
    if (getShelvingUnsupportedReason(error, args)) return runPortable();
    return metadataFailure(error);
  }
}

export async function shelveApply(name: string, path: string): Promise<SvnMutationResult> {
  assertSafeName(name, 'Shelf name');
  validateSvnTargets([path], 'Shelf target');
  const runPortable = async (): Promise<SvnMutationResult> => {
    const { portableShelfApply } = await import('./svn-portable-shelves');
    return portableShelfApply(name, path);
  };
  const args = ['unshelve', name];
  if (!(await isNativeShelvingSupported())) return runPortable();
  try {
    await runSvnText(withSvnTargets(args, [path]));
    return { success: true };
  } catch (error) {
    if (getShelvingUnsupportedReason(error, args)) return runPortable();
    return metadataFailure(error);
  }
}

export async function shelveDelete(name: string, path: string): Promise<SvnMutationResult> {
  assertSafeName(name, 'Shelf name');
  validateSvnTargets([path], 'Shelf target');
  const runPortable = async (): Promise<SvnMutationResult> => {
    const { portableShelfDelete } = await import('./svn-portable-shelves');
    return portableShelfDelete(name, path);
  };
  const args = ['shelve', '--delete', name];
  if (!(await isNativeShelvingSupported())) return runPortable();
  try {
    await runSvnText(withSvnTargets(args, [path]));
    return { success: true };
  } catch (error) {
    if (getShelvingUnsupportedReason(error, args)) return runPortable();
    return metadataFailure(error);
  }
}

export async function proplist(
  path: string,
  options: SvnPropertyGetOptions = {}
): Promise<SvnPropertyListResult> {
  try {
    const args = ['proplist', '--xml', '-v'];
    if (options.revision) {
      args.push('-r', assertRevision(options.revision, 'proplist revision'));
    }
    if (options.depth) args.push('--depth', options.depth);
    if (options.showInherited) args.push('--show-inherited-props');
    const output = await runSvnText(withSvnTargets(args, [path]));
    return { properties: parseSvnPropertiesXml(output) };
  } catch (error) {
    return {
      properties: [],
      ...getSvnReadError(error, { command: 'proplist', target: path }),
    };
  }
}

/**
 * Revision grammar lives in `utils/svn-revision` (single source of truth);
 * this adapter only keeps the historical "Invalid SVN revision" error
 * phrasing so the renderer-side validation classification is unchanged.
 */
function assertRevision(revision: string, field: string): string {
  try {
    return requireSvnRevision(revision, field);
  } catch (error) {
    if (error instanceof SvnRevisionError) {
      throw new Error(`Invalid SVN revision: ${error.message}`);
    }
    throw error;
  }
}

export async function propget(
  target: string,
  name: string,
  options: SvnPropertyGetOptions = {}
): Promise<SvnPropertyValueResult> {
  try {
    assertPropertyName(name);
    validateSvnTargets([target], 'Property target');
    const args = ['propget', name];
    if (options.revision) {
      args.push('-r', assertRevision(options.revision, 'propget revision'));
    }
    if (options.depth) args.push('--depth', options.depth);
    if (options.showInherited) args.push('--show-inherited-props');
    return { value: await runSvnText(withSvnTargets(args, [target])) };
  } catch (error) {
    return {
      ...getSvnReadError(error, { command: 'propget', target }),
    };
  }
}

export async function propset(
  path: string,
  name: string,
  value: string
): Promise<SvnMutationResult> {
  assertPropertyName(name);
  validateSvnTargets([path], 'Property target');
  await runSvnText(withSvnTargets(['propset', name, value], [path]));
  return { success: true };
}

export async function propdel(path: string, name: string): Promise<SvnMutationResult> {
  assertPropertyName(name);
  validateSvnTargets([path], 'Property target');
  await runSvnText(withSvnTargets(['propdel', name], [path]));
  return { success: true };
}

export async function propsetRemote(
  url: string,
  name: string,
  value: string,
  message: string
): Promise<SvnMutationResult> {
  assertPropertyName(name);
  assertSafeName(message, 'Commit message');
  validateSvnTargets([url], 'Property target');
  if (!/^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(url)) {
    throw new Error('Remote property target must be an SVN URL');
  }
  // `svn propset` only changes versioned properties in a working copy.
  // svnmucc is the supported Subversion client for an atomic URL property
  // change and commit.
  const output = await runSvnMuccText(['-m', message.trim(), 'propset', name.trim(), value, url]);
  return { success: true, output };
}

export async function propdelRemote(
  url: string,
  name: string,
  message: string
): Promise<SvnMutationResult> {
  assertPropertyName(name);
  assertSafeName(message, 'Commit message');
  validateSvnTargets([url], 'Property target');
  if (!/^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(url)) {
    throw new Error('Remote property target must be an SVN URL');
  }
  const output = await runSvnMuccText(['-m', message.trim(), 'propdel', name.trim(), url]);
  return { success: true, output };
}

export async function revpropget(
  target: string,
  name: string,
  revision: string
): Promise<SvnPropertyValueResult> {
  try {
    assertPropertyName(name);
    validateSvnTargets([target], 'Revision property target');
    return {
      value: await runSvnText(
        withSvnTargets(
          ['propget', '--revprop', '-r', assertRevision(revision, 'revprop revision'), name],
          [target]
        )
      ),
    };
  } catch (error) {
    return {
      ...getSvnReadError(error, { command: 'propget --revprop', target }),
    };
  }
}

export async function revpropset(
  target: string,
  name: string,
  value: string,
  revision: string
): Promise<SvnMutationResult> {
  assertPropertyName(name);
  validateSvnTargets([target], 'Revision property target');
  await runSvnText(
    withSvnTargets(
      ['propset', '--revprop', '-r', assertRevision(revision, 'revprop revision'), name, value],
      [target]
    )
  );
  return { success: true };
}

export async function revpropdel(
  target: string,
  name: string,
  revision: string
): Promise<SvnMutationResult> {
  assertPropertyName(name);
  validateSvnTargets([target], 'Revision property target');
  await runSvnText(
    withSvnTargets(
      ['propdel', '--revprop', '-r', assertRevision(revision, 'revprop revision'), name],
      [target]
    )
  );
  return { success: true };
}

export async function externalsList(path: string): Promise<SvnExternalsResult> {
  try {
    const output = await runSvnText(withSvnTargets(['propget', 'svn:externals', '-R'], [path]));
    return { externals: parseSvnExternals(output, path) };
  } catch (error) {
    debug.error('[SVN] Externals list error:', error);
    return { externals: [], ...getSvnReadError(error) };
  }
}

export async function externalsAdd(
  workingCopyPath: string,
  external: Omit<SvnExternal, 'name'> & { name?: string }
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'Externals property target');
  try {
    const extDef = formatExternalDefinition(external);
    let current = '';
    try {
      current = await runSvnText(withSvnTargets(['propget', 'svn:externals'], [workingCopyPath]));
    } catch (error) {
      if (!isMissingPropertyError(error)) throw error;
      // A genuinely absent svn:externals property starts as an empty definition.
    }

    const newValue = current.trim() ? `${current.trim()}\n${extDef}` : extDef;

    await runSvnText(withSvnTargets(['propset', 'svn:externals', newValue], [workingCopyPath]));
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals add error:', error);
    return metadataFailure(error);
  }
}

export async function externalsEdit(
  workingCopyPath: string,
  externalPath: string,
  external: Omit<SvnExternal, 'name'> & { name?: string }
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'Externals property target');
  assertRelativeExternalPath(externalPath);
  try {
    const current = await getExistingExternals(workingCopyPath);
    if (!hasExternalDefinition(current, externalPath)) {
      throw new Error(`External definition "${externalPath}" was not found`);
    }
    const updated = replaceExternalDefinition(
      current,
      externalPath,
      formatExternalDefinition(external)
    );
    await saveExternals(workingCopyPath, updated);
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals edit error:', error);
    return metadataFailure(error);
  }
}

export async function externalsRemove(
  workingCopyPath: string,
  externalPath: string
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'Externals property target');
  assertRelativeExternalPath(externalPath);
  try {
    const current = await getExistingExternals(workingCopyPath);
    await saveExternals(workingCopyPath, removeExternalDefinition(current, externalPath));
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals remove error:', error);
    return metadataFailure(error);
  }
}

export async function externalsUpdate(
  workingCopyPath: string,
  externalPath?: string
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'External update target');
  if (externalPath) assertRelativeExternalPath(externalPath);
  try {
    const targetPath =
      externalPath && workingCopyPath.includes('\\')
        ? `${workingCopyPath.replace(/[\\/]+$/, '')}\\${externalPath.replaceAll('/', '\\')}`
        : externalPath
          ? join(workingCopyPath, externalPath)
          : workingCopyPath;
    const updateTarget = externalPath && !existsSync(targetPath) ? workingCopyPath : targetPath;
    await runSvnText(
      withSvnTargets(['update'], [updateTarget]),
      await getNetworkOptionsForWorkingCopyPath(updateTarget)
    );
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals update error:', error);
    return metadataFailure(error);
  }
}

async function getExistingExternals(workingCopyPath: string): Promise<string> {
  try {
    return await runSvnText(withSvnTargets(['propget', 'svn:externals'], [workingCopyPath]));
  } catch (error) {
    if (isMissingPropertyError(error)) return '';
    throw error;
  }
}

function formatExternalDefinition(external: Omit<SvnExternal, 'name'> & { name?: string }): string {
  const extName = external.name || external.path.split('/').pop() || 'external';
  assertRelativeExternalPath(extName);
  if (
    external.revision !== undefined &&
    (!Number.isSafeInteger(external.revision) || external.revision < 0)
  ) {
    throw new Error('External revision must be a non-negative whole number');
  }
  if (!isSupportedExternalUrl(external.url)) {
    throw new Error('External URL must use an SVN-supported absolute or relative URL format');
  }
  return `${external.revision !== undefined ? `-r${external.revision} ` : ''}${quoteExternalToken(external.url)} ${quoteExternalToken(extName)}`;
}

function isSupportedExternalUrl(value: string): boolean {
  return /^(?:\^\/|\.\.?\/|\/|https?:\/\/|svn(?:\+ssh)?:\/\/|file:\/\/)/i.test(value);
}

function quoteExternalToken(value: string): string {
  return /\s|["']/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function tokenizeExternalDefinition(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const source = line.trim();
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      token += character;
      escaped = false;
    } else if (
      character === '\\' &&
      quote &&
      (source[index + 1] === quote || source[index + 1] === '\\')
    ) {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function getExternalLocalPath(line: string): string | null {
  const tokens = tokenizeExternalDefinition(line);
  if (tokens.length < 2) return null;
  let firstDefinitionToken = 0;
  if (tokens[0] === '-r' || tokens[0] === '--revision') firstDefinitionToken = 2;
  else if (/^(?:-r\d+|--revision=\d+)$/.test(tokens[0])) firstDefinitionToken = 1;
  if (tokens.length - firstDefinitionToken < 2) return null;
  return isSupportedExternalUrl(tokens[firstDefinitionToken])
    ? tokens[tokens.length - 1]
    : tokens[firstDefinitionToken];
}

function normalizeExternalPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function hasExternalDefinition(current: string, externalPath: string): boolean {
  const normalizedTarget = normalizeExternalPath(externalPath);
  return current.split(/\r?\n/).some((line) => {
    if (line.trimStart().startsWith('#')) return false;
    return normalizeExternalPath(getExternalLocalPath(line) || '') === normalizedTarget;
  });
}

function mapExternalDefinitions(
  current: string,
  externalPath: string,
  replacement?: string
): string {
  const lineEnding = current.includes('\r\n') ? '\r\n' : '\n';
  const normalizedTarget = normalizeExternalPath(externalPath);
  let replaced = false;
  const lines = current.split(/\r?\n/).flatMap((line) => {
    if (line.trimStart().startsWith('#')) return [line];
    const localPath = getExternalLocalPath(line);
    if (normalizeExternalPath(localPath || '') !== normalizedTarget) return [line];
    if (replacement !== undefined && !replaced) {
      replaced = true;
      return [`${line.match(/^\s*/)?.[0] || ''}${replacement}`];
    }
    return [];
  });

  if (replacement !== undefined && !replaced) {
    if (lines.length === 1 && lines[0] === '') return replacement;
    if (lines.at(-1) === '') lines.splice(lines.length - 1, 0, replacement);
    else lines.push(replacement);
  }
  return lines.join(lineEnding);
}

function removeExternalDefinition(current: string, externalPath: string): string {
  return mapExternalDefinitions(current, externalPath);
}

function replaceExternalDefinition(
  current: string,
  externalPath: string,
  replacement: string
): string {
  return mapExternalDefinitions(current, externalPath, replacement);
}

async function saveExternals(workingCopyPath: string, value: string): Promise<void> {
  if (value.trim()) {
    await runSvnText(withSvnTargets(['propset', 'svn:externals', value], [workingCopyPath]));
  } else {
    await runSvnText(withSvnTargets(['propdel', 'svn:externals'], [workingCopyPath]));
  }
}
