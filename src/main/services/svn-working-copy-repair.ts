import type {
  SvnWorkingCopyRepairPlan,
  SvnWorkingCopyRepairProgress,
  SvnWorkingCopyRepairResult,
} from '@shared/types';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { debug } from '../utils/debug';
import { parseSvnStatusEntriesXml } from '../utils/svn-xml';
import { runSvnText } from './svn-executor';
import { runSerializedWorkingCopyMutation } from './svn-mutation-queue';
import { excludeFromWorkingCopy } from './svn-working-copy';

/**
 * `svn revert` accepts a bounded target list comfortably, and the Windows
 * command line caps argv far below what a 38,000-file repair needs in one
 * process. Chunks are small enough that each invocation stays fast and
 * progress stays granular, large enough that per-spawn overhead is noise.
 */
const RESTORE_CHUNK_SIZE = 200;

export type RepairProgressSink = (progress: SvnWorkingCopyRepairProgress) => void;

async function isAbsentOnDisk(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function findStillMissingFiles(paths: string[]): Promise<string[]> {
  const xml = await runSvnText(withSvnTargets(['status', '--xml', '--depth', 'empty'], paths));
  if (!xml.includes('<status') || !xml.includes('</status>')) {
    throw new Error('Could not verify status before restoring missing files.');
  }
  const missing = new Set(
    parseSvnStatusEntriesXml(xml, true)
      .filter((entry) => entry.item === 'missing')
      .map((entry) => {
        if (entry.treeConflicted || (entry.props && !['none', 'normal'].includes(entry.props))) {
          throw new Error(
            `Resolve the local changes at ${entry.path} before restoring this batch.`
          );
        }
        return resolve(entry.path);
      })
  );
  const candidates = paths.filter((path) => missing.has(resolve(path)));
  // Status comes from SVN metadata. Check disk again, including dangling links,
  // to catch files restored while the fresh scan was running.
  const absent = await Promise.all(candidates.map(isAbsentOnDisk));
  return candidates.filter((_, index) => absent[index]);
}

/**
 * Execute a fix-wizard repair plan: bring missing files back from the local
 * pristine store, complete missing/incomplete directories from the
 * repository, and drop directories from the checkout — in that order, so
 * cleanup runs before anything that needs the administrative area healthy
 * and exclusions happen last (they are the only step that throws information
 * away). Every step is idempotent: an interrupted repair can simply be run
 * again, and already-repaired paths revert/update/exclude as no-ops.
 *
 * Before reverting exact paths, verify fresh SVN status and disk presence.
 */
export async function repairWorkingCopy(
  plan: SvnWorkingCopyRepairPlan,
  onProgress?: RepairProgressSink
): Promise<SvnWorkingCopyRepairResult> {
  validateSvnTargets([plan.workingCopyPath], 'Working copy');
  // Any section of the plan may legitimately be empty (a repair can, say,
  // only drop directories), so each list is validated only when it has work.
  for (const [label, targets] of [
    ['Restore target', plan.restoreFiles],
    ['Complete target', plan.completeDirs],
    ['Exclude target', plan.excludeDirs],
  ] as const) {
    if (targets.length > 0) validateSvnTargets(targets, label);
  }

  const result: SvnWorkingCopyRepairResult = {
    success: true,
    restored: 0,
    completedDirs: 0,
    excludedDirs: 0,
    stepErrors: [],
  };
  const report = (progress: SvnWorkingCopyRepairProgress) => {
    try {
      onProgress?.(progress);
    } catch (error) {
      debug.warn('[SVN] Repair progress listener failed:', error);
    }
  };
  // One bad path must not abandon the remaining thousands: per-chunk and
  // per-directory failures are recorded and the plan carries on.
  const recordFailure = (step: string, path: string, error: unknown) => {
    result.success = false;
    const message = error instanceof Error ? error.message : String(error);
    result.stepErrors.push(`${step} ${path}: ${message}`);
    debug.error(`[SVN] Repair ${step} failed for ${path}:`, error);
  };

  const restoreAndComplete = async () => {
    if (plan.completeDirs.length > 0) {
      // Interrupted updates leave administrative locks behind; clear them
      // before revert/update touch the working copy.
      report({ step: 'cleanup', completed: 0, total: 0 });
      await runSvnText(withSvnTargets(['cleanup'], [plan.workingCopyPath]));
    }

    for (let offset = 0; offset < plan.restoreFiles.length; offset += RESTORE_CHUNK_SIZE) {
      const chunk = plan.restoreFiles.slice(offset, offset + RESTORE_CHUNK_SIZE);
      try {
        const missing = await findStillMissingFiles(chunk);
        if (missing.length > 0) {
          await runSvnText(withSvnTargets(['revert', '--depth', 'empty'], missing));
          result.restored += missing.length;
        }
      } catch (error) {
        recordFailure('restore', `${chunk.length} path(s) at ${chunk[0]}`, error);
      }
      report({
        step: 'restore',
        completed: Math.min(offset + RESTORE_CHUNK_SIZE, plan.restoreFiles.length),
        total: plan.restoreFiles.length,
        currentPath: chunk[chunk.length - 1],
      });
    }

    for (const [index, dir] of plan.completeDirs.entries()) {
      try {
        await runSvnText(withSvnTargets(['update', '--depth', 'infinity'], [dir]));
        result.completedDirs += 1;
      } catch (error) {
        recordFailure('complete', dir, error);
      }
      report({
        step: 'complete',
        completed: index + 1,
        total: plan.completeDirs.length,
        currentPath: dir,
      });
    }
  };

  try {
    if (plan.restoreFiles.length > 0 || plan.completeDirs.length > 0) {
      await runSerializedWorkingCopyMutation(plan.workingCopyPath, restoreAndComplete);
    }

    // Exclusion takes the mutation lock itself and rechecks the working copy
    // after restoring files. Keep it outside the preceding queue callback.
    if (plan.excludeDirs.length > 0) {
      const exclusion = await excludeFromWorkingCopy(plan.excludeDirs);
      if (exclusion.success) {
        result.excludedDirs = plan.excludeDirs.length;
      } else {
        result.success = false;
        result.stepErrors.push(`exclude: ${exclusion.error ?? 'exclusion failed'}`);
      }
      report({
        step: 'exclude',
        completed: plan.excludeDirs.length,
        total: plan.excludeDirs.length,
      });
    }
  } catch (error) {
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return result;
}
