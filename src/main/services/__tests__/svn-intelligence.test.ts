import type { SvnLogEntry } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mocks = vi.hoisted(() => ({
  getLog: vi.fn(),
  getMergeInfo: vi.fn(),
  getUrlDiff: vi.fn(),
  runSvnText: vi.fn(),
  assertPathApprovedForIpc: vi.fn((path: string) => path),
  assertPathApprovedForIpcAsync: vi.fn((path: string) => path),
}));
vi.mock('../svn-history', () => ({
  getLog: mocks.getLog,
  getMergeInfo: mocks.getMergeInfo,
  getUrlDiff: mocks.getUrlDiff,
}));
vi.mock('../svn-executor', () => ({ runSvnText: mocks.runSvnText }));
vi.mock('../../utils/approved-paths', () => ({
  assertPathApprovedForIpc: mocks.assertPathApprovedForIpc,
  assertPathApprovedForIpcAsync: mocks.assertPathApprovedForIpc,
}));

import { compareBranches } from '../svn-branch-comparison';
import { getMergeReadiness } from '../svn-merge-readiness';
import { getRevisionImpact } from '../svn-revision-impact';
import { validateRepositoryUrl } from '../svn-intelligence-validation';

const entry = (revision: number, paths: SvnLogEntry['paths']): SvnLogEntry => ({
  revision,
  author: 'jordan',
  date: '2026-01-01T00:00:00Z',
  message: `r${revision}`,
  paths,
});
const infoXml = (uuid: string, url: string) =>
  `<?xml version="1.0"?><info><entry kind="dir" path="." revision="20"><url>${url}</url><repository><root>https://svn.example.test/repo</root><uuid>${uuid}</uuid></repository><commit revision="20"><author>jordan</author><date>2026-01-01T00:00:00Z</date></commit></entry></info>`;

describe('deterministic SVN intelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPathApprovedForIpc.mockImplementation((path: string) => path);
  });

  it('rejects unsupported URLs, embedded credentials, and control characters', async () => {
    await expect(validateRepositoryUrl('javascript:alert(1)', 'Branch')).rejects.toThrow(
      /unsupported/i
    );
    await expect(
      validateRepositoryUrl('https://user:secret@example.test/repo', 'Branch')
    ).rejects.toThrow(/credentials/i);
    await expect(
      validateRepositoryUrl('https://example.test/repo\n--force', 'Branch')
    ).rejects.toThrow(/control/i);
  });

  it('subjects local repository URLs to the approved-path boundary', async () => {
    mocks.assertPathApprovedForIpc.mockImplementation(() => {
      throw new Error('not approved');
    });
    // pathToFileURL/resolve keep the fixture valid on every host: file URLs
    // without a drive letter cannot be converted to a Windows path at all.
    const localPath = resolve('/private/repository');
    await expect(validateRepositoryUrl(pathToFileURL(localPath).href, 'Branch')).rejects.toThrow(
      /not approved/i
    );
    expect(mocks.assertPathApprovedForIpc).toHaveBeenCalledWith(localPath, 'Branch');
    // Drive-less file URLs are structurally invalid on Windows and must be
    // rejected as validation errors, not as Node internal TypeErrors.
    await expect(validateRepositoryUrl('file:///private/repository', 'Branch')).rejects.toThrow(
      /must not use a remote file URL|does not name a valid local path|not approved/i
    );
  });

  it('derives evidence-backed revision impact groups from bounded log paths', async () => {
    mocks.getLog.mockResolvedValue({
      entries: [
        entry(12, [
          { action: 'M', path: '/trunk/src/auth.ts' },
          { action: 'A', path: '/trunk/tests/auth.test.ts' },
          { action: 'M', path: '/trunk/README.md' },
          { action: 'M', path: '/trunk/config/app.yml' },
          { action: 'A', path: '/tags/1.2.0' },
        ]),
      ],
    });
    const report = await getRevisionImpact('https://svn.example.test/repo/trunk', 1, 12);
    expect(mocks.getLog).toHaveBeenCalledWith('https://svn.example.test/repo/trunk', 1, 12, 12);
    expect(report.groups.map((group) => group.category)).toEqual([
      'source',
      'test',
      'documentation',
      'configuration',
      'branch-or-tag',
    ]);
    expect(report.groups[1]?.evidence[0]).toEqual({
      revision: 12,
      path: '/trunk/tests/auth.test.ts',
      action: 'A',
    });
  });

  it('blocks merge readiness on repository and status evidence', async () => {
    mocks.runSvnText.mockImplementation((args: string[]) => {
      if (args[0] === 'status')
        return `<?xml version="1.0"?><status><target path="/wc"><entry path="conflicted.ts"><wc-status item="conflicted" props="none" revision="20"/></entry><entry path="switched"><wc-status item="normal" props="none" revision="20" switched="true"/></entry><entry path="external"><wc-status item="external" props="none"/></entry></target></status>`;
      return args.includes('https://svn.example.test/repo/branches/feature')
        ? infoXml('source-repository', 'https://svn.example.test/repo/branches/feature')
        : infoXml('target-repository', 'https://svn.example.test/repo/trunk');
    });
    mocks.getMergeInfo
      .mockResolvedValueOnce({ revisions: [10, 11] })
      .mockResolvedValueOnce({ revisions: [1, 2] });
    const report = await getMergeReadiness('https://svn.example.test/repo/branches/feature', '/wc');
    expect(report.ready).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'repository-mismatch', severity: 'blocker' }),
        expect.objectContaining({ kind: 'conflicts', severity: 'blocker' }),
        expect.objectContaining({ kind: 'switched-paths' }),
        expect.objectContaining({ kind: 'externals' }),
      ])
    );
  });

  it('returns one branch result with diff and revision-set evidence', async () => {
    const diff = {
      hasChanges: true,
      files: [{ oldPath: '/trunk/a.ts', newPath: '/branches/feature/a.ts', hunks: [] }],
    };
    mocks.getUrlDiff.mockResolvedValue(diff);
    mocks.getLog
      .mockResolvedValueOnce({ entries: [entry(10, []), entry(8, [])] })
      .mockResolvedValueOnce({
        entries: [entry(11, [{ action: 'M', path: '/branches/feature/a.ts' }]), entry(8, [])],
      });
    const result = await compareBranches(
      'https://svn.example.test/repo/trunk',
      'https://svn.example.test/repo/branches/feature'
    );
    expect(result.diff).toBe(diff);
    expect(result.summary.leftOnlyRevisions).toEqual([10]);
    expect(result.summary.rightOnlyRevisions).toEqual([11]);
    expect(result.summary.changedFiles).toHaveLength(1);
  });
});
