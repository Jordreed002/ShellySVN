import { Box, Copy, Download, FileDiff, Share2, Trash2, Undo2 } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { Shelf } from '../types';

/**
 * ShelfDialog — Subversion has no pull request.
 *
 * `svn shelf` (1.14) is the nearest primitive: your uncommitted changes set
 * aside as a patch, restorable later and, if the team wants review before
 * commit, shareable. It is deliberately lightweight, because the alternative in
 * Subversion is nothing at all.
 *
 * The honest part matters as much as the feature: **a shelf is local**. It
 * lives in the working copy's administrative area, it is not on the server, it
 * is not backed up, and nobody else can see it until the changes are committed
 * or the patch is handed over.
 */

/** What the primary action will do to the shelf. */
export type ShelfAction = 'unshelve' | 'share' | 'export';

/** One file inside a shelf, as reported by `svn shelf-diff`. */
export interface ShelfFileChange {
  /** Working-copy-relative path. */
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface ShelfDialogProps {
  isOpen: boolean;
  onClose: () => void;

  shelf: Shelf;
  /** Contents from `svn shelf-diff`; may be a subset of `shelf.fileCount`. */
  files: ShelfFileChange[];

  action: ShelfAction;
  onActionChange: (action: ShelfAction) => void;

  /** `svn unshelve <name>` — re-applies the patch to this working copy. Destructive. */
  onUnshelve: () => void;
  /** Export the patch and hand it to the team for review. */
  onShareAsPatch: () => void;
  /** Write the patch to a file on disk. */
  onExportPatchFile: () => void;
  /** `svn shelf-drop <name>` — throws the shelved changes away. Destructive. */
  onDropShelf: () => void;

  onCopyCommand?: (command: string) => void;
  isBusy?: boolean;
}

interface ActionCopy {
  title: string;
  detail: string;
  command: (name: string) => string;
}

const ACTION_COPY: Record<ShelfAction, ActionCopy> = {
  unshelve: {
    title: 'Unshelve into this working copy',
    detail:
      'Re-applies the patch to the files on disk. Conflicts are reported exactly the way an update reports them, and the shelf is consumed once it applies cleanly.',
    command: (name) => `svn unshelve ${name}`,
  },
  share: {
    title: 'Share for review',
    detail:
      'Exports the patch and posts a link for the team. The closest Subversion gets to a pull request — deliberately lightweight, because the alternative is nothing.',
    command: (name) => `svn shelf-diff ${name} → review link`,
  },
  export: {
    title: 'Export as a patch file',
    detail:
      'Writes a unified diff you can attach to a ticket or apply in another working copy with `svn patch`.',
    command: (name) => `svn shelf-diff ${name} > ${name}.patch`,
  },
};

const ACTION_ORDER: ShelfAction[] = ['unshelve', 'share', 'export'];

function formatLineDelta(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`−${removed}`);
  return parts.length > 0 ? parts.join(' ') : '±0';
}

export function ShelfDialog({
  isOpen,
  onClose,
  shelf,
  files,
  action,
  onActionChange,
  onUnshelve,
  onShareAsPatch,
  onExportPatchFile,
  onDropShelf,
  onCopyCommand,
  isBusy = false,
}: ShelfDialogProps) {
  const hidden = Math.max(shelf.fileCount - files.length, 0);
  const command = ACTION_COPY[action].command(shelf.name);

  const runAction = () => {
    if (action === 'unshelve') onUnshelve();
    else if (action === 'share') onShareAsPatch();
    else onExportPatchFile();
  };

  const primaryLabel =
    action === 'unshelve' ? 'Unshelve' : action === 'share' ? 'Share for review' : 'Export patch';

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Shelf · ${shelf.name}`}
      size="md"
      description="Contents of a local svn shelf, and what can be done with it."
    >
      <AccessibleDialogBody>
        <div className="flex items-start gap-2.5">
          <Box className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-text-secondary">
            Subversion has no pull request. A shelf is the nearest primitive: your changes set aside
            as a patch, restorable later — and, if the team wants review before commit, shareable.
          </p>
        </div>
        <p className="mb-4 mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
          svn shelf-diff {shelf.name} · {shelf.fileCount} {shelf.fileCount === 1 ? 'file' : 'files'}{' '}
          · created {shelf.created}
        </p>

        <div className="mb-4 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-2 border-b border-border-muted bg-bg-tertiary/40 px-3 py-1.5">
            <FileDiff className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
            <span className="text-2xs font-bold uppercase tracking-wide text-text-faint">
              Contents
            </span>
          </div>
          {files.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-secondary">
              No file list available for this shelf — run{' '}
              <span className="font-mono text-[11px] text-text">svn shelf-diff {shelf.name}</span>{' '}
              to read it.
            </p>
          ) : (
            <ul className="list-none">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center gap-3 border-b border-border-muted px-3 py-1.5 last:border-b-0"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary"
                    style={{ direction: 'rtl', textAlign: 'left' }}
                    title={file.path}
                  >
                    <bdi>{file.path}</bdi>
                  </span>
                  <span className="flex-none font-mono text-[11px] text-text-muted">
                    {formatLineDelta(file.linesAdded, file.linesRemoved)}
                  </span>
                </li>
              ))}
              {hidden > 0 && (
                <li className="px-3 py-1.5 text-[11px] text-text-faint">and {hidden} more</li>
              )}
            </ul>
          )}
        </div>

        {ACTION_ORDER.map((value) => {
          const copy = ACTION_COPY[value];
          const selected = value === action;
          return (
            <label
              key={value}
              className={`mb-2 flex cursor-pointer items-start gap-3 rounded-xl border p-3 last:mb-0 ${
                selected
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-tertiary/40 hover:border-border-focus'
              }`}
            >
              <input
                type="radio"
                name="shelf-action"
                className="mt-1 flex-none accent-accent"
                checked={selected}
                onChange={() => onActionChange(value)}
              />
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] font-bold text-text">{copy.title}</b>
                <small className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                  {copy.detail}
                </small>
                <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-[11px] text-text-muted">
                  {copy.command(shelf.name)}
                </code>
              </span>
            </label>
          );
        })}

        {onCopyCommand && (
          <button
            type="button"
            onClick={() => onCopyCommand(command)}
            className="btn btn-sm btn-ghost mt-2"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copy command
          </button>
        )}
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          Shelves are local — they are not on the server until you commit.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isBusy}>
          Close
        </button>
        <button type="button" onClick={onDropShelf} className="btn btn-danger" disabled={isBusy}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Drop shelf
        </button>
        <button
          type="button"
          onClick={runAction}
          className="btn btn-primary"
          disabled={isBusy}
          aria-busy={isBusy}
        >
          {action === 'unshelve' ? (
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          ) : action === 'share' ? (
            <Share2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {isBusy ? 'Working…' : primaryLabel}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default ShelfDialog;
