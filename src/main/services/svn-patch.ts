import { writeFile } from 'fs/promises';

import type { SvnPatchResult } from '@shared/types';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';

export async function createPatch(
  paths: string[],
  outputPath: string
): Promise<{ success: boolean; output: string }> {
  try {
    const output = await runSvnText(['diff', ...paths]);
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
  dryRun?: boolean
): Promise<SvnPatchResult> {
  try {
    const args = ['patch', patchPath, targetPath];
    if (dryRun) args.push('--dry-run');

    const output = await runSvnText(args);
    const filesPatchedMatch = output.match(/Patched\s+(\d+)\s+files?/i);
    const rejectsMatch = output.match(/(\d+)\s+rejects?/i);

    return {
      success: !output.includes('FAILED') && !output.includes('rejected'),
      filesPatched: filesPatchedMatch ? parseInt(filesPatchedMatch[1], 10) : 0,
      rejects: rejectsMatch ? parseInt(rejectsMatch[1], 10) : 0,
      output,
    };
  } catch (error) {
    debug.error('[SVN] Patch apply error:', error);
    return {
      success: false,
      filesPatched: 0,
      rejects: 0,
      output: (error as Error).message,
    };
  }
}
