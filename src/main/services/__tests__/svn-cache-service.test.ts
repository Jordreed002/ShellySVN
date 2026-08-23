import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
}));

import {
  resolveSvnCacheRoot,
  type SvnCacheConfiguration,
  SvnCacheService,
} from '../svn-cache-service';

describe('SvnCacheService', () => {
  let tempDirectory: string;
  let configuration: SvnCacheConfiguration;
  let now: number;
  let service: SvnCacheService;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'shellysvn-cache-'));
    configuration = {
      filePath: join(tempDirectory, 'cache.json'),
      logBudgetBytes: 10_000,
      offlineBudgetBytes: 10_000,
    };
    now = 1_000;
    service = new SvnCacheService(
      async () => configuration,
      () => now
    );
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('persists entries for another service instance', async () => {
    await expect(
      service.set('log', 'repo:100', '/repo', { revisions: [100] }, { ttlMs: 60_000 })
    ).resolves.toEqual({ success: true });

    const restarted = new SvnCacheService(
      async () => configuration,
      () => now
    );
    await expect(restarted.get('log', 'repo:100')).resolves.toMatchObject({
      key: 'repo:100',
      path: '/repo',
      data: { revisions: [100] },
    });
  });

  it('serializes concurrent writes without losing either entry', async () => {
    await Promise.all([
      service.set('info', 'first', '/repo/first', { revision: 1 }, { ttlMs: 60_000 }),
      service.set('status', 'second', '/repo/second', { modified: true }, { ttlMs: 60_000 }),
    ]);

    await expect(service.get('info', 'first')).resolves.toMatchObject({
      data: { revision: 1 },
    });
    await expect(service.get('status', 'second')).resolves.toMatchObject({
      data: { modified: true },
    });

    const document = JSON.parse(await readFile(configuration.filePath, 'utf8')) as {
      entries: unknown[];
    };
    expect(document.entries).toHaveLength(2);
  });

  it('purges expired entries from memory and disk', async () => {
    await service.set('entries', 'repo', 'https://svn.example/repo', ['src'], {
      ttlMs: 500,
    });
    now += 501;

    await expect(service.get('entries', 'repo')).resolves.toBeNull();
    await expect(service.stats()).resolves.toMatchObject({ entriesCount: 0, totalSize: 0 });
  });

  it('evicts least-recently-used entries independently for log and offline data', async () => {
    configuration = {
      ...configuration,
      logBudgetBytes: 450,
      offlineBudgetBytes: 450,
    };
    const payload = { text: 'x'.repeat(180) };

    await service.set('log', 'old-log', '/repo', payload, { ttlMs: 60_000 });
    now += 10;
    await service.set('log', 'new-log', '/repo', payload, { ttlMs: 60_000 });
    now += 10;
    await service.set('info', 'old-info', '/repo', payload, { ttlMs: 60_000 });
    now += 10;
    await service.set('status', 'new-status', '/repo', payload, { ttlMs: 60_000 });

    expect((await service.list('log')).map((entry) => entry.key)).toEqual(['new-log']);
    expect((await service.list('status')).map((entry) => entry.key)).toEqual(['new-status']);
    await expect(service.get('info', 'old-info')).resolves.toBeNull();
  });

  it('rejects a single entry that exceeds its configured group budget', async () => {
    configuration = { ...configuration, logBudgetBytes: 100 };

    await expect(
      service.set('log', 'large', '/repo', { text: 'x'.repeat(500) }, { ttlMs: 60_000 })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('exceeds'),
    });
    await expect(service.get('log', 'large')).resolves.toBeNull();
  });

  it('removes overlapping paths without clearing sibling paths', async () => {
    await service.set('status', 'child', '/repo/selected/child', {}, { ttlMs: 60_000 });
    await service.set('entries', 'parent', '/repo/selected', {}, { ttlMs: 60_000 });
    await service.set('status', 'sibling', '/repo/sibling', {}, { ttlMs: 60_000 });

    await service.clearPath('/repo/selected');

    await expect(service.get('status', 'child')).resolves.toBeNull();
    await expect(service.get('entries', 'parent')).resolves.toBeNull();
    await expect(service.get('status', 'sibling')).resolves.not.toBeNull();
  });

  it('rejects a delayed path write that began before the path was cleared', async () => {
    await service.clearPath('/repo/selected', 1_500);
    now = 2_000;

    await expect(
      service.set(
        'status',
        'late',
        '/repo/selected/child',
        {},
        {
          ttlMs: 60_000,
          operationStartedAt: 1_400,
        }
      )
    ).resolves.toMatchObject({ success: false, stale: true });
  });

  it('rejects delayed namespace writes but permits other namespaces', async () => {
    await service.clearNamespace('log', 1_500);
    now = 2_000;

    await expect(
      service.set(
        'log',
        'late-log',
        '/repo',
        {},
        {
          ttlMs: 60_000,
          operationStartedAt: 1_400,
        }
      )
    ).resolves.toMatchObject({ success: false, stale: true });
    await expect(
      service.set(
        'info',
        'fresh-info',
        '/repo',
        {},
        {
          ttlMs: 60_000,
          operationStartedAt: 1_400,
        }
      )
    ).resolves.toEqual({ success: true });
  });

  it('applies smaller settings budgets to existing persisted entries', async () => {
    const payload = { text: 'x'.repeat(180) };
    await service.set('log', 'first', '/repo', payload, { ttlMs: 60_000 });
    now += 10;
    await service.set('log', 'second', '/repo', payload, { ttlMs: 60_000 });

    configuration = { ...configuration, logBudgetBytes: 450 };
    await expect(service.stats()).resolves.toMatchObject({ logCount: 1 });

    const restarted = new SvnCacheService(
      async () => configuration,
      () => now
    );
    await expect(restarted.stats()).resolves.toMatchObject({ logCount: 1 });
  });

  it('reports byte counts from the serialized cache entries', async () => {
    await service.set('info', 'info', '/repo', { revision: 10 }, { ttlMs: 60_000 });
    await service.set('log', 'log', '/repo', { revisions: [10] }, { ttlMs: 60_000 });

    const info = await service.get('info', 'info');
    const log = await service.get('log', 'log');
    await expect(service.stats()).resolves.toMatchObject({
      totalSize: info!.sizeBytes + log!.sizeBytes,
      offlineSize: info!.sizeBytes,
      logSize: log!.sizeBytes,
    });
  });

  it('deliberately discards the legacy log store once before using the new cache', async () => {
    const discardLegacy = vi.fn().mockResolvedValue(undefined);
    const migratingService = new SvnCacheService(
      async () => configuration,
      () => now,
      discardLegacy
    );

    await migratingService.stats();
    await migratingService.stats();

    expect(discardLegacy).toHaveBeenCalledTimes(1);
  });

  it('uses approved custom storage and rejects relative or unapproved paths', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    await expect(
      resolveSvnCacheRoot('/approved/cache', '/default/cache', () => true, prepare)
    ).resolves.toBe('/approved/cache');
    expect(prepare).toHaveBeenCalledWith('/approved/cache');

    await expect(
      resolveSvnCacheRoot('relative/cache', '/default/cache', () => true, prepare)
    ).resolves.toBe('/default/cache');
    await expect(
      resolveSvnCacheRoot('/unapproved/cache', '/default/cache', () => false, prepare)
    ).resolves.toBe('/default/cache');
  });

  it('falls back when approved custom storage is unavailable', async () => {
    await expect(
      resolveSvnCacheRoot(
        '/approved/cache',
        '/default/cache',
        () => true,
        async () => {
          throw new Error('read-only filesystem');
        }
      )
    ).resolves.toBe('/default/cache');
  });

  /*
   * Windows path-key normalization for clearPath. Entries store their path
   * run through normalizeCachePath, which on win32 collapses backslashes to '/'
   * and lowercases (Windows is case-insensitive). clearPath must therefore
   * invalidate an entry whose stored path differs only by drive-letter case or
   * separator style; on POSIX the same clear must not match (case-sensitive).
   */
  describe('clearPath — Windows path normalization', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
    });

    it('clears an entry whose stored path differs only by case and separator', async () => {
      await service.set('log', 'repo:100', 'C:\\Repo', { revisions: [100] }, { ttlMs: 60_000 });

      await service.clearPath('c:/repo');

      await expect(service.get('log', 'repo:100')).resolves.toBeNull();
    });

    it('clears a descendant entry via a case-insensitive ancestor clear', async () => {
      await service.set('log', 'src', 'C:\\Repo\\src', { revisions: [5] }, { ttlMs: 60_000 });

      await service.clearPath('c:/REPO');

      await expect(service.get('log', 'src')).resolves.toBeNull();
    });

    it('does not clear an unrelated path that shares only a name prefix', async () => {
      await service.set('log', 'repo', 'C:\\Repo', { revisions: [1] }, { ttlMs: 60_000 });
      await service.set('log', 'other', 'C:\\Repo-Other', { revisions: [2] }, { ttlMs: 60_000 });

      await service.clearPath('c:/repo');

      await expect(service.get('log', 'repo')).resolves.toBeNull();
      await expect(service.get('log', 'other')).resolves.toMatchObject({ key: 'other' });
    });
  });

  describe('clearPath — POSIX path normalization (platform boundary)', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
    });

    it('is case-sensitive on POSIX: a differently-cased clear does not match', async () => {
      await service.set('log', 'repo', '/Repo', { revisions: [1] }, { ttlMs: 60_000 });

      await service.clearPath('/repo');

      await expect(service.get('log', 'repo')).resolves.toMatchObject({ key: 'repo' });
    });
  });

  /*
   * URL keys are canonicalized as repository URLs (scheme/host casing,
   * percent-encoding, trailing slashes) — never lowercased like a win32
   * filesystem path, because URL paths are case-sensitive even when the host
   * is not.
   */
  describe('normalizeCachePath — URL keys', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
    });

    it('canonicalizes URL keys as repository URLs instead of lowercasing them', async () => {
      await service.set(
        'log',
        'repo',
        'HTTPS://svn.example.com/Repo/Trunk/',
        { revisions: [1] },
        { ttlMs: 60_000 }
      );

      await expect(service.get('log', 'repo')).resolves.toMatchObject({
        path: 'https://svn.example.com/Repo/Trunk',
      });
    });

    it('matches a URL path clear through canonicalization', async () => {
      await service.set(
        'entries',
        'repo',
        'https://svn.example.com/Repo/Trunk',
        ['src'],
        { ttlMs: 60_000 }
      );

      await service.clearPath('https://svn.example.com/Repo/');

      await expect(service.get('entries', 'repo')).resolves.toBeNull();
    });

    it('does not clear a URL entry whose path differs only by case', async () => {
      await service.set(
        'log',
        'url',
        'https://svn.example.com/Repo/Trunk',
        { revisions: [1] },
        { ttlMs: 60_000 }
      );

      await service.clearPath('https://svn.example.com/repo/trunk');

      await expect(service.get('log', 'url')).resolves.toMatchObject({ key: 'url' });
    });

    it('keeps filesystem behavior for non-URL keys', async () => {
      await service.set('status', 'path', 'C:\\Repo\\src', {}, { ttlMs: 60_000 });

      await service.clearPath('c:/repo');

      await expect(service.get('status', 'path')).resolves.toBeNull();
    });
  });
});
