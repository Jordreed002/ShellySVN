import { ipcMain } from 'electron';

import type { SvnCacheNamespace } from '@shared/types';

import { getSvnCacheService } from '../services/svn-cache-service';

const CACHE_NAMESPACES = new Set<SvnCacheNamespace>(['info', 'status', 'log', 'entries']);

function requireNamespace(value: unknown): SvnCacheNamespace {
  if (typeof value !== 'string' || !CACHE_NAMESPACES.has(value as SvnCacheNamespace)) {
    throw new Error('Invalid SVN cache namespace.');
  }
  return value as SvnCacheNamespace;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalTimestamp(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Cache timestamp must be a non-negative finite number.');
  }
  return value;
}

export function registerSvnCacheHandlers(): void {
  ipcMain.handle('svnCache:get', (_, namespace: unknown, key: unknown) =>
    getSvnCacheService().get(requireNamespace(namespace), requireNonEmptyString(key, 'Cache key'))
  );
  ipcMain.handle('svnCache:list', (_, namespace: unknown) =>
    getSvnCacheService().list(requireNamespace(namespace))
  );
  ipcMain.handle(
    'svnCache:set',
    (
      _,
      namespace: unknown,
      key: unknown,
      path: unknown,
      data: unknown,
      ttlMs: unknown,
      operationStartedAt: unknown
    ) => {
      if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error('Cache TTL must be a positive finite number.');
      }
      return getSvnCacheService().set(
        requireNamespace(namespace),
        requireNonEmptyString(key, 'Cache key'),
        requireNonEmptyString(path, 'Cache path'),
        data,
        { ttlMs, operationStartedAt: optionalTimestamp(operationStartedAt) }
      );
    }
  );
  ipcMain.handle('svnCache:delete', (_, namespace: unknown, key: unknown) =>
    getSvnCacheService().delete(
      requireNamespace(namespace),
      requireNonEmptyString(key, 'Cache key')
    )
  );
  ipcMain.handle('svnCache:clearNamespace', (_, namespace: unknown, clearedAt: unknown) =>
    getSvnCacheService().clearNamespace(requireNamespace(namespace), optionalTimestamp(clearedAt))
  );
  ipcMain.handle('svnCache:clearPath', (_, path: unknown, clearedAt: unknown) =>
    getSvnCacheService().clearPath(
      requireNonEmptyString(path, 'Cache path'),
      optionalTimestamp(clearedAt)
    )
  );
  ipcMain.handle('svnCache:clearAll', (_, clearedAt: unknown) =>
    getSvnCacheService().clearAll(optionalTimestamp(clearedAt))
  );
  ipcMain.handle('svnCache:stats', () => getSvnCacheService().stats());
}
