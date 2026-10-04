// @vitest-environment node

import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  resolveSvnExecution: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
  resolveSvnExecution: mockState.resolveSvnExecution,
}));

vi.mock('node:child_process', () => ({
  execFile: mockState.execFile,
}));

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}));

import {
  createSampleRepository,
  localRepositoryUrl,
  resolveSvnadminCommand,
  SAMPLE_TREE,
  trunkUrlOf,
} from '../sample-repository';

describe('sample-repository pure helpers', () => {
  it('builds svn-compatible file:// URLs for local repository paths', () => {
    expect(localRepositoryUrl('C:\\dev\\repos\\sample')).toBe('file:///C:/dev/repos/sample');
    expect(localRepositoryUrl('D:/repos/sample')).toBe('file:///D:/repos/sample');
    expect(localRepositoryUrl('C:\\repo with space')).toBe('file:///C:/repo%20with%20space');
  });

  it.skipIf(process.platform === 'win32')(
    'builds POSIX file:// URLs from absolute paths',
    () => {
      expect(localRepositoryUrl('/srv/repos/sample')).toBe('file:///srv/repos/sample');
      expect(localRepositoryUrl('/a/repo with space')).toBe('file:///a/repo%20with%20space');
    }
  );

  it('joins the trunk URL onto the repository root', () => {
    expect(trunkUrlOf('file:///srv/repos/sample')).toBe('file:///srv/repos/sample/trunk');
  });

  it('seeds a multi-file text tree including the conventional layout targets', () => {
    expect(Object.keys(SAMPLE_TREE).length).toBeGreaterThanOrEqual(4);
    expect(SAMPLE_TREE['README.md']).toMatch(/sample project/);
    expect(Object.keys(SAMPLE_TREE).every((path) => !/[\\]/.test(path))).toBe(true);
  });

  it('resolves svnadmin next to the configured svn client', async () => {
    // Path manipulation goes through node:path, so expectations are built with
    // the same primitives — only the naming convention is under test.
    const { dirname, extname, join } = await import('node:path');
    const companion = (svnCommand: string) => {
      const directory = dirname(svnCommand);
      const name = `svnadmin${extname(svnCommand)}`;
      return directory === '.' ? name : join(directory, name);
    };

    mockState.resolveSvnExecution.mockResolvedValue({ svnCommand: '/opt/svn/bin/svn' });
    await expect(resolveSvnadminCommand()).resolves.toBe(companion('/opt/svn/bin/svn'));

    mockState.resolveSvnExecution.mockResolvedValue({ svnCommand: 'svn' });
    await expect(resolveSvnadminCommand()).resolves.toBe('svnadmin');

    mockState.resolveSvnExecution.mockResolvedValue({
      svnCommand: join('C:', 'Program Files', 'svn', 'bin', 'svn.exe'),
    });
    await expect(resolveSvnadminCommand()).resolves.toBe(
      companion(join('C:', 'Program Files', 'svn', 'bin', 'svn.exe'))
    );
  });
});

describe('createSampleRepository', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('');
    mockState.resolveSvnExecution.mockResolvedValue({ svnCommand: 'svn' });
    mockState.execFile.mockImplementation(
      (_cmd: string, _args: string[], _options: unknown, callback: unknown) => {
        (callback as (error: null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: '',
          stderr: '',
        });
      }
    );
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
    delete process.env.SHELLYSVN_SAMPLE_REPO_PATH;
  });

  it('creates and seeds the repository with a handful of commits', async () => {
    root = await mkdtemp(join(tmpdir(), 'sample-repo-'));
    process.env.SHELLYSVN_SAMPLE_REPO_PATH = root;

    // The mocked checkout must materialize files like a real one would, or the
    // follow-up edit-and-commit steps have nothing to append to.
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'checkout') {
        await cp(join(root, 'seed'), join(root, 'working-copy'), { recursive: true });
      }
      return '';
    });

    const result = await createSampleRepository();

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    const repositoryUrl = localRepositoryUrl(join(root, 'repo'));
    expect(result.repositoryUrl).toBe(repositoryUrl);
    expect(result.url).toBe(`${repositoryUrl}/trunk`);

    // svnadmin create ran against the repo directory (promisify appends the
    // callback as a trailing argument).
    expect(mockState.execFile).toHaveBeenCalledWith(
      'svnadmin',
      ['create', join(root, 'repo')],
      expect.anything(),
      expect.any(Function)
    );

    const argv = mockState.runSvnText.mock.calls.map((call) => call[0] as string[]);
    // r1: standard layout; r2: initial import; then checkout + two follow-up commits.
    expect(argv[0]?.slice(0, 2)).toEqual(['mkdir', '-m']);
    expect(argv[0]).toEqual(expect.arrayContaining([`${result.repositoryUrl}/trunk`, `${result.repositoryUrl}/branches`, `${result.repositoryUrl}/tags`]));
    expect(argv[1]?.[0]).toBe('import');
    expect(argv[2]?.[0]).toBe('checkout');
    expect(argv.filter((args) => args[0] === 'commit')).toHaveLength(2);

    // The seeded tree was written to disk before the import.
    await expect(
      readFile(join(root, 'seed', 'src', 'util.h'), 'utf8')
    ).resolves.toContain('helper');
  });

  it('reuses an existing playground instead of recreating it', async () => {
    root = await mkdtemp(join(tmpdir(), 'sample-repo-'));
    process.env.SHELLYSVN_SAMPLE_REPO_PATH = root;
    // Simulate an svnadmin-created repository (it contains a db directory).
    await mkdir(join(root, 'repo', 'db'), { recursive: true });

    const result = await createSampleRepository();

    expect(result).toMatchObject({ success: true, created: false });
    expect(mockState.execFile).not.toHaveBeenCalled();
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('cleans up a partial playground and reports the failure', async () => {
    root = await mkdtemp(join(tmpdir(), 'sample-repo-'));
    process.env.SHELLYSVN_SAMPLE_REPO_PATH = root;
    mockState.execFile.mockImplementation(
      (_cmd: string, _args: string[], _options: unknown, callback: unknown) =>
        (callback as (error: Error) => void)(new Error("svnadmin: E165002: 'repo' already exists"))
    );

    const result = await createSampleRepository();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/E165002/);
    // The failed root was removed so the step can be retried.
    await expect(stat(root)).rejects.toThrow();
  });
});
