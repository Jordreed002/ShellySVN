import type {
  LockForceConfirmation,
  SvnLockForceResult,
  SvnLockInfo,
  SvnLockInfoResult,
  SvnLockListRecordResult,
  SvnLockRecord,
  SvnLockRecordResult,
} from '@shared/types';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { parseSvnInfoXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { getSvnReadError } from '../utils/svn-errors';
import { createSvnXmlParser } from '../utils/svn-xml';
import { runSvnText } from './svn-executor';
import { getNetworkOptionsForWorkingCopyPath } from './svn-network-context';
import { getWorkingCopyContext } from './svn-working-copy';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';

// Hardened factory (input size/depth guards, entity expansion disabled);
// options preserve the previous raw XMLParser configuration.
const xmlParser = createSvnXmlParser({
  parseAttributeValue: true,
  trimValues: true,
});

async function getHooksForWorkingCopy(workingCopyPath: string): Promise<HookScript[]> {
  try {
    const store = await getStore();
    const stored = await store.get<Record<string, HookScript[]>>('shellysvn:hook-scripts');
    if (stored && stored[workingCopyPath]) {
      return stored[workingCopyPath];
    }
  } catch (error) {
    debug.error('[SVN] Failed to get hooks (continuing without hooks):', error);
  }
  return [];
}

function getParentPath(path: string): string {
  const lastSepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSepIndex >= 0 ? path.substring(0, lastSepIndex) : path;
}

async function getWorkingCopyRoot(path: string): Promise<string> {
  return (await getWorkingCopyContext(path))?.workingCopyRoot ?? getParentPath(path);
}

export async function lock(
  path: string,
  message?: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  validateSvnTargets([path], 'Lock target');
  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
  }

  const args = ['lock'];
  if (message) args.push('-m', message);
  const output = await runSvnText(
    withSvnTargets(args, [path]),
    await getNetworkOptionsForWorkingCopyPath(path)
  );
  return { success: true, output };
}

export async function unlock(
  path: string,
  force?: boolean
): Promise<{ success: boolean; output?: string; error?: string }> {
  validateSvnTargets([path], 'Unlock target');
  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
  }

  const args = ['unlock'];
  if (force) args.push('--force');
  const output = await runSvnText(
    withSvnTargets(args, [path]),
    await getNetworkOptionsForWorkingCopyPath(path)
  );
  return { success: true, output };
}

export async function getLockInfo(path: string): Promise<SvnLockInfoResult> {
  try {
    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]));
    const info = parseSvnInfoXml(xml);
    return info.lock ? { lock: info.lock } : {};
  } catch (error) {
    debug.error('[SVN] Lock info error:', error);
    return { ...getSvnReadError(error, { command: 'info', target: path }) };
  }
}

// ============================================
// Lock steal/break with owner warning (item 57)
// ============================================
//
// The SvnLockRecord / SvnLockRecordResult / SvnLockForceResult /
// LockForceConfirmation / SvnLockListRecordResult shapes live in
// @shared/types (they cross IPC); they are re-exported here for compatibility
// with existing main-process imports.

export type {
  LockForceConfirmation,
  SvnLockForceFailureReason,
  SvnLockForceResult,
  SvnLockListRecordResult,
  SvnLockRecord,
  SvnLockRecordResult,
} from '@shared/types';

const MAX_LOCK_COMMENT_LENGTH = 64 * 1024;

function assertLockComment(comment: string): void {
  if (comment.length > MAX_LOCK_COMMENT_LENGTH) {
    throw new Error('Lock comment exceeds the maximum supported length.');
  }
  if (/\u0000/.test(comment)) {
    throw new Error('Lock comment contains invalid control characters.');
  }
}

// `svn info --xml` reports <created>/<expires> while `svn status --xml`
// reports <creationdate>/<expirationdate>; accept both spellings.
interface RawLockXml {
  owner?: string;
  comment?: string;
  token?: string;
  created?: string;
  creationdate?: string;
  expires?: string;
  expirationdate?: string;
}

function toLockRecord(raw: RawLockXml | undefined, path: string): SvnLockRecord | undefined {
  if (!raw) return undefined;
  const date = raw.created || raw.creationdate || '';
  const expires = raw.expires || raw.expirationdate || '';
  return {
    path,
    owner: raw.owner || '',
    comment: raw.comment || '',
    date,
    ...(raw.token ? { token: raw.token } : {}),
    ...(expires
      ? { expires, ...(Date.parse(expires) < Date.now() ? { expired: true } : {}) }
      : {}),
  };
}

function parseInfoLockXml(xml: string, fallbackPath: string): SvnLockRecord | undefined {
  const parsed = xmlParser.parse(xml) as {
    info?: {
      entry?:
        | { '@_path'?: string; lock?: RawLockXml }
        | Array<{ '@_path'?: string; lock?: RawLockXml }>;
    };
  };
  const entry = Array.isArray(parsed.info?.entry) ? parsed.info?.entry?.[0] : parsed.info?.entry;
  return toLockRecord(entry?.lock, entry?.['@_path'] || fallbackPath);
}

/**
 * Read the full lock record (owner, comment, created, expiry) for display in
 * the steal/break warning dialog. Pure read — never mutates lock state.
 */
export async function getLockRecord(path: string): Promise<SvnLockRecordResult> {
  try {
    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]));
    const record = parseInfoLockXml(xml, path);
    if (!record) return {};
    // Best-effort ownership hint so the UI can style "your lock" vs foreign.
    try {
      const username = (await getNetworkOptionsForWorkingCopyPath(path)).credentials?.username;
      if (username) record.isOwner = record.owner === username;
    } catch {
      // Ownership hint stays unset when credentials are unavailable.
    }
    return { lock: record };
  } catch (error) {
    debug.error('[SVN] Lock record error:', error);
    return { ...getSvnReadError(error, { command: 'info', target: path }) };
  }
}

async function readCurrentLock(path: string): Promise<SvnLockForceResult> {
  try {
    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]));
    return { success: true, lock: parseInfoLockXml(xml, path) };
  } catch (error) {
    debug.error('[SVN] Lock read before force operation failed:', error);
    return {
      success: false,
      reason: 'SVN_ERROR',
      ...getSvnReadError(error, { command: 'info', target: path }),
    };
  }
}

function requireConfirmation(
  confirmation: LockForceConfirmation | undefined
): confirmation is LockForceConfirmation {
  return confirmation?.confirmed === true && typeof confirmation.confirmedOwner === 'string';
}

/**
 * Steal a lock owned by another user: force-unlock the existing lock, then
 * re-lock the path as the current user (optionally with a comment). Requires
 * an explicit confirmation token naming the owner the user was shown; if the
 * owner changed since confirmation the operation is refused.
 */
export async function stealLock(
  path: string,
  comment?: string,
  confirmation?: LockForceConfirmation
): Promise<SvnLockForceResult> {
  validateSvnTargets([path], 'Lock target');
  if (comment !== undefined) assertLockComment(comment);
  if (!requireConfirmation(confirmation)) {
    return {
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      error: 'Stealing a lock requires explicit confirmation of the current lock owner.',
    };
  }

  const current = await readCurrentLock(path);
  if (!current.success) return current;
  const currentLock = current.lock;
  if (!currentLock) {
    return {
      success: false,
      reason: 'NOT_LOCKED',
      error: 'Path is not locked; nothing to steal. Use lock instead.',
    };
  }
  if (currentLock.owner !== confirmation.confirmedOwner) {
    return {
      success: false,
      reason: 'OWNER_CHANGED',
      lock: currentLock,
      error: `Lock owner is now '${currentLock.owner}' but the confirmation was for '${confirmation.confirmedOwner}'. Review the lock info and confirm again.`,
    };
  }

  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);
  const preUnlock = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
    force: true,
  });
  const preLock = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message: comment,
    force: true,
  });
  if (!preUnlock.allSucceeded || !preLock.allSucceeded) {
    return {
      success: false,
      reason: 'HOOK_BLOCKED',
      error: preUnlock.error || preLock.error || 'Pre-lock hook blocked',
    };
  }

  try {
    const networkOptions = await getNetworkOptionsForWorkingCopyPath(path);
    await runSvnText(withSvnTargets(['unlock', '--force'], [path]), networkOptions);
    const args = ['lock'];
    if (comment) args.push('-m', comment);
    await runSvnText(withSvnTargets(args, [path]), networkOptions);

    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]), networkOptions);
    return {
      success: true,
      lock: parseInfoLockXml(xml, path),
      previousOwner: currentLock.owner,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Steal lock error:', errorMessage);
    return {
      success: false,
      reason: 'SVN_ERROR',
      previousOwner: currentLock.owner,
      ...getSvnReadError(error, { command: 'lock', target: path }),
    };
  }
}

/**
 * Break another user's lock (force-unlock) without re-locking. Requires the
 * same owner-bound confirmation token as stealLock.
 */
export async function breakLock(
  path: string,
  confirmation?: LockForceConfirmation
): Promise<SvnLockForceResult> {
  validateSvnTargets([path], 'Unlock target');
  if (!requireConfirmation(confirmation)) {
    return {
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      error: 'Breaking a lock requires explicit confirmation of the current lock owner.',
    };
  }

  const current = await readCurrentLock(path);
  if (!current.success) return current;
  const currentLock = current.lock;
  if (!currentLock) {
    return {
      success: false,
      reason: 'NOT_LOCKED',
      error: 'Path is not locked; nothing to break.',
    };
  }
  if (currentLock.owner !== confirmation.confirmedOwner) {
    return {
      success: false,
      reason: 'OWNER_CHANGED',
      lock: currentLock,
      error: `Lock owner is now '${currentLock.owner}' but the confirmation was for '${confirmation.confirmedOwner}'. Review the lock info and confirm again.`,
    };
  }

  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);
  const preUnlock = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
    force: true,
  });
  if (!preUnlock.allSucceeded) {
    return {
      success: false,
      reason: 'HOOK_BLOCKED',
      error: preUnlock.error || 'Pre-unlock hook blocked',
    };
  }

  try {
    await runSvnText(
      withSvnTargets(['unlock', '--force'], [path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    return { success: true, previousOwner: currentLock.owner };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Break lock error:', errorMessage);
    return {
      success: false,
      reason: 'SVN_ERROR',
      previousOwner: currentLock.owner,
      ...getSvnReadError(error, { command: 'unlock', target: path }),
    };
  }
}

/**
 * Set or replace the comment on an existing lock (`svn lock -m --force`,
 * which is how Subversion updates a lock comment). When the lock is owned by
 * another user — or ownership cannot be determined — the owner-bound
 * confirmation token is required, because the re-lock would steal the lock.
 */
export async function setLockComment(
  path: string,
  comment: string,
  confirmation?: LockForceConfirmation
): Promise<SvnLockForceResult> {
  validateSvnTargets([path], 'Lock target');
  assertLockComment(comment);

  const current = await readCurrentLock(path);
  if (!current.success) return current;
  const currentLock = current.lock;
  if (!currentLock) {
    return {
      success: false,
      reason: 'NOT_LOCKED',
      error: 'Path is not locked; lock it first, then set a comment.',
    };
  }

  const networkOptions = await getNetworkOptionsForWorkingCopyPath(path);
  const username = networkOptions.credentials?.username;
  if (username && currentLock.owner !== username && !requireConfirmation(confirmation)) {
    return {
      success: false,
      reason: 'FOREIGN_LOCK',
      lock: currentLock,
      error: `Lock is owned by '${currentLock.owner}'; updating its comment would steal the lock. Confirm the owner to continue.`,
    };
  }
  if (
    (!username || currentLock.owner !== username) &&
    (!requireConfirmation(confirmation) || confirmation.confirmedOwner !== currentLock.owner)
  ) {
    return {
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      lock: currentLock,
      error: `Cannot prove lock ownership for '${currentLock.owner}'; confirm the shown owner to update the comment.`,
    };
  }

  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);
  const preLock = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message: comment,
    force: true,
  });
  if (!preLock.allSucceeded) {
    return {
      success: false,
      reason: 'HOOK_BLOCKED',
      error: preLock.error || 'Pre-lock hook blocked',
    };
  }

  try {
    await runSvnText(withSvnTargets(['lock', '--force', '-m', comment], [path]), networkOptions);
    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]), networkOptions);
    return {
      success: true,
      lock: parseInfoLockXml(xml, path),
      previousOwner: currentLock.owner,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Set lock comment error:', errorMessage);
    return {
      success: false,
      reason: 'SVN_ERROR',
      ...getSvnReadError(error, { command: 'lock', target: path }),
    };
  }
}

export async function forceLock(
  path: string,
  message?: string
): Promise<{ success: boolean; lock?: SvnLockInfo; error?: string }> {
  validateSvnTargets([path], 'Lock target');
  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message,
    force: true,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
  }

  try {
    const networkOptions = await getNetworkOptionsForWorkingCopyPath(path);
    const args = ['lock', '--force'];
    if (message) args.push('-m', message);
    await runSvnText(withSvnTargets(args, [path]), networkOptions);

    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]), networkOptions);
    const info = parseSvnInfoXml(xml);

    return { success: true, lock: info.lock };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Force lock error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function forceUnlock(path: string): Promise<{ success: boolean; error?: string }> {
  validateSvnTargets([path], 'Unlock target');
  const workingCopyPath = await getWorkingCopyRoot(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
    force: true,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
  }

  try {
    await runSvnText(
      withSvnTargets(['unlock', '--force'], [path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Force unlock error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function listLocks(path: string): Promise<SvnLockListRecordResult> {
  try {
    const xml = await runSvnText(
      withSvnTargets(['status', '--show-updates', '--xml'], [path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    const locks: SvnLockRecord[] = [];

    const parsed = xmlParser.parse(xml) as {
      status?: {
        target?: {
          entry?:
            | Array<{
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    expirationdate?: string;
                    token?: string;
                  };
                };
                'repos-status'?: {
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    expirationdate?: string;
                    token?: string;
                  };
                };
              }>
            | {
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    expirationdate?: string;
                    token?: string;
                  };
                };
                'repos-status'?: {
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    expirationdate?: string;
                    token?: string;
                  };
                };
              };
        };
      };
    };

    const entries = parsed.status?.target?.entry;
    if (!entries) return { locks: [] };

    const entriesArray = Array.isArray(entries) ? entries : [entries];

    for (const entry of entriesArray) {
      const repositoryLock = entry['repos-status']?.lock ?? entry['wc-status']?.lock;
      if (repositoryLock) {
        const record = toLockRecord(repositoryLock, entry['@_path'] || '');
        if (record) locks.push(record);
      }
    }

    return { locks };
  } catch (error) {
    debug.error('[SVN] Lock list error:', error);
    return { locks: [], ...getSvnReadError(error) };
  }
}
