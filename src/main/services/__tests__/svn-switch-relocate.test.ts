// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  stat: vi.fn(),
  getNetworkOptionsForUrl: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('node:fs/promises', () => ({
  stat: mockState.stat,
}));

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: mockState.getNetworkOptionsForUrl,
}));

import { validateSwitchOrRelocate } from '../svn-switch-relocate';

// POSIX-style fixtures keep node:path join/dirname behavior identical on
// every host OS (the service itself uses platform-native paths at runtime).
const WC_PATH = '/wc';
const WC_ADMIN = '/wc/.svn';
const CURRENT_URL = 'https://example.test/svn/repo/trunk';
const REPO_ROOT = 'https://example.test/svn/repo';

function infoXml(
  url: string,
  uuid = 'uuid-current',
  root = REPO_ROOT,
  revision = 41
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="target" revision="${revision}" kind="dir">
    <url>${url}</url>
    <repository><root>${root}</root><uuid>${uuid}</uuid></repository>
    <commit revision="40"><author>alice</author></commit>
  </entry>
</info>`;
}

describe('validateSwitchOrRelocate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.stat.mockImplementation(async (path: string) => {
      if (path === WC_ADMIN) return { isDirectory: () => true };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = args.at(-1);
      // Working-copy probes are local paths; URL probes describe the target.
      if (!/^https?:\/\//i.test(String(target))) return infoXml(CURRENT_URL);
      return infoXml(String(target), 'uuid-current', REPO_ROOT, 42);
    });
    mockState.getNetworkOptionsForUrl.mockResolvedValue({ trustSslFailures: false });
  });

  it('rejects malformed target URLs without running svn', async () => {
    for (const badUrl of ['trunk', 'not a url', 'ftp://example.test/repo', 'https://user:pw@example.test/repo']) {
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: badUrl,
        kind: 'switch',
      });
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        { code: 'INVALID_TARGET_URL', message: expect.any(String), severity: 'error' },
      ]);
    }
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('rejects paths without a .svn administrative directory', async () => {
    mockState.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(
      validateSwitchOrRelocate({
        workingCopyPath: '/not-a-wc',
        targetUrl: 'https://example.test/svn/repo/branches/x',
        kind: 'switch',
      })
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: 'MISSING_WORKING_COPY', severity: 'error' }],
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('accepts a subdirectory whose ancestor owns the .svn directory', async () => {
    await expect(
      validateSwitchOrRelocate({
        workingCopyPath: '/wc/sub',
        targetUrl: 'https://example.test/svn/repo/branches/x',
        kind: 'switch',
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('reports when svn info cannot describe the working copy', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args.at(-1) === WC_PATH) throw new Error('svn: E155007: not a working copy');
      return infoXml('https://example.test/svn/repo/branches/x');
    });

    await expect(
      validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://example.test/svn/repo/branches/x',
        kind: 'switch',
      })
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: 'WORKING_COPY_INFO_UNAVAILABLE', severity: 'error' }],
    });
  });

  describe('switch', () => {
    it('returns a dry-run summary with the target head revision', async () => {
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://example.test/svn/repo/branches/feature',
        kind: 'switch',
      });

      expect(result).toMatchObject({
        ok: true,
        issues: [],
        summary: {
          kind: 'switch',
          currentUrl: CURRENT_URL,
          repositoryRoot: REPO_ROOT,
          repositoryUuid: 'uuid-current',
          targetRepositoryUuid: 'uuid-current',
          targetHeadRevision: 42,
        },
      });
      expect(mockState.runSvnText).toHaveBeenCalledWith(['info', '--xml', '--', WC_PATH]);
      expect(mockState.runSvnText).toHaveBeenCalledWith(
        ['info', '--xml', '--', 'https://example.test/svn/repo/branches/feature'],
        { trustSslFailures: false }
      );
    });

    it('skips the target probe when includeTargetRevision is false', async () => {
      await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://example.test/svn/repo/branches/feature',
        kind: 'switch',
        includeTargetRevision: false,
      });

      expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    });

    it('errors when the target lives in a different repository', async () => {
      mockState.runSvnText.mockImplementation(async (args: string[]) => {
        if (args.at(-1) === WC_PATH) return infoXml(CURRENT_URL);
        return infoXml('https://example.test/svn/repo/branches/feature', 'uuid-other');
      });

      await expect(
        validateSwitchOrRelocate({
          workingCopyPath: WC_PATH,
          targetUrl: 'https://example.test/svn/repo/branches/feature',
          kind: 'switch',
        })
      ).resolves.toMatchObject({
        ok: false,
        issues: [{ code: 'REPOSITORY_UUID_MISMATCH', severity: 'error' }],
      });
    });

    it('errors when the target URL does not exist', async () => {
      mockState.runSvnText.mockImplementation(async (args: string[]) => {
        if (args.at(-1) === WC_PATH) return infoXml(CURRENT_URL);
        throw new Error('svn: E200009: Could not list all targets because some targets don\'t exist');
      });

      await expect(
        validateSwitchOrRelocate({
          workingCopyPath: WC_PATH,
          targetUrl: 'https://example.test/svn/repo/branches/missing',
          kind: 'switch',
        })
      ).resolves.toMatchObject({
        ok: false,
        issues: [{ code: 'TARGET_NOT_FOUND', severity: 'error' }],
      });
    });

    it('degrades to a warning when the head revision probe fails', async () => {
      mockState.runSvnText.mockImplementation(async (args: string[]) => {
        if (args.at(-1) === WC_PATH) return infoXml(CURRENT_URL);
        throw new Error('svn: E170013: Unable to connect to a repository at URL');
      });

      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://example.test/svn/repo/branches/feature',
        kind: 'switch',
      });

      expect(result.ok).toBe(true);
      expect(result.summary?.targetHeadUnavailable).toBe(true);
      expect(result.issues).toEqual([
        { code: 'TARGET_INFO_UNAVAILABLE', message: expect.any(String), severity: 'warning' },
      ]);
    });

    it('warns when the working copy is already on the target URL', async () => {
      mockState.runSvnText.mockResolvedValue(infoXml(CURRENT_URL));
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: `${CURRENT_URL}/`,
        kind: 'switch',
      });

      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([
        { code: 'ALREADY_ON_TARGET', message: expect.any(String), severity: 'warning' },
      ]);
    });
  });

  describe('relocate', () => {
    it('accepts a server move that preserves the repository path', async () => {
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://moved.example.test/svn/repo/trunk',
        kind: 'relocate',
      });

      expect(result).toMatchObject({
        ok: true,
        issues: [],
        summary: {
          kind: 'relocate',
          currentUrl: CURRENT_URL,
          commonRootPath: 'svn/repo/trunk',
        },
      });
      // Relocation dry-runs never probe the target repository.
      expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    });

    it('rejects a relocation target with no shared path root', async () => {
      await expect(
        validateSwitchOrRelocate({
          workingCopyPath: WC_PATH,
          targetUrl: 'https://moved.example.test/other/tree',
          kind: 'relocate',
        })
      ).resolves.toMatchObject({
        ok: false,
        issues: [{ code: 'NO_COMMON_ROOT', severity: 'error' }],
      });
    });

    it('warns when only one path segment is shared', async () => {
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://moved.example.test/svn/elsewhere/trunk',
        kind: 'relocate',
      });

      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([
        { code: 'SHALLOW_COMMON_ROOT', message: expect.any(String), severity: 'warning' },
      ]);
      expect(result.summary?.commonRootPath).toBe('svn');
    });

    it('errors when the working copy already points at the target', async () => {
      await expect(
        validateSwitchOrRelocate({
          workingCopyPath: WC_PATH,
          targetUrl: CURRENT_URL,
          kind: 'relocate',
        })
      ).resolves.toMatchObject({
        ok: false,
        issues: [{ code: 'RELOCATE_TARGET_UNCHANGED', severity: 'error' }],
      });
    });

    it('warns that same-repository moves are switches, not relocates', async () => {
      const result = await validateSwitchOrRelocate({
        workingCopyPath: WC_PATH,
        targetUrl: 'https://example.test/svn/repo/branches/feature',
        kind: 'relocate',
      });

      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'RELOCATE_WITHIN_REPOSITORY', severity: 'warning' })
      );
    });
  });
});
