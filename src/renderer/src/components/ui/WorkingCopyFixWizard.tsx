/**
 * Working-copy fix wizard (renderer).
 *
 * Walks through the damage a status scan reports for a working copy and
 * applies the repair the user picks per group:
 *
 * - Missing files (`!`) are grouped by the directory that contains them;
 *   each group can be restored from the local pristine store (a chunked,
 *   exact-path `svn revert` — offline, and local edits elsewhere are never
 *   touched), removed from the working copy via the sticky-exclude tool
 *   (repository untouched, local-only leftovers trashed), or skipped.
 * - Missing/incomplete directories are completed with cleanup + update
 *   (repository access needed).
 *
 * The plan itself executes in the main process (`svn:repairWorkingCopy`);
 * this dialog only analyzes status data, collects the choices, and renders
 * progress for the four repair steps.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  HardDriveDownload,
  Loader2,
} from 'lucide-react';
import type {
  SvnStatusEntry,
  SvnWorkingCopyRepairPlan,
  SvnWorkingCopyRepairProgress,
  SvnWorkingCopyRepairResult,
} from '@shared/types';

import { DialogBase } from './DialogBase';
import { svnStatus } from '@renderer/lib/queryKeys';

export interface WorkingCopyFixWizardProps {
  isOpen: boolean;
  onClose: () => void;
  workingCopyPath: string;
  /** Fired after a repair plan ran, before the dialog closes. */
  onRepaired?: (result: SvnWorkingCopyRepairResult) => void;
}

type GroupAction = 'restore' | 'exclude' | 'skip';

interface MissingGroup {
  /** Directory (under the working copy root) that contains the group. */
  groupPath: string;
  /** Path relative to the working copy root, for display. */
  label: string;
  files: SvnStatusEntry[];
  /** Tracked/untracked entries inside the group that are not themselves missing. */
  otherEntries: SvnStatusEntry[];
  action: GroupAction;
}

const SEPARATORS = /[/\\]/;

function joinPath(root: string, segment: string): string {
  return `${root.replace(/[\\/]+$/, '')}\\${segment}`;
}

/**
 * Bucket missing files by their second-level directory under the working
 * copy root (`C:\wc\Clients\<site>\…` → `Clients\<site>`), which is the
 * granularity a whole-folder decision (restore vs remove) makes sense at.
 */
function groupMissingFiles(root: string, entries: SvnStatusEntry[]): MissingGroup[] {
  const groups = new Map<string, MissingGroup>();
  const trimmedRoot = root.replace(/[\\/]+$/, '');
  for (const entry of entries) {
    if (entry.status !== '!' || entry.isDirectory) continue;
    const relative = entry.path.startsWith(trimmedRoot)
      ? entry.path.slice(trimmedRoot.length).replace(/^[\\/]+/, '')
      : entry.path;
    const segments = relative.split(SEPARATORS).filter(Boolean);
    const key = segments.length > 2 ? segments.slice(0, 2).join('\\') : segments.join('\\');
    let group = groups.get(key);
    if (!group) {
      group = {
        groupPath: joinPath(trimmedRoot, key),
        label: key,
        files: [],
        otherEntries: [],
        action: 'restore',
      };
      groups.set(key, group);
    }
    group.files.push(entry);
  }
  return Array.from(groups.values()).sort((a, b) => b.files.length - a.files.length);
}

function collectOtherEntries(root: string, entries: SvnStatusEntry[], groups: MissingGroup[]): void {
  const trimmedRoot = root.replace(/[\\/]+$/, '');
  for (const entry of entries) {
    if (entry.status === '!') continue;
    const normalized = entry.path.replace(/^[\\/]+/, '');
    for (const group of groups) {
      const relativeGroup = group.groupPath.slice(trimmedRoot.length).replace(/^[\\/]+/, '');
      if (normalized.startsWith(relativeGroup + '\\')) {
        group.otherEntries.push(entry);
      }
    }
  }
}

const STEP_LABELS: Record<SvnWorkingCopyRepairProgress['step'], string> = {
  cleanup: 'Clearing leftover administrative locks…',
  restore: 'Restoring missing files from the local cache…',
  complete: 'Completing directories from the repository…',
  exclude: 'Removing directories from the working copy…',
};

export function WorkingCopyFixWizard({
  isOpen,
  onClose,
  workingCopyPath,
  onRepaired,
}: WorkingCopyFixWizardProps) {
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<MissingGroup[]>([]);
  const [completeDirs, setCompleteDirs] = useState<Map<string, boolean>>(new Map());
  const [phase, setPhase] = useState<'scanning' | 'choose' | 'applying' | 'done'>('scanning');
  const [progress, setProgress] = useState<SvnWorkingCopyRepairProgress | null>(null);
  const [result, setResult] = useState<SvnWorkingCopyRepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: svnStatus(workingCopyPath),
    queryFn: () => window.api.svn.status(workingCopyPath),
    enabled: isOpen,
    staleTime: 30_000,
  });

  const reset = useCallback(() => {
    setGroups([]);
    setCompleteDirs(new Map());
    setPhase('scanning');
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const analyze = useCallback(
    (entries: SvnStatusEntry[]) => {
      const nextGroups = groupMissingFiles(workingCopyPath, entries);
      collectOtherEntries(workingCopyPath, entries, nextGroups);
      setGroups(nextGroups);
      const dirs = entries.filter((entry) => entry.status === '!' && entry.isDirectory);
      setCompleteDirs(new Map(dirs.map((entry) => [entry.path, true])));
      setPhase(nextGroups.length === 0 && dirs.length === 0 ? 'done' : 'choose');
    },
    [workingCopyPath]
  );

  const closeAndReset = useCallback(() => {
    onClose();
    // Leave the behind-the-dialog state clean for the next open, but only
    // after the close so a fade-out never flashes a reset wizard.
    window.setTimeout(reset, 0);
  }, [onClose, reset]);

  // Move from scanning to choosing once the status scan lands.
  useEffect(() => {
    if (phase !== 'scanning' || statusQuery.isFetching || !statusQuery.data) return;
    analyze(statusQuery.data.entries);
  }, [analyze, phase, statusQuery.data, statusQuery.isFetching]);

  const setGroupAction = useCallback((groupPath: string, action: GroupAction) => {
    setGroups((previous) =>
      previous.map((group) => (group.groupPath === groupPath ? { ...group, action } : group))
    );
  }, []);

  const plan: SvnWorkingCopyRepairPlan = useMemo(
    () => ({
      workingCopyPath,
      restoreFiles: groups
        .filter((group) => group.action === 'restore')
        .flatMap((group) => group.files.map((file) => file.path)),
      completeDirs: Array.from(completeDirs.entries())
        .filter(([, enabled]) => enabled)
        .map(([path]) => path),
      excludeDirs: groups
        .filter((group) => group.action === 'exclude')
        .map((group) => group.groupPath),
    }),
    [completeDirs, groups, workingCopyPath]
  );

  const hasWork =
    plan.restoreFiles.length > 0 || plan.completeDirs.length > 0 || plan.excludeDirs.length > 0;

  const runRepair = useCallback(async () => {
    setPhase('applying');
    setError(null);
    try {
      const repairResult = await window.api.svn.repairWorkingCopy(plan, (repairProgress) =>
        setProgress(repairProgress)
      );
      setResult(repairResult);
      setPhase('done');
      await queryClient.invalidateQueries({ queryKey: svnStatus(workingCopyPath) });
      onRepaired?.(repairResult);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : String(repairError));
      setPhase('choose');
    }
  }, [onRepaired, plan, queryClient, workingCopyPath]);

  const totalMissing = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={phase === 'applying' ? () => undefined : closeAndReset}
      title="Fix working copy"
      dialogId="working-copy-fix-wizard"
      className="w-[620px]"
      ariaDescribedBy="fix-wizard-description"
    >
      <div className="modal-body space-y-4">
        <p id="fix-wizard-description" className="text-sm text-text-secondary">
          <span className="font-mono text-12 text-text">{workingCopyPath}</span>
        </p>

        {phase === 'scanning' && (
          <div className="space-y-2" data-testid="fix-wizard-scan">
            <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Scanning the working copy for missing and incomplete paths…
            </p>
            {statusQuery.isFetching && (
              <p className="text-11 text-text-faint">
                Large working copies can take a while to scan. The result is shared with the file
                list, so nothing is scanned twice.
              </p>
            )}
            {statusQuery.error && (
              <p className="flex items-start gap-2 rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 p-2.5 text-12.5 text-text-secondary" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
                {(statusQuery.error as Error).message}
              </p>
            )}
          </div>
        )}

        {phase === 'choose' && (
          <div className="space-y-4" data-testid="fix-wizard-choose">
            {groups.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text">
                  {totalMissing} missing file{totalMissing === 1 ? '' : 's'} in {groups.length}{' '}
                  folder{groups.length === 1 ? '' : 's'}
                </h3>
                <p className="text-12.5 leading-relaxed text-text-secondary">
                  Missing files are versioned but no longer on disk. Restoring brings them back
                  from the local pristine cache (offline, and only these exact paths — your other
                  changes are never reverted). Removing drops the folder from this checkout
                  without touching the repository; leftover unversioned files inside move to the
                  trash and <span className="font-mono text-11">svn update</span> can bring the
                  folder back later.
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1" data-testid="fix-wizard-groups">
                  {groups.map((group) => (
                    <div
                      key={group.groupPath}
                      className="rounded-lg border border-border bg-bg-tertiary p-2.5"
                      data-testid="fix-wizard-group"
                    >
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <span className="break-all font-mono text-11.5 text-text">{group.label}</span>
                        <span className="flex-shrink-0 text-11 text-text-muted">
                          {group.files.length} file{group.files.length === 1 ? '' : 's'}
                          {group.otherEntries.length > 0
                            ? ` · ${group.otherEntries.length} other change(s) inside`
                            : ''}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-12.5 text-text-secondary">
                        {(
                          [
                            ['restore', 'Restore from cache'],
                            ['exclude', 'Remove from working copy'],
                            ['skip', 'Skip'],
                          ] as Array<[GroupAction, string]>
                        ).map(([action, label]) => (
                          <label key={action} className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name={`fix-wizard-group-${group.label}`}
                              checked={group.action === action}
                              onChange={() => setGroupAction(group.groupPath, action)}
                              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {group.action === 'exclude' && group.otherEntries.length > 0 && (
                        <p className="mt-2 flex items-start gap-1.5 text-11.5 text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          The whole folder is removed, including the {group.otherEntries.length}{' '}
                          other changed/unversioned path
                          {group.otherEntries.length === 1 ? '' : 's'} inside it.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {completeDirs.size > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text">
                  {completeDirs.size} missing or incomplete folder{completeDirs.size === 1 ? '' : 's'}
                </h3>
                <p className="text-12.5 leading-relaxed text-text-secondary">
                  These were left behind by an interrupted update. Completing them runs
                  <span className="font-mono text-11"> svn cleanup</span> and then
                  <span className="font-mono text-11"> svn update</span>, which needs repository
                  access.
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {Array.from(completeDirs.keys()).map((dir) => (
                    <label key={dir} className="flex cursor-pointer items-center gap-2 text-12.5 text-text-secondary">
                      <input
                        type="checkbox"
                        checked={completeDirs.get(dir) === true}
                        onChange={(event) =>
                          setCompleteDirs((previous) => {
                            const next = new Map(previous);
                            next.set(dir, event.target.checked);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      />
                      <span className="break-all font-mono text-11">{dir}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p
                className="flex items-start gap-2 rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 p-2.5 text-12.5 text-text-secondary"
                role="alert"
                data-testid="fix-wizard-error"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        )}

        {phase === 'applying' && (
          <div className="space-y-3" data-testid="fix-wizard-progress" role="status">
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {progress ? STEP_LABELS[progress.step] : 'Preparing repair…'}
            </p>
            {progress && progress.total > 0 && (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="break-all font-mono text-11 text-text-muted">
                  {progress.completed} / {progress.total}
                  {progress.currentPath ? ` — ${progress.currentPath}` : ''}
                </p>
              </>
            )}
            <p className="text-11 text-text-faint">Keep the app open until the repair finishes.</p>
          </div>
        )}

        {phase === 'done' && !result && groups.length === 0 && completeDirs.size === 0 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-svn-normal/40 bg-svn-normal/10 p-3" data-testid="fix-wizard-nothing">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-normal" aria-hidden="true" />
            <p className="text-sm text-text-secondary">
              No missing or incomplete paths were found — this working copy needs no repair.
            </p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-3" data-testid="fix-wizard-summary">
            <div className="flex items-start gap-2.5 rounded-lg border border-svn-normal/40 bg-svn-normal/10 p-3">
              {result.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-normal" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
              )}
              <div className="min-w-0 space-y-1 text-sm text-text-secondary">
                <p className="font-semibold text-text">
                  {result.success ? 'Repair finished' : 'Repair finished with some failures'}
                </p>
                <p>
                  Restored {result.restored} file{result.restored === 1 ? '' : 's'}, completed{' '}
                  {result.completedDirs} folder{result.completedDirs === 1 ? '' : 's'}, removed{' '}
                  {result.excludedDirs} folder{result.excludedDirs === 1 ? '' : 's'}.
                </p>
                {result.stepErrors.length > 0 && (
                  <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 font-mono text-11 text-text-muted">
                    {result.stepErrors.slice(0, 20).map((stepError) => (
                      <li key={stepError} className="break-all">
                        {stepError}
                      </li>
                    ))}
                  </ul>
                )}
                {result.error && <p className="text-12.5 text-svn-conflict">{result.error}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer">
        {phase === 'choose' && (
          <>
            <button type="button" className="btn btn-secondary" onClick={closeAndReset}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary gap-1.5"
              onClick={() => void runRepair()}
              disabled={!hasWork}
              data-testid="fix-wizard-run"
            >
              <HardDriveDownload className="h-3.5 w-3.5" aria-hidden="true" />
              Run repairs
            </button>
          </>
        )}
        {(phase === 'scanning' || phase === 'done') && (
          <button type="button" className="btn btn-secondary" onClick={closeAndReset}>
            Close
          </button>
        )}
      </div>
    </DialogBase>
  );
}

export default WorkingCopyFixWizard;
