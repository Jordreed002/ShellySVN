/**
 * Patch Hub (#63).
 *
 * One surface for the whole patch lifecycle:
 *
 * - List previously created patches (index persisted via `window.api.store`,
 *   see `lib/patchHub.ts`).
 * - Create a new patch (reuses `CreatePatchDialog`, which reports the saved
 *   file back through `onSaved`).
 * - Apply with a `--dry-run` conflict preview before anything touches the
 *   working copy.
 * - Recover from rejected hunks: after an apply, scan the working copy for
 *   `.svnpatch.rej` / `.rej` files, show the rejected hunks in the context of
 *   the current file content, and offer "open file" plus re-apply guidance.
 * - Share a patch by copying its path or revealing it in the file manager.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ClipboardCopy,
  FileDiff,
  FileInput,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { SvnPatchApplyOptions, SvnPatchResult } from '@shared/types';
import {
  addPatchToIndex,
  dryRunHasConflicts,
  findRejectFiles,
  loadPatchIndex,
  locateHunkInContent,
  newPatchId,
  parseRejectFile,
  rejectFileTarget,
  removePatchFromIndex,
  summarizeDryRunOutput,
  type PatchHubEntry,
  type RejectContext,
  type RejectHunk,
} from '@renderer/lib/patchHub';
import { DialogBase } from './DialogBase';
import { CreatePatchDialog } from './CreatePatchDialog';

interface RejectHunkRecovery {
  rejectPath: string;
  targetPath: string;
  hunk: RejectHunk;
  context: RejectContext | null;
}

interface ApplyViewState {
  patch: PatchHubEntry;
  target: string;
  dryRun: SvnPatchResult | null;
  isDryRunning: boolean;
  applyResult: SvnPatchResult | null;
  isApplying: boolean;
  rejects: RejectHunkRecovery[];
  isScanning: boolean;
  error: string | null;
}

export interface PatchHubDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Working copy the hub operates on (apply target + default create path). */
  workingCopyPath: string;
  /** Invoked after a real apply so the caller can refresh status views. */
  onComplete?: () => void;
}

const ACTION_BADGE_CLASS: Record<string, string> = {
  U: 'text-info',
  A: 'text-success',
  D: 'text-error',
  G: 'text-warning',
  C: 'text-error font-semibold',
};

export function PatchHubDialog({
  isOpen,
  onClose,
  workingCopyPath,
  onComplete,
}: PatchHubDialogProps) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<ApplyViewState | null>(null);
  const [options, setOptions] = useState<SvnPatchApplyOptions>({ stripCount: 0 });

  const { data: patches = [], isLoading } = useQuery({
    queryKey: ['patch-hub:index', workingCopyPath],
    queryFn: loadPatchIndex,
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) {
      setShowCreate(false);
      setApplyState(null);
      setShareNotice(null);
      setOptions({ stripCount: 0 });
    }
  }, [isOpen]);

  const recordPatch = useCallback(
    async (patchPath: string) => {
      await addPatchToIndex({
        id: newPatchId(),
        name: patchPath.split(/[/\\]/).pop() ?? patchPath,
        path: patchPath,
        workingCopyPath,
        createdAt: new Date().toISOString(),
      });
      await queryClient.invalidateQueries({ queryKey: ['patch-hub:index', workingCopyPath] });
    },
    [queryClient, workingCopyPath]
  );

  const handleShare = async (entry: PatchHubEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
      setShareNotice(`Copied patch path: ${entry.path}`);
    } catch {
      setShareNotice(entry.path);
    }
    await window.api.external.revealPath(entry.path);
  };

  const handleAddExisting = async () => {
    const patchPath = await window.api.dialog.openFile([
      { name: 'Patch Files', extensions: ['patch', 'diff', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (patchPath) await recordPatch(patchPath);
  };

  const handleRemove = async (entry: PatchHubEntry) => {
    await removePatchFromIndex(entry.path);
    await queryClient.invalidateQueries({ queryKey: ['patch-hub:index', workingCopyPath] });
  };

  const runDryRun = async (patch: PatchHubEntry, target: string) => {
    setApplyState((state) => (state ? { ...state, isDryRunning: true, error: null } : state));
    try {
      const result = await window.api.svn.patch.apply(patch.path, target, true, options);
      setApplyState((state) =>
        state ? { ...state, dryRun: result, isDryRunning: false } : state
      );
    } catch (error) {
      setApplyState((state) =>
        state
          ? { ...state, isDryRunning: false, error: (error as Error).message }
          : state
      );
    }
  };

  const startApply = (patch: PatchHubEntry) => {
    const target = patch.workingCopyPath || workingCopyPath;
    setApplyState({
      patch,
      target,
      dryRun: null,
      isDryRunning: true,
      applyResult: null,
      isApplying: false,
      rejects: [],
      isScanning: false,
      error: null,
    });
    void runDryRun(patch, target);
  };

  const scanRejects = async (target: string, knownRejects: string[]) => {
    setApplyState((state) => (state ? { ...state, isScanning: true } : state));
    try {
      const rejectPaths = Array.from(
        new Set([...knownRejects, ...(await findRejectFiles(target, (dir) => window.api.fs.listDirectory(dir)))])
      );
      const recovery: RejectHunkRecovery[] = [];
      for (const rejectPath of rejectPaths) {
        const rejectRead = await window.api.fs.readFile(rejectPath);
        if (!rejectRead.success || !rejectRead.content) continue;
        const parsed = parseRejectFile(rejectRead.content);
        // Prefer the absolute path derived from the reject file's location;
        // the header path inside the file is often repo-relative.
        const targetPath = rejectFileTarget(rejectPath) || parsed.targetPath || rejectPath;
        let fileContent: string | null = null;
        const targetRead = await window.api.fs.readFile(targetPath);
        if (targetRead.success && typeof targetRead.content === 'string') {
          fileContent = targetRead.content;
        }
        for (const hunk of parsed.hunks) {
          recovery.push({
            rejectPath,
            targetPath,
            hunk,
            context: fileContent === null ? null : locateHunkInContent(fileContent, hunk),
          });
        }
      }
      setApplyState((state) => (state ? { ...state, rejects: recovery, isScanning: false } : state));
    } catch (error) {
      setApplyState((state) =>
        state
          ? { ...state, isScanning: false, error: (error as Error).message }
          : state
      );
    }
  };

  const applyForReal = async () => {
    if (!applyState) return;
    const { patch, target } = applyState;
    setApplyState((state) => (state ? { ...state, isApplying: true, error: null } : state));
    try {
      const result = await window.api.svn.patch.apply(patch.path, target, false, options);
      setApplyState((state) =>
        state ? { ...state, applyResult: result, isApplying: false } : state
      );
      onComplete?.();
      await queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] });
      if (result.appliedWithConflicts || result.rejects > 0 || result.rejectFiles.length > 0) {
        await scanRejects(target, result.rejectFiles);
      }
    } catch (error) {
      setApplyState((state) =>
        state
          ? { ...state, isApplying: false, error: (error as Error).message }
          : state
      );
    }
  };

  const dryRunSummary = applyState?.dryRun ? summarizeDryRunOutput(applyState.dryRun.output) : null;
  const conflictsPossible = dryRunSummary ? dryRunHasConflicts(dryRunSummary) : false;

  return (
    <>
      <DialogBase
        isOpen={isOpen}
        onClose={onClose}
        dialogId="patch-hub"
        title={
          <span className="flex items-center gap-2">
            <FileDiff className="w-5 h-5 text-accent" />
            Patch Hub
          </span>
        }
        className="w-[720px] max-h-[85vh] flex flex-col"
      >
        <div className="modal-body overflow-auto space-y-4">
          {applyState ? (
            <ApplyView
              state={applyState}
              summary={dryRunSummary}
              conflictsPossible={conflictsPossible}
              options={options}
              onOptionsChange={setOptions}
              onBack={() => setApplyState(null)}
              onRerunDryRun={() => void runDryRun(applyState.patch, applyState.target)}
              onApply={() => void applyForReal()}
              onRescan={() =>
                void scanRejects(applyState.target, applyState.applyResult?.rejectFiles ?? [])
              }
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="w-4 h-4" />
                  New patch
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleAddExisting()}
                >
                  <FileInput className="w-4 h-4" />
                  Add patch file…
                </button>
                {shareNotice && (
                  <span className="text-xs text-text-faint truncate" title={shareNotice}>
                    {shareNotice}
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
                </div>
              ) : patches.length === 0 ? (
                <div className="text-center py-8">
                  <FileDiff className="w-12 h-12 text-text-faint mx-auto mb-3" />
                  <p className="text-text-secondary">No patches yet</p>
                  <p className="text-xs text-text-faint mt-1">
                    Create a patch from your local changes, or add an existing patch file.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2" aria-label="Patch list">
                  {patches.map((entry) => (
                    <li
                      key={entry.id}
                      className="bg-bg-tertiary rounded-lg p-3 flex items-start gap-3"
                    >
                      <FileDiff className="w-5 h-5 text-accent mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text truncate" title={entry.path}>
                          {entry.name}
                        </p>
                        <p className="text-xs text-text-faint truncate">
                          {new Date(entry.createdAt).toLocaleString()} ·{' '}
                          <span className="font-mono">{entry.path}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => startApply(entry)}
                        >
                          <FileInput className="w-4 h-4" />
                          Apply…
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          title="Copy path and reveal patch file"
                          aria-label={`Share patch ${entry.name}`}
                          onClick={() => void handleShare(entry)}
                        >
                          <ClipboardCopy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm hover:text-error"
                          title="Remove from hub (file is kept)"
                          aria-label={`Remove patch ${entry.name} from hub`}
                          onClick={() => void handleRemove(entry)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </DialogBase>

      {showCreate && (
        <CreatePatchDialog
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          path={workingCopyPath}
          onSaved={(patchPath) => {
            void recordPatch(patchPath);
          }}
        />
      )}
    </>
  );
}

interface ApplyViewProps {
  state: ApplyViewState;
  summary: ReturnType<typeof summarizeDryRunOutput> | null;
  conflictsPossible: boolean;
  options: SvnPatchApplyOptions;
  onOptionsChange: (options: SvnPatchApplyOptions) => void;
  onBack: () => void;
  onRerunDryRun: () => void;
  onApply: () => void;
  onRescan: () => void;
}

function ApplyView({
  state,
  summary,
  conflictsPossible,
  options,
  onOptionsChange,
  onBack,
  onRerunDryRun,
  onApply,
  onRescan,
}: ApplyViewProps) {
  const { patch, target, dryRun, applyResult, rejects, isScanning } = state;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
          Back to hub
        </button>
        <span className="font-medium text-text truncate">{patch.name}</span>
      </div>

      <div>
        <div className="text-sm font-medium text-text-secondary mb-1.5">Apply to directory</div>
        <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
          {target}
        </div>
      </div>

      <fieldset className="rounded border border-border p-3 text-sm">
        <legend className="px-1 text-xs text-text-faint">Options</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.reverse ?? false}
              onChange={(event) =>
                onOptionsChange({ ...options, reverse: event.target.checked })
              }
            />
            Reverse patch
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.ignoreWhitespace ?? false}
              onChange={(event) =>
                onOptionsChange({ ...options, ignoreWhitespace: event.target.checked })
              }
            />
            Ignore whitespace
          </label>
          <label className="col-span-2 flex items-center gap-2">
            Strip path components
            <input
              aria-label="Strip path components"
              type="number"
              min={0}
              max={100}
              value={options.stripCount ?? 0}
              onChange={(event) =>
                onOptionsChange({ ...options, stripCount: Number(event.target.value) })
              }
              className="input w-20"
            />
          </label>
        </div>
      </fieldset>

      {/* Dry-run preview */}
      {state.isDryRunning && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" />
          Previewing patch (dry run)…
        </div>
      )}
      {dryRun && summary && !state.isDryRunning && (
        <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-secondary">Dry-run preview</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRerunDryRun}>
              <RefreshCw className="w-3.5 h-3.5" />
              Re-run
            </button>
          </div>
          {summary.actions.length > 0 ? (
            <ul className="text-sm font-mono space-y-0.5 max-h-40 overflow-auto">
              {summary.actions.map((action, index) => (
                <li key={`${action.path}-${index}`}>
                  <span className={ACTION_BADGE_CLASS[action.action] ?? ''}>{action.action}</span>{' '}
                  {action.path}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-faint">{dryRun.output || 'No file actions reported.'}</p>
          )}
          <p className="text-xs text-text-faint">
            {dryRun.filesPatched} file(s) · {summary.offsetHunks} offset hunks ·{' '}
            {summary.fuzzedHunks} fuzzed hunks
          </p>
          {conflictsPossible ? (
            <div
              className="flex items-start gap-2 text-sm text-warning bg-warning/10 border border-warning/30 rounded p-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Conflicts possible: {summary.conflicts.length} file(s) would conflict
                {summary.rejects > 0 ? ` and ${summary.rejects} hunk(s) would be rejected` : ''}.
                Applying may leave the working copy partially patched.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle className="w-4 h-4" />
              Dry run clean — no conflicts detected.
            </div>
          )}
        </div>
      )}

      {state.error && (
        <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {/* Real apply */}
      {applyResult ? (
        <div className="space-y-2">
          <div
            className={`flex items-center gap-2 text-sm rounded p-2 ${
              applyResult.success
                ? 'text-success bg-success/10'
                : 'text-warning bg-warning/10 border border-warning/30'
            }`}
          >
            {applyResult.success ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span>
              {applyResult.filesPatched} file(s) patched
              {applyResult.rejects > 0 ? `, ${applyResult.rejects} hunk(s) rejected` : ''}
              {applyResult.offsetHunks > 0 ? `, ${applyResult.offsetHunks} with offset` : ''}
              {applyResult.fuzzedHunks > 0 ? `, ${applyResult.fuzzedHunks} fuzzed` : ''}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.isApplying || state.isDryRunning}
            onClick={onApply}
          >
            {state.isApplying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileInput className="w-4 h-4" />
            )}
            Apply patch
          </button>
        </div>
      )}

      {/* Reject-file recovery */}
      {applyResult && (isScanning || rejects.length > 0 || applyResult.rejects > 0) && (
        <div className="space-y-3" data-testid="reject-recovery">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-text flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Rejected hunks ({rejects.length})
            </h4>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRescan}>
              <RefreshCw className="w-3.5 h-3.5" />
              Scan again
            </button>
          </div>
          <p className="text-xs text-text-faint">
            Hunks that could not be applied were saved as{' '}
            <span className="font-mono">.svnpatch.rej</span> files next to their targets. Resolve
            them manually (open the file and apply the highlighted lines), or revert the patch and
            re-apply after fixing the conflicts.
          </p>
          {isScanning && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning for reject files…
            </div>
          )}
          {rejects.map((reject, index) => (
            <div key={`${reject.rejectPath}-${index}`} className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 bg-bg-tertiary px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text truncate" title={reject.targetPath}>
                    {reject.targetPath.split(/[/\\]/).pop()}
                  </p>
                  <p className="text-xs text-text-faint truncate font-mono">
                    {reject.targetPath}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm flex-shrink-0"
                  onClick={() => void window.api.external.openFile(reject.targetPath)}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open file
                </button>
              </div>
              <div className="px-3 py-2">
                <p className="text-xs text-text-faint font-mono mb-1">{reject.hunk.header}</p>
                {!reject.context ? (
                  <p className="text-xs text-warning">
                    Target file unreadable — the rejected hunk is shown without file context.
                  </p>
                ) : (
                  !reject.context.matched && (
                    <p className="text-xs text-warning mb-1">
                      Context no longer matches (near line {reject.context.matchedAt}) — the file
                      changed since the patch was created.
                    </p>
                  )
                )}
                <pre className="text-xs font-mono overflow-auto max-h-48 bg-bg-secondary rounded p-2">
                  {(reject.context?.rows ?? reject.hunk.lines.map((line, i) => ({
                    lineNumber: -(i + 1),
                    text: line.text,
                    kind:
                      line.kind === 'add'
                        ? ('rejected-add' as const)
                        : line.kind === 'remove'
                          ? ('rejected-remove' as const)
                          : ('context' as const),
                  }))).map((row, rowIndex) => (
                    <div
                      key={rowIndex}
                      className={
                        row.kind === 'rejected-add'
                          ? 'text-success'
                          : row.kind === 'rejected-remove'
                            ? 'text-error'
                            : 'text-text-secondary'
                      }
                    >
                      {row.lineNumber > 0
                        ? String(row.lineNumber).padStart(4, ' ')
                        : '    '}
                      {'  '}
                      {row.kind === 'rejected-add' ? '+' : row.kind === 'rejected-remove' ? '-' : ' '}
                      {row.text}
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          ))}
          {rejects.length === 0 && !isScanning && (
            <p className="text-xs text-text-faint">
              No reject files found — rejected hunks may have been reported without a saved{' '}
              <span className="font-mono">.rej</span> file. Check the raw output above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PatchHubDialog;
