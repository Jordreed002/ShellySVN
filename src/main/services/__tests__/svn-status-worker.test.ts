import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  resolveSvnExecution: vi.fn(),
  run: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  resolveSvnExecution: mockState.resolveSvnExecution,
}));

vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: () => ({ run: mockState.run }),
}));

vi.mock('fs/promises', () => ({
  default: { readdir: mockState.readdir },
  readdir: mockState.readdir,
}));

import { getWorkerFsStatus, getWorkerSvnStatus } from '../svn-status-worker';

const EMPTY_STATUS = { directStatus: {}, allEntries: [] };
const mockReaddir = mockState.readdir;

describe('svn-status-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveSvnExecution.mockResolvedValue({
      svnCommand: 'svn',
      context: {},
    });
  });

  it('coalesces identical active filesystem status requests', async () => {
    let finishStatus: ((result: typeof EMPTY_STATUS) => void) | undefined;
    mockState.run.mockReturnValue(
      new Promise<typeof EMPTY_STATUS>((resolve) => {
        finishStatus = resolve;
      })
    );

    const first = getWorkerFsStatus('/repo/project', 'immediates');
    const duplicate = getWorkerFsStatus('/repo/project', 'immediates');

    await vi.waitFor(() => expect(mockState.run).toHaveBeenCalledTimes(1));
    expect(mockState.resolveSvnExecution).toHaveBeenCalledTimes(1);

    finishStatus?.(EMPTY_STATUS);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([EMPTY_STATUS, EMPTY_STATUS]);
  });

  it('allows a fresh request after the previous request settles', async () => {
    mockState.run.mockResolvedValue(EMPTY_STATUS);

    await getWorkerFsStatus('/repo/project', 'immediates');
    await getWorkerFsStatus('/repo/project', 'immediates');

    expect(mockState.run).toHaveBeenCalledTimes(2);
  });

  it('allows a retry after a shared request fails', async () => {
    mockState.run
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValueOnce(EMPTY_STATUS);

    const first = getWorkerFsStatus('/repo/retry', 'immediates');
    const duplicate = getWorkerFsStatus('/repo/retry', 'immediates');

    await expect(Promise.all([first, duplicate])).rejects.toThrow('status failed');
    await expect(getWorkerFsStatus('/repo/retry', 'immediates')).resolves.toEqual(EMPTY_STATUS);
    expect(mockState.run).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce different paths or depths', async () => {
    mockState.run.mockResolvedValue(EMPTY_STATUS);

    await Promise.all([
      getWorkerFsStatus('/repo/first', 'immediates'),
      getWorkerFsStatus('/repo/second', 'immediates'),
      getWorkerFsStatus('/repo/first', 'infinity'),
    ]);

    expect(mockState.run).toHaveBeenCalledTimes(3);
  });
});

/*
 * Unicode warnings (backlog item 29). macOS disks commonly store filenames
 * decomposed (NFD) while SVN records composed (NFC) text — and vice versa —
 * so recorded paths are compared with on-disk readdir names. On
 * case-insensitive filesystems, versioned entries differing only by case
 * collide on disk. Detection and reporting only: the result gains a single
 * additive, optional `unicodeWarnings` field.
 */
describe('svn-status-worker — unicode warnings', () => {
  const CAFE_NFC = 'caf\u00e9.txt';
  const CAFE_NFD = 'cafe\u0301.txt';
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveSvnExecution.mockResolvedValue({
      svnCommand: 'svn',
      context: {},
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  function stubPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
      writable: true,
    });
  }

  it('reports normalization mismatches against on-disk readdir names', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      directStatus: { [CAFE_NFC]: { status: '!' } },
      allEntries: [{ status: '!' as const, fullPath: `/repo/${CAFE_NFC}` }],
    });
    mockReaddir.mockResolvedValue(['other.txt', CAFE_NFD] as never);

    const result = await getWorkerFsStatus('/repo', 'immediates');

    expect(mockReaddir).toHaveBeenCalledWith('/repo');
    expect(result.unicodeWarnings).toEqual({
      normalizationMismatches: [
        {
          expected: `/repo/${CAFE_NFC}`,
          onDisk: `/repo/${CAFE_NFD}`,
          expectedForm: 'NFC',
          onDiskForm: 'NFD',
        },
      ],
      caseCollisions: [],
    });
  });

  it('reports case collisions between versioned entries on case-insensitive platforms', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      directStatus: {},
      allEntries: [
        { status: ' ' as const, fullPath: '/repo/Readme.md' },
        { status: '!' as const, fullPath: '/repo/README.md' },
      ],
    });

    const result = await getWorkerFsStatus('/repo', 'immediates');

    expect(result.unicodeWarnings).toEqual({
      normalizationMismatches: [],
      caseCollisions: [{ pathA: '/repo/Readme.md', pathB: '/repo/README.md' }],
    });
  });

  it('skips case-collision detection on case-sensitive platforms', async () => {
    stubPlatform('linux');
    mockState.run.mockResolvedValue({
      directStatus: {},
      allEntries: [
        { status: ' ' as const, fullPath: '/repo/Readme.md' },
        { status: ' ' as const, fullPath: '/repo/README.md' },
      ],
    });

    const result = await getWorkerFsStatus('/repo', 'immediates');

    expect(result.unicodeWarnings).toBeUndefined();
    expect('unicodeWarnings' in result).toBe(false);
  });

  it('leaves the result shape untouched and skips readdir for clean ASCII scans', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      directStatus: { 'file.txt': { status: 'M' } },
      allEntries: [{ status: 'M' as const, fullPath: '/repo/file.txt' }],
    });

    const result = await getWorkerFsStatus('/repo', 'immediates');

    // Fast pre-filter: pure-ASCII scans never hit the filesystem.
    expect(mockReaddir).not.toHaveBeenCalled();
    expect(result).toEqual({
      directStatus: { 'file.txt': { status: 'M' } },
      allEntries: [{ status: 'M', fullPath: '/repo/file.txt' }],
    });
    expect('unicodeWarnings' in result).toBe(false);
  });

  it('survives readdir failures without dropping the status result', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      directStatus: { [CAFE_NFC]: { status: '!' } },
      allEntries: [{ status: '!' as const, fullPath: `/repo/${CAFE_NFC}` }],
    });
    mockReaddir.mockRejectedValue(new Error('EACCES: permission denied') as never);

    const result = await getWorkerFsStatus('/repo', 'immediates');

    expect(result.unicodeWarnings).toBeUndefined();
    expect('unicodeWarnings' in result).toBe(false);
  });

  it('attaches unicode warnings to working-copy status results with relative entry paths', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      path: '/repo',
      revision: 1,
      entries: [{ path: CAFE_NFC, status: '!' as const }],
    });
    mockReaddir.mockResolvedValue([CAFE_NFD] as never);

    const result = await getWorkerSvnStatus('/repo');

    expect(mockReaddir).toHaveBeenCalledWith('/repo');
    expect(result.unicodeWarnings).toEqual({
      normalizationMismatches: [
        {
          expected: `/repo/${CAFE_NFC}`,
          onDisk: `/repo/${CAFE_NFD}`,
          expectedForm: 'NFC',
          onDiskForm: 'NFD',
        },
      ],
      caseCollisions: [],
    });
  });

  it('keeps remoteChecked on enriched show-updates results', async () => {
    stubPlatform('darwin');
    mockState.run.mockResolvedValue({
      path: '/repo',
      revision: 1,
      entries: [
        { path: 'Readme.md', status: ' ' as const },
        { path: 'README.md', status: '!' as const },
      ],
    });

    const result = await getWorkerSvnStatus('/repo', { showUpdates: true });

    expect(result.remoteChecked).toBe(true);
    expect(result.unicodeWarnings?.caseCollisions).toEqual([
      { pathA: '/repo/Readme.md', pathB: '/repo/README.md' },
    ]);
  });
});
