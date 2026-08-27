// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  excludeFromWorkingCopy: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-working-copy', () => ({
  excludeFromWorkingCopy: mockState.excludeFromWorkingCopy,
}));

import { repairWorkingCopy } from '../svn-working-copy-repair';
import type { SvnWorkingCopyRepairProgress } from '@shared/types';

const ROOT = 'C:\\wc';

function paths(count: number, prefix = 'src'): string[] {
  return Array.from({ length: count }, (_, index) => `${ROOT}\\${prefix}\\file${index}.txt`);
}

beforeEach(() => {
  mockState.runSvnText.mockReset();
  mockState.runSvnText.mockResolvedValue('');
  mockState.excludeFromWorkingCopy.mockReset();
  mockState.excludeFromWorkingCopy.mockResolvedValue({ success: true });
});

describe('svn-working-copy-repair', () => {
  it('restores missing files in chunks with exact-path revert', async () => {
    const files = paths(450, 'Clients/BESA/www');

    const result = await repairWorkingCopy({
      workingCopyPath: ROOT,
      restoreFiles: files,
      completeDirs: [],
      excludeDirs: [],
    });

    expect(result).toEqual({
      success: true,
      restored: 0,
      completedDirs: 0,
      excludedDirs: 0,
      stepErrors: [],
    });
    const revertCalls = mockState.runSvnText.mock.calls.map((call) => call[0] as string[]);
    expect(revertCalls).toHaveLength(3);
    // Chunks of 200, 200, then the 50-file remainder.
    expect(revertCalls[0]?.slice(-200)).toEqual(files.slice(0, 200));
    expect(revertCalls[1]?.slice(-200)).toEqual(files.slice(200, 400));
    expect(revertCalls[2]).toHaveLength(50 + 4); // args + `--` + 50 targets
    expect(revertCalls[2]?.slice(0, 3)).toEqual(['revert', '--depth', 'empty']);
  });

  it('cleans up before completing directories and reports per-directory progress', async () => {
    const progress: SvnWorkingCopyRepairProgress[] = [];

    const result = await repairWorkingCopy(
      {
        workingCopyPath: ROOT,
        restoreFiles: [],
        completeDirs: [`${ROOT}\\Clients\\A`, `${ROOT}\\Clients\\B`],
        excludeDirs: [],
      },
      (step) => progress.push(step)
    );

    expect(result.completedDirs).toBe(2);
    expect(result.success).toBe(true);
    const steps = mockState.runSvnText.mock.calls.map((call) => (call[0] as string[])[0]);
    expect(steps[0]).toBe('cleanup');
    expect(steps.filter((step) => step === 'update')).toHaveLength(2);
    expect(progress.map((entry) => entry.step)).toEqual([
      'cleanup',
      'complete',
      'complete',
    ]);
    expect(progress.at(-1)).toMatchObject({ step: 'complete', completed: 2, total: 2 });
  });

  it('skips the cleanup pass when nothing needs completing', async () => {
    await repairWorkingCopy({
      workingCopyPath: ROOT,
      restoreFiles: paths(1),
      completeDirs: [],
      excludeDirs: [],
    });

    const commands = mockState.runSvnText.mock.calls.map((call) => (call[0] as string[])[0]);
    expect(commands).toEqual(['revert']);
  });

  it('routes exclusions through the remove-from-working-copy tool', async () => {
    const result = await repairWorkingCopy({
      workingCopyPath: ROOT,
      restoreFiles: [],
      completeDirs: [],
      excludeDirs: [`${ROOT}\\Clients\\Gone`],
    });

    expect(result.excludedDirs).toBe(1);
    expect(mockState.excludeFromWorkingCopy).toHaveBeenCalledWith([`${ROOT}\\Clients\\Gone`]);
  });

  it('records chunk failures and keeps repairing the remaining files', async () => {
    const files = paths(400);
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      // Fail exactly the second chunk (['revert','--depth','empty','--',200
      // targets] — 204 argv entries, first target file200.txt).
      const argv = args as string[];
      if (argv.length === 204 && argv.includes(`${ROOT}\\src\\file200.txt`)) {
        throw new Error('svn: E155004: working copy locked');
      }
      return '';
    });

    const result = await repairWorkingCopy({
      workingCopyPath: ROOT,
      restoreFiles: files,
      completeDirs: [],
      excludeDirs: [],
    });

    expect(result.success).toBe(false);
    expect(result.stepErrors).toHaveLength(1);
    expect(result.stepErrors[0]).toContain('file200.txt');
    expect(mockState.runSvnText).toHaveBeenCalledTimes(2);
  });

  it('reports exclusion tool failures instead of throwing', async () => {
    mockState.excludeFromWorkingCopy.mockResolvedValue({
      success: false,
      error: 'local-only files could not be moved to the trash',
    });

    const result = await repairWorkingCopy({
      workingCopyPath: ROOT,
      restoreFiles: [],
      completeDirs: [],
      excludeDirs: [`${ROOT}\\Clients\\Gone`],
    });

    expect(result.success).toBe(false);
    expect(result.stepErrors[0]).toContain('trash');
  });
});
