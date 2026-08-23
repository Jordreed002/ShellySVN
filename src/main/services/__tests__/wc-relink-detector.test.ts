// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRelinkProposal,
  detectWorkingCopyRelinks,
  type KnownWorkingCopyEntry,
  type WcIdentity,
} from '../wc-relink-detector';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shellysvn-relink-'));
});

async function makeWorkingCopyDir(path: string): Promise<string> {
  await mkdir(join(path, '.svn'), { recursive: true });
  await writeFile(join(path, '.svn', 'wc.db'), 'fake');
  return path;
}

function identity(overrides: Partial<WcIdentity> = {}): WcIdentity {
  return {
    url: 'http://svn.example.org/repo/trunk',
    repositoryUuid: 'uuid-1234',
    ...overrides,
  };
}

describe('detectWorkingCopyRelinks', () => {
  it('skips registered paths that still exist on disk', async () => {
    const present = await makeWorkingCopyDir(join(root, 'wc'));
    const result = await detectWorkingCopyRelinks([
      { path: present, url: 'http://svn.example.org/repo/trunk', repositoryUuid: 'uuid-1234' },
    ]);
    expect(result.presentPaths).toEqual([present]);
    expect(result.proposals).toEqual([]);
    expect(result.unmatchedMissingPaths).toEqual([]);
    expect(result.checkedCandidateCount).toBe(0);
  });

  it('proposes a renamed sibling folder when the UUID matches (high confidence)', async () => {
    const oldPath = join(root, 'dev', 'wc');
    const newPath = await makeWorkingCopyDir(join(root, 'dev', 'wc-renamed'));
    await mkdir(join(root, 'dev'), { recursive: true }); // parent exists; old path missing

    const entry: KnownWorkingCopyEntry = {
      path: oldPath,
      url: 'http://svn.example.org/repo/trunk',
      repositoryUuid: 'uuid-1234',
    };
    const result = await detectWorkingCopyRelinks([entry], {
      runSvnInfo: async () => identity(),
    });

    expect(result.proposals).toEqual([
      {
        oldPath,
        newPath,
        matchedOn: 'uuid',
        confidence: 'high',
        url: 'http://svn.example.org/repo/trunk',
        repositoryUuid: 'uuid-1234',
      },
    ]);
    expect(result.unmatchedMissingPaths).toEqual([]);
  });

  it('falls back to a URL-only match at medium confidence when UUIDs differ or are absent', async () => {
    const oldPath = join(root, 'dev', 'wc');
    await makeWorkingCopyDir(join(root, 'dev', 'wc-moved'));
    await mkdir(join(root, 'dev'), { recursive: true });

    // Registry has no UUID; candidate reports a different UUID but same URL.
    const result = await detectWorkingCopyRelinks(
      [{ path: oldPath, url: 'http://svn.example.org/repo/trunk' }],
      { runSvnInfo: async () => identity({ repositoryUuid: 'other-uuid' }) }
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ matchedOn: 'url', confidence: 'medium' });
  });

  it('does not propose when identity does not match', async () => {
    const oldPath = join(root, 'dev', 'wc');
    await makeWorkingCopyDir(join(root, 'dev', 'wc-moved'));
    await mkdir(join(root, 'dev'), { recursive: true });

    const result = await detectWorkingCopyRelinks(
      [{ path: oldPath, url: 'http://svn.example.org/repo/trunk', repositoryUuid: 'uuid-1234' }],
      { runSvnInfo: async () => identity({ url: 'http://other/repo', repositoryUuid: 'zzz' }) }
    );

    expect(result.proposals).toEqual([]);
    expect(result.unmatchedMissingPaths).toEqual([oldPath]);
  });

  it('finds a working copy whose parent folder was renamed (targeted cousin search)', async () => {
    // old: root/dev/wc — parent `dev` is GONE; disk has root/dev-renamed/wc.
    const oldPath = join(root, 'dev', 'wc');
    const newPath = await makeWorkingCopyDir(join(root, 'dev-renamed', 'wc'));

    const result = await detectWorkingCopyRelinks(
      [{ path: oldPath, url: 'http://svn.example.org/repo/trunk', repositoryUuid: 'uuid-1234' }],
      { runSvnInfo: async (candidate) => (candidate === newPath ? identity() : null) }
    );

    expect(result.proposals).toEqual([
      expect.objectContaining({ oldPath, newPath, matchedOn: 'uuid', confidence: 'high' }),
    ]);
  });

  it('proposes basename-only low confidence when the registry recorded no identity', async () => {
    const oldPath = join(root, 'dev', 'wc');
    const newPath = await makeWorkingCopyDir(join(root, 'dev-renamed', 'wc'));

    const result = await detectWorkingCopyRelinks([{ path: oldPath }], {
      runSvnInfo: async (candidate) =>
        candidate === newPath ? identity({ url: '', repositoryUuid: '' }) : null,
    });

    expect(result.proposals).toEqual([
      { oldPath, newPath, matchedOn: 'basename', confidence: 'low' },
    ]);
  });

  it('skips candidates that report a different working-copy root (nested inside another WC)', async () => {
    const oldPath = join(root, 'dev', 'wc');
    await makeWorkingCopyDir(join(root, 'dev', 'wc-moved'));
    await mkdir(join(root, 'dev'), { recursive: true });

    const result = await detectWorkingCopyRelinks(
      [{ path: oldPath, url: 'http://svn.example.org/repo/trunk', repositoryUuid: 'uuid-1234' }],
      {
        // Identity matches, but svn info reports the WC root ABOVE the
        // candidate — the candidate is nested in a larger working copy.
        runSvnInfo: async () => identity({ workingCopyRoot: join(root, 'dev') }),
      }
    );

    expect(result.proposals).toEqual([]);
    expect(result.unmatchedMissingPaths).toEqual([oldPath]);
    // The candidate WAS identity-checked, then rejected as nested.
    expect(result.checkedCandidateCount).toBe(1);
  });

  it('prefers the strongest match and stops after a UUID hit', async () => {
    const oldPath = join(root, 'dev', 'wc');
    await makeWorkingCopyDir(join(root, 'dev', 'wc-a-urlonly'));
    await makeWorkingCopyDir(join(root, 'dev', 'wc-z-exact'));
    await mkdir(join(root, 'dev'), { recursive: true });

    const runSvnInfo = vi.fn(async (candidate: string) =>
      candidate.endsWith('wc-z-exact')
        ? identity()
        : identity({ repositoryUuid: 'different' }) // URL still matches
    );
    const result = await detectWorkingCopyRelinks(
      [{ path: oldPath, url: 'http://svn.example.org/repo/trunk', repositoryUuid: 'uuid-1234' }],
      { runSvnInfo }
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      newPath: join(root, 'dev', 'wc-z-exact'),
      matchedOn: 'uuid',
      confidence: 'high',
    });
    // The URL-only candidate was checked first, then the scan stopped at the
    // UUID hit — exactly two svn calls.
    expect(runSvnInfo.mock.calls.length).toBe(2);
  });

  it('caps the sibling enumeration per level', async () => {
    const oldPath = join(root, 'dev', 'wc');
    await mkdir(join(root, 'dev'), { recursive: true });
    for (let index = 0; index < 100; index += 1) {
      await makeWorkingCopyDir(join(root, 'dev', `sibling-${index.toString().padStart(3, '0')}`));
    }

    const runSvnInfo = vi.fn(async () => null);
    await detectWorkingCopyRelinks(
      [{ path: oldPath, repositoryUuid: 'uuid-1234' }],
      { runSvnInfo, maxSiblingsPerLevel: 10 }
    );

    expect(runSvnInfo.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('returns cancelled with no proposals when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await detectWorkingCopyRelinks(
      [{ path: join(root, 'gone', 'wc') }],
      { signal: controller.signal, runSvnInfo: async () => identity() }
    );
    expect(result.cancelled).toBe(true);
    expect(result.proposals).toEqual([]);
  });

  it('ignores malformed entries', async () => {
    const result = await detectWorkingCopyRelinks(
      [{ path: '' }, { path: join(root, 'nope') }] as KnownWorkingCopyEntry[],
      { runSvnInfo: async () => identity() }
    );
    // 'nope' is missing and has no candidates with .svn -> unmatched.
    expect(result.unmatchedMissingPaths).toEqual([join(root, 'nope')]);
    expect(result.proposals).toEqual([]);
  });
});

describe('applyRelinkProposal', () => {
  const proposal = {
    oldPath: '/old/wc',
    newPath: '/new/wc',
    matchedOn: 'uuid' as const,
    confidence: 'high' as const,
  };

  it('delegates the registry update to the callback and reports success', async () => {
    const updateRegistry = vi.fn().mockResolvedValue(undefined);
    await makeWorkingCopyDir(proposal.newPath.replace('/new/wc', join(root, 'new', 'wc')));
    const localProposal = { ...proposal, newPath: join(root, 'new', 'wc') };

    await expect(applyRelinkProposal(localProposal, updateRegistry)).resolves.toEqual({
      success: true,
    });
    expect(updateRegistry).toHaveBeenCalledWith(localProposal.oldPath, localProposal.newPath);
  });

  it('refuses when the new path no longer looks like a working copy', async () => {
    const updateRegistry = vi.fn();
    const result = await applyRelinkProposal(
      { ...proposal, newPath: join(root, 'not-a-wc') },
      updateRegistry
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('no longer looks like a working copy');
    expect(updateRegistry).not.toHaveBeenCalled();
  });

  it('refuses identical paths and a missing callback', async () => {
    await expect(
      applyRelinkProposal({ ...proposal, newPath: proposal.oldPath }, vi.fn())
    ).resolves.toMatchObject({ success: false });
    await expect(
      applyRelinkProposal({ ...proposal, newPath: join(root, 'x') }, undefined as never)
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining('callback') });
  });

  it('surfaces registry-update failures', async () => {
    await makeWorkingCopyDir(join(root, 'new', 'wc'));
    const failing = vi.fn().mockRejectedValue(new Error('settings write failed'));
    const result = await applyRelinkProposal(
      { ...proposal, newPath: join(root, 'new', 'wc') },
      failing
    );
    expect(result).toEqual({ success: false, error: 'settings write failed' });
  });
});

describe('wc-relink-detector via the svn-executor seam', () => {
  it('runs svn info through runSvnText with target escaping (default runner)', async () => {
    const { mocks } = vi.hoisted(() => ({
      mocks: { runSvnText: vi.fn() },
    }));
    vi.mock('../../services/svn-executor', () => ({ runSvnText: mocks.runSvnText }));

    // Fresh module so the mocked executor is picked up by the default runner.
    vi.resetModules();
    const detector = await import('../wc-relink-detector');

    const newPath = await makeWorkingCopyDir(join(root, 'dev', 'wc-moved'));
    await mkdir(join(root, 'dev'), { recursive: true });

    mocks.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="5" kind="dir">
    <url>http://svn.example.org/repo/trunk</url>
    <repository>
      <root>http://svn.example.org/repo</root>
      <uuid>uuid-1234</uuid>
    </repository>
    <wc-info>
      <wcroot-abspath>${newPath}</wcroot-abspath>
    </wc-info>
  </entry>
</info>`);

    const result = await detector.detectWorkingCopyRelinks([
      { path: join(root, 'dev', 'wc'), repositoryUuid: 'uuid-1234' },
    ]);

    expect(mocks.runSvnText).toHaveBeenCalledWith(
      ['info', '--xml', '--', newPath],
      { cwd: newPath }
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      newPath,
      matchedOn: 'uuid',
      confidence: 'high',
    });

    vi.resetModules();
    vi.doUnmock('../../services/svn-executor');
  });
});
