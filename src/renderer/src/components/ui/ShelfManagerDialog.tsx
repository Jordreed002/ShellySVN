/**
 * Shelf Manager (#64).
 *
 * A management surface on top of the shelve IPC (`svn:shelve:list` / `save` /
 * `apply` / `delete`, plus the rename / diff / portable export / portable
 * import channels):
 *
 * - Table of shelves with name, creation date and age.
 * - Expiry nudges: user-configurable max age (persisted via
 *   `lib/shelfManager.ts`); older shelves get a stale indicator and a
 *   delete prompt.
 * - Rename (inline edit), diff against the working copy or HEAD (patch text
 *   panel), export to a portable bundle directory, and import of a portable
 *   bundle into this working copy.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Archive,
  Check,
  Clock,
  Download,
  FileDiff,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { SvnShelve, SvnShelveDiffAgainst } from '@shared/types';
import {
  formatShelfAge,
  isShelfStale,
  loadShelfManagerConfig,
  saveShelfManagerConfig,
  shelfAgeDays,
} from '@renderer/lib/shelfManager';
import { confirmAppAction } from '../../utils/dialogs';
import { DialogBase } from './DialogBase';

export interface ShelfManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workingCopyPath: string;
}

interface DiffPanelState {
  name: string;
  against: SvnShelveDiffAgainst;
  diff: string;
}

export function ShelfManagerDialog({
  isOpen,
  onClose,
  workingCopyPath,
}: ShelfManagerDialogProps) {
  const queryClient = useQueryClient();
  const [maxAgeDaysInput, setMaxAgeDaysInput] = useState<string>('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [diffPanel, setDiffPanel] = useState<DiffPanelState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const { data: shelveData, isLoading } = useQuery({
    queryKey: ['svn:shelve:list', workingCopyPath],
    queryFn: () => window.api.svn.shelve.list(workingCopyPath),
    enabled: isOpen && !!workingCopyPath,
  });

  const { data: config } = useQuery({
    queryKey: ['shelf-manager:config'],
    queryFn: loadShelfManagerConfig,
    enabled: isOpen,
  });

  useEffect(() => {
    if (isOpen && config) {
      setMaxAgeDaysInput(config.maxAgeDays === null ? '' : String(config.maxAgeDays));
    }
  }, [isOpen, config]);

  const saveConfig = useMutation({
    mutationFn: (next: { maxAgeDays: number | null }) => saveShelfManagerConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shelf-manager:config'] }),
  });

  const invalidateShelves = () =>
    queryClient.invalidateQueries({ queryKey: ['svn:shelve:list', workingCopyPath] });

  const surfaceError = (error: unknown) =>
    setActionError(error instanceof Error ? error.message : String(error));

  const applyMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.apply(name, workingCopyPath),
    onSuccess: (result) => {
      if (!result.success) setActionError(result.error ?? 'Unshelve failed.');
      else setActionNotice(`Applied shelf changes to the working copy.`);
      void queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] });
    },
    onError: surfaceError,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.delete(name, workingCopyPath),
    onSuccess: (result) => {
      if (!result.success) setActionError(result.error ?? 'Delete failed.');
      else setActionNotice('Shelf deleted.');
      void invalidateShelves();
    },
    onError: surfaceError,
  });

  const renameMutation = useMutation({
    mutationFn: (input: { name: string; newName: string }) =>
      window.api.svn.shelve.rename(input.name, workingCopyPath, input.newName),
    onSuccess: (result, input) => {
      if (!result.success) {
        setActionError(result.error ?? 'Rename failed.');
        return;
      }
      setActionNotice(`Renamed shelf to "${input.newName}".`);
      setRenaming(null);
      setDiffPanel((panel) => (panel?.name === input.name ? null : panel));
      void invalidateShelves();
    },
    onError: surfaceError,
  });

  const diffMutation = useMutation({
    mutationFn: (input: { name: string; against: SvnShelveDiffAgainst }) =>
      window.api.svn.shelve.diff(input.name, workingCopyPath, input.against),
    onSuccess: (result, input) => {
      if (!result.success) {
        setActionError(result.error ?? 'Could not read the shelf diff.');
        return;
      }
      setDiffPanel({ name: input.name, against: input.against, diff: result.diff });
    },
    onError: surfaceError,
  });

  const exportMutation = useMutation({
    mutationFn: (input: { name: string; outputPath: string }) =>
      window.api.svn.shelve.export(input.name, workingCopyPath, input.outputPath),
    onSuccess: (result) => {
      if (!result.success) {
        setActionError(result.error ?? 'Shelf export failed.');
        return;
      }
      setActionNotice(
        result.output
          ? `Exported portable shelf bundle to ${result.output}`
          : 'Exported portable shelf bundle.'
      );
    },
    onError: surfaceError,
  });

  const importMutation = useMutation({
    mutationFn: (portableShelfPath: string) =>
      window.api.svn.shelve.import(portableShelfPath, workingCopyPath),
    onSuccess: (result) => {
      if (!result.success) {
        setActionError(result.error ?? 'Shelf import failed.');
        return;
      }
      setActionNotice(result.output ?? 'Imported portable shelf.');
      void invalidateShelves();
    },
    onError: surfaceError,
  });

  const maxAgeDays = config?.maxAgeDays ?? null;
  const shelves = shelveData?.shelves ?? [];
  const staleCount = shelves.filter((shelf) => isShelfStale(shelf.date, maxAgeDays)).length;

  const handleMaxAgeCommit = () => {
    const trimmed = maxAgeDaysInput.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    const next =
      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    saveConfig.mutate({ maxAgeDays: next });
  };

  const handleDelete = async (shelf: SvnShelve, stale: boolean) => {
    const confirmed = await confirmAppAction({
      type: stale ? 'warning' : 'error',
      message: stale
        ? `Shelf "${shelf.name}" is ${formatShelfAge(shelfAgeDays(shelf.date))} old. Delete it?`
        : `Delete shelf "${shelf.name}"?`,
      confirmLabel: 'Delete shelf',
    });
    if (confirmed) deleteMutation.mutate(shelf.name);
  };

  const handleDiff = (name: string, against: SvnShelveDiffAgainst) => {
    setActionError(null);
    diffMutation.mutate({ name, against });
  };

  const handleExport = async (name: string) => {
    setActionError(null);
    const outputPath = await window.api.dialog.openDirectory();
    if (!outputPath) return;
    exportMutation.mutate({ name, outputPath });
  };

  const handleImport = async () => {
    setActionError(null);
    const portableShelfPath = await window.api.dialog.openDirectory();
    if (!portableShelfPath) return;
    importMutation.mutate(portableShelfPath);
  };

  const startRename = (name: string) => {
    setActionError(null);
    setRenaming(name);
    setRenameValue(name);
  };

  const commitRename = () => {
    const newName = renameValue.trim();
    if (!renaming || !newName) return;
    renameMutation.mutate({ name: renaming, newName });
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      dialogId="shelf-manager"
      title={
        <span className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-accent" />
          Shelf Manager
        </span>
      }
      className="w-[680px] max-h-[85vh] flex flex-col"
    >
      <div className="modal-body overflow-auto space-y-4">
        {shelveData?.unsupportedReason && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm text-warning flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{shelveData.unsupportedReason}</span>
          </div>
        )}
        {shelveData?.error && (
          <div
            className="flex items-center gap-2 rounded bg-error/10 p-3 text-sm text-error"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" />
            {shelveData.error}
          </div>
        )}
        {actionError && (
          <div
            className="flex items-start justify-between gap-2 rounded bg-error/10 p-3 text-sm text-error"
            role="alert"
            data-testid="shelf-action-error"
          >
            <span className="break-words">{actionError}</span>
            <button
              type="button"
              className="btn-icon-sm flex-shrink-0"
              aria-label="Dismiss error"
              onClick={() => setActionError(null)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {actionNotice && (
          <div
            className="flex items-start justify-between gap-2 rounded bg-success/10 p-3 text-sm text-success"
            role="status"
            data-testid="shelf-action-notice"
          >
            <span className="break-words">{actionNotice}</span>
            <button
              type="button"
              className="btn-icon-sm flex-shrink-0"
              aria-label="Dismiss notice"
              onClick={() => setActionNotice(null)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Expiry nudge settings */}
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label
              htmlFor="shelf-max-age"
              className="text-xs font-medium text-text-secondary mb-1 block"
            >
              Nudge when shelves are older than (days)
            </label>
            <input
              id="shelf-max-age"
              type="number"
              min={1}
              value={maxAgeDaysInput}
              onChange={(event) => setMaxAgeDaysInput(event.target.value)}
              onBlur={handleMaxAgeCommit}
              placeholder="off"
              className="input w-28"
              disabled={saveConfig.isPending}
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleMaxAgeCommit}>
            Save
          </button>
          <span className="text-xs text-text-faint pb-2">
            Empty = nudges off. {staleCount > 0 ? `${staleCount} shelf(es) past the limit.` : ''}
          </span>
        </div>

        {staleCount > 0 && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm text-warning flex items-start gap-2">
            <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              {staleCount} shelf{staleCount !== 1 ? 'es' : ''} older than {maxAgeDays} day
              {maxAgeDays !== 1 ? 's' : ''}. Review them below — delete stale shelves you no
              longer need.
            </span>
          </div>
        )}

        {/* Shelf table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : shelves.length === 0 ? (
          <div className="text-center py-8">
            <Archive className="w-12 h-12 text-text-faint mx-auto mb-3" />
            <p className="text-text-secondary">No shelves found</p>
            <p className="text-xs text-text-faint mt-1">
              Create shelves from the Shelve dialog or the repo browser.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm" aria-label="Shelves">
            <thead>
              <tr className="text-left text-xs text-text-faint border-b border-border">
                <th className="py-1.5 pr-2 font-medium">Name</th>
                <th className="py-1.5 pr-2 font-medium">Created</th>
                <th className="py-1.5 pr-2 font-medium">Age</th>
                <th className="py-1.5 pr-2 font-medium" title="svn shelf-list does not report file counts or sizes">
                  Files / size
                </th>
                <th className="py-1.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shelves.map((shelf) => {
                const stale = isShelfStale(shelf.date, maxAgeDays);
                const age = shelfAgeDays(shelf.date);
                const isRenamingThis = renaming === shelf.name;
                return (
                  <tr
                    key={shelf.name}
                    className={`border-b border-border/50 ${stale ? 'bg-warning/5' : ''}`}
                  >
                    <td className="py-2 pr-2">
                      {isRenamingThis ? (
                        <div className="flex items-center gap-1" data-testid="shelf-rename-editor">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitRename();
                              if (event.key === 'Escape') setRenaming(null);
                            }}
                            aria-label={`New name for shelf ${shelf.name}`}
                            className="input py-0.5 w-36"
                          />
                          <button
                            type="button"
                            className="btn-icon-sm hover:text-success"
                            title="Confirm rename"
                            aria-label={`Confirm rename of shelf ${shelf.name}`}
                            disabled={renameMutation.isPending || !renameValue.trim()}
                            onClick={commitRename}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className="btn-icon-sm hover:text-error"
                            title="Cancel rename"
                            aria-label={`Cancel rename of shelf ${shelf.name}`}
                            onClick={() => setRenaming(null)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-text truncate max-w-40" title={shelf.name}>
                              {shelf.name}
                            </span>
                            {stale && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full border border-warning/40 bg-warning/10 text-warning whitespace-nowrap">
                                stale
                              </span>
                            )}
                          </div>
                          {shelf.message && (
                            <p className="text-xs text-text-faint truncate max-w-52" title={shelf.message}>
                              {shelf.message}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-text-secondary whitespace-nowrap">
                      {new Date(shelf.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-2 text-text-secondary whitespace-nowrap">
                      {formatShelfAge(age)}
                    </td>
                    <td className="py-2 pr-2 text-text-faint">—</td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Apply this shelf (unshelve)"
                          disabled={applyMutation.isPending}
                          onClick={() => applyMutation.mutate(shelf.name)}
                        >
                          <Play className="w-3.5 h-3.5" />
                          Apply
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title={`Diff shelf ${shelf.name} against the working copy or HEAD`}
                          disabled={diffMutation.isPending}
                          onClick={() => handleDiff(shelf.name, 'working-copy')}
                        >
                          {diffMutation.isPending &&
                          diffMutation.variables?.name === shelf.name ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileDiff className="w-3.5 h-3.5" />
                          )}
                          Diff
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title={`Rename shelf ${shelf.name}`}
                          onClick={() => startRename(shelf.name)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm hover:text-accent"
                          title={`Export shelf ${shelf.name} as a portable bundle directory`}
                          aria-label={`Export shelf ${shelf.name} as a portable bundle`}
                          disabled={exportMutation.isPending}
                          onClick={() => void handleExport(shelf.name)}
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm hover:text-error"
                          title={`Delete shelf ${shelf.name}`}
                          aria-label={`Delete shelf ${shelf.name}`}
                          disabled={deleteMutation.isPending}
                          onClick={() => void handleDelete(shelf, stale)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Shelf diff output */}
        {diffPanel && (
          <div
            className="rounded-lg border border-border bg-bg-secondary"
            data-testid="shelf-diff-panel"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <FileDiff className="w-4 h-4 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
                {diffPanel.name} · against {diffPanel.against}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm text-xs"
                disabled={diffMutation.isPending}
                onClick={() =>
                  handleDiff(
                    diffPanel.name,
                    diffPanel.against === 'working-copy' ? 'HEAD' : 'working-copy'
                  )
                }
              >
                vs {diffPanel.against === 'working-copy' ? 'HEAD' : 'working copy'}
              </button>
              <button
                type="button"
                className="btn-icon-sm"
                aria-label="Close diff"
                onClick={() => setDiffPanel(null)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs text-text whitespace-pre">
              {diffPanel.diff.trim() || '(the shelf holds no textual changes)'}
            </pre>
          </div>
        )}

        {/* Portable import */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Import a portable shelf bundle directory into this working copy"
            disabled={importMutation.isPending}
            onClick={() => void handleImport()}
          >
            {importMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            Import shelf…
          </button>
          <span className="text-xs text-text-faint">
            Bundles are the <span className="font-mono">portable-shelf-&lt;name&gt;</span>{' '}
            directories written by Export.
          </span>
        </div>
      </div>

      <div className="modal-footer">
        <div className="flex-1 text-xs text-text-faint">
          {shelves.length} shelf{shelves.length !== 1 ? 'ves' : 'f'}
        </div>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </DialogBase>
  );
}

export default ShelfManagerDialog;
