/**
 * Shelf Manager (#64).
 *
 * A management surface on top of the existing shelve IPC (`svn:shelve:list` /
 * `save` / `apply` / `delete`):
 *
 * - Table of shelves with name, creation date and age.
 * - Expiry nudges: user-configurable max age (persisted via
 *   `lib/shelfManager.ts`); older shelves get a stale indicator and a
 *   delete prompt.
 * - Rename, diff-against-WC/HEAD, and portable import/export are rendered as
 *   disabled affordances with the exact backend channels they need — see the
 *   coordination request in the "Pending backend" section. The main-side
 *   services exist for portable shelves
 *   (`svn-portable-shelves.ts`) but expose no rename/diff/export/import
 *   operations and no preload channels either.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Archive,
  Clock,
  Download,
  FileDiff,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SvnShelve } from '@shared/types';
import {
  formatShelfAge,
  isShelfStale,
  loadShelfManagerConfig,
  saveShelfManagerConfig,
  shelfAgeDays,
} from '@renderer/lib/shelfManager';
import { confirmAppAction } from '../../utils/dialogs';
import { DialogBase } from './DialogBase';

/**
 * Operations that need new IPC channels before the UI can enable them.
 * Rendered in the dialog so the request is visible exactly where the feature
 * will land.
 */
export const PENDING_BACKEND_CHANNELS = [
  'svn:shelve:rename (name, path, newName)',
  'svn:shelve:diff (name, path, against: "working-copy" | "HEAD")',
  'svn:shelve:export (name, path, outputPath)',
  'svn:shelve:import (portableShelfPath, targetWorkingCopyPath)',
] as const;

export interface ShelfManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workingCopyPath: string;
}

export function ShelfManagerDialog({
  isOpen,
  onClose,
  workingCopyPath,
}: ShelfManagerDialogProps) {
  const queryClient = useQueryClient();
  const [maxAgeDaysInput, setMaxAgeDaysInput] = useState<string>('');

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

  const applyMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.apply(name, workingCopyPath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.delete(name, workingCopyPath),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['svn:shelve:list', workingCopyPath] }),
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
                return (
                  <tr
                    key={shelf.name}
                    className={`border-b border-border/50 ${stale ? 'bg-warning/5' : ''}`}
                  >
                    <td className="py-2 pr-2">
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
                        <PendingButton
                          label="Diff"
                          icon={<FileDiff className="w-3.5 h-3.5" />}
                          title="Diff shelf against working copy or HEAD — pending backend channel svn:shelve:diff"
                        />
                        <PendingButton
                          label="Rename"
                          icon={<Pencil className="w-3.5 h-3.5" />}
                          title="Rename shelf — pending backend channel svn:shelve:rename"
                        />
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

        {/* Portable import/export — pending backend */}
        <div className="flex items-center gap-2">
          <PendingButton
            label="Export shelf…"
            icon={<Download className="w-3.5 h-3.5" />}
            title="Export a shelf to a portable file — pending backend channel svn:shelve:export"
          />
          <PendingButton
            label="Import shelf…"
            icon={<Upload className="w-3.5 h-3.5" />}
            title="Import a portable shelf file — pending backend channel svn:shelve:import"
          />
        </div>

        {/* Coordination request: exact channels needed from the backend */}
        <details className="text-xs text-text-faint border border-border rounded-lg p-2" data-testid="pending-backend">
          <summary className="cursor-pointer text-text-secondary">
            Pending backend (coordination request)
          </summary>
          <p className="mt-1.5">
            These features need new IPC channels (main + preload) before they can be enabled.
            The portable-shelf service (<span className="font-mono">svn-portable-shelves.ts</span>)
            already provides list/save/apply/delete for the fallback store; it needs
            rename/diff/export/import operations exposed through:
          </p>
          <ul className="mt-1 list-disc pl-4 font-mono space-y-0.5">
            {PENDING_BACKEND_CHANNELS.map((channel) => (
              <li key={channel}>{channel}</li>
            ))}
          </ul>
          <p className="mt-1.5">
            Rename could alternatively be approximated store-side, but without a backend channel
            the renderer cannot reach the shelf storage at all.
          </p>
        </details>
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

function PendingButton({
  label,
  icon,
  title,
}: {
  label: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm opacity-50"
      title={title}
      aria-label={`${label} (pending backend)`}
      disabled
    >
      {icon}
      {label}
    </button>
  );
}

export default ShelfManagerDialog;
