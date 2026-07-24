import { OFFLINE_CACHE_TTL_MS } from '@shared/constants';
import type {
  SvnCacheNamespace,
  SvnInfoResult,
  SvnListResult,
  SvnLogResult,
  SvnStatusResult,
} from '@shared/types';

import { assertSuccessfulSvnRead } from './svnReadResult';

export interface CachedReadResult<T> {
  data: T;
  source: 'network' | 'cache';
  cachedAt: number;
  age: number;
}

interface CachedReadOptions<T> {
  namespace: SvnCacheNamespace;
  key: string;
  path: string;
  read: () => Promise<T>;
  validate?: (result: T) => T;
  ttlMs?: number;
}

export async function readWithPersistentCache<T>({
  namespace,
  key,
  path,
  read,
  validate,
  ttlMs = OFFLINE_CACHE_TTL_MS,
}: CachedReadOptions<T>): Promise<CachedReadResult<T>> {
  const operationStartedAt = Date.now();
  let result: T;
  try {
    result = validate ? validate(await read()) : await read();
  } catch (onlineError) {
    const cached = await window.api.svnCache?.get<T>(namespace, key);
    if (!cached) throw onlineError;
    return {
      data: cached.data,
      source: 'cache',
      cachedAt: cached.cachedAt,
      age: Math.max(0, Date.now() - cached.cachedAt),
    };
  }

  try {
    await window.api.svnCache?.set(namespace, key, path, result, ttlMs, operationStartedAt);
  } catch {
    // A cache storage failure must not turn a successful SVN read into an error.
  }
  return {
    data: result,
    source: 'network',
    cachedAt: operationStartedAt,
    age: 0,
  };
}

export function readCachedInfo(
  path: string,
  read: () => Promise<SvnInfoResult> = () => window.api.svn.info(path)
): Promise<CachedReadResult<SvnInfoResult>> {
  return readWithPersistentCache({ namespace: 'info', key: path, path, read });
}

export function readCachedStatus(
  path: string,
  read: () => Promise<SvnStatusResult> = () => window.api.svn.status(path)
): Promise<CachedReadResult<SvnStatusResult>> {
  return readWithPersistentCache({
    namespace: 'status',
    key: path,
    path,
    read,
    validate: assertSuccessfulSvnRead,
  });
}

export function getListCacheKey(
  url: string,
  revision = 'HEAD',
  depth: 'empty' | 'immediates' | 'infinity' = 'immediates',
  username = ''
): string {
  return JSON.stringify([url.replace(/\/+$/, ''), revision, depth, username]);
}

export function readCachedList(
  url: string,
  revision: string,
  depth: 'empty' | 'immediates' | 'infinity',
  username: string,
  read: () => Promise<SvnListResult>
): Promise<CachedReadResult<SvnListResult>> {
  return readWithPersistentCache({
    namespace: 'entries',
    key: getListCacheKey(url, revision, depth, username),
    path: url,
    read,
    validate: assertSuccessfulSvnRead,
  });
}

export function readCachedLog(
  path: string,
  key: string,
  read: () => Promise<SvnLogResult>
): Promise<CachedReadResult<SvnLogResult>> {
  return readWithPersistentCache({
    namespace: 'log',
    key,
    path,
    read,
    validate: assertSuccessfulSvnRead,
    ttlMs: 7 * 24 * 60 * 60 * 1000,
  });
}
