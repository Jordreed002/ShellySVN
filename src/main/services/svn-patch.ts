import { writeFile } from 'fs/promises';

import type { SvnPatchApplyOptions, SvnPatchResult } from '@shared/types';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';

export async function createPatch(
  paths: string[],
  outputPath: string
): Promise<{ success: boolean; output: string }> {
  try {
    validateSvnTargets(paths, 'Patch target');
    const output = await runSvnText(withSvnTargets(['diff'], paths));
    await writeFile(outputPath, output, 'utf-8');
    return { success: true, output };
  } catch (error) {
    debug.error('[SVN] Patch create error:', error);
    return { success: false, output: (error as Error).message };
  }
}

export async function applyPatch(
  patchPath: string,
  targetPath: string,
  dryRun?: boolean,
  options: SvnPatchApplyOptions = {}
): Promise<SvnPatchResult> {
  try {
    validateSvnTargets([patchPath, targetPath], 'Patch target');
    if (
      options.stripCount !== undefined &&
      (!Number.isInteger(options.stripCount) || options.stripCount < 0 || options.stripCount > 100)
    ) {
      throw new Error('Patch strip count must be an integer between 0 and 100');
    }
    const args = ['patch'];
    if (dryRun) args.push('--dry-run');
    if (options.reverse) args.push('--reverse-diff');
    if (options.ignoreWhitespace) args.push('--ignore-whitespace');
    if (options.stripCount !== undefined) args.push('--strip', String(options.stripCount));

    const output = await runSvnText(withSvnTargets(args, [patchPath, targetPath]));
    const actionLines = output.match(/^[ADUGC]\s+.+$/gm) ?? [];
    const rejectedHunks = output.match(/^>.*(?:rejected|FAILED).*$/gim) ?? [];
    const textualRejectedHunks = output.match(/^Rejected hunk(?! saved).*$/gim) ?? [];
    const conflictLines = actionLines.filter((line) => line.startsWith('C'));
    const conflictPaths = conflictLines.map((line) => line.slice(1).trim()).filter(Boolean);
    const explicitRejectCount = Number(output.match(/\b(\d+)\s+rejects?\b/i)?.[1] ?? 0);
    const filesPatched = new Set(actionLines.map((line) => line.slice(1).trim()).filter(Boolean))
      .size;
    const rejects = Math.max(
      explicitRejectCount,
      rejectedHunks.length + textualRejectedHunks.length + conflictLines.length
    );
    const offsetHunks = (output.match(/^>.*\bwith offset\b.*$/gim) ?? []).length;
    const fuzzedHunks = (output.match(/^>.*\bfuzz\b.*$/gim) ?? []).length;
    const rejectFiles = Array.from(
      new Set([
        ...(output.match(/\S+\.svnpatch\.rej\b/g) ?? []),
        ...conflictPaths.map((path) => `${path}.svnpatch.rej`),
      ])
    );
    const appliedWithConflicts = rejects > 0 || conflictPaths.length > 0;

    return {
      success: !appliedWithConflicts && !/(?:^|\s)(?:failed|rejected)(?:\s|$)/i.test(output),
      appliedWithConflicts,
      filesPatched,
      rejects,
      rejectFiles,
      offsetHunks,
      fuzzedHunks,
      output,
    };
  } catch (error) {
    debug.error('[SVN] Patch apply error:', error);
    return {
      success: false,
      appliedWithConflicts: false,
      filesPatched: 0,
      rejects: 0,
      rejectFiles: [],
      offsetHunks: 0,
      fuzzedHunks: 0,
      output: (error as Error).message,
    };
  }
}
