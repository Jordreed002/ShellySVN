import { useState } from 'react';
import { Archive, Loader2, X } from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';

/**
 * ShelfDialog — shelve the local changes under a path selected in the browser.
 *
 * The Shelf Manager (`components/ui/ShelfManagerDialog.tsx`) is the surface for
 * everything that happens to a shelf *after* it exists: apply, rename, diff,
 * export, delete. What it cannot do is answer "shelve *these* changes" — it has
 * no selection. The browser does: the user right-clicked a path that lives in a
 * checkout, so `svn shelve <name> <that path>` scopes the shelf to exactly the
 * subtree on screen instead of the whole working copy.
 *
 * The honest part matters as much as the feature: **a shelf is local**. It lives
 * in the working copy's administrative area, it is not on the server, it is not
 * backed up, and nobody else can see it until the changes are committed or the
 * patch is handed over.
 */

/** What the browser is about to shelve: one selected path, on disk. */
export interface ShelfTarget {
  /** Display name of the selected entry. */
  name: string;
  /** Repository-relative path — context for the user, not for svn. */
  repoPath: string;
  /** Where the path lives inside the checkout — `svn shelve`'s target. */
  localPath: string;
  kind: 'file' | 'dir';
}

export interface ShelfDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The selected path whose local changes will be shelved. */
  target: ShelfTarget;
  /** The shelf consumed the local changes — caches describing disk are stale. */
  onSaved: (shelfName: string) => void;
}

export function ShelfDialog({ isOpen, onClose, target, onSaved }: ShelfDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const trimmedName = name.trim();

  const runShelve = async () => {
    if (!trimmedName || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const result = await window.api.svn.shelve.save(
        trimmedName,
        target.localPath,
        message.trim() || undefined
      );
      if (!result?.success) {
        setError(result?.error || 'Subversion did not report why the shelve failed.');
        return;
      }
      setNotice(
        `Shelved the local changes under ${target.name} as "${trimmedName}". Apply them again from the Shelf Manager.`
      );
      setName('');
      setMessage('');
      onSaved(trimmedName);
    } catch (caught) {
      setError((caught as Error)?.message ?? String(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Shelve local changes"
      size="md"
      description="Set the local changes under the selected path aside as a named shelf, restorable later."
    >
      <AccessibleDialogBody>
        <p className="text-xs leading-relaxed text-text-secondary">
          A shelf takes the uncommitted changes under{' '}
          <b className="font-semibold text-text">{target.name}</b> off your disk and keeps them in
          the working copy's shelf store, restorable with{' '}
          <span className="font-mono text-[11px] text-text">svn unshelve</span>. This is the
          browser's own scoping: only the path you selected is shelved, not the whole working copy.
        </p>

        <dl className="mt-3 space-y-1.5 rounded-9 border border-border bg-bg-tertiary/40 p-3">
          <div className="flex gap-2">
            <dt className="eyebrow flex-none pt-px">Repository path</dt>
            <dd
              className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
              style={{ direction: 'rtl', textAlign: 'left' }}
              title={`^/${target.repoPath}`}
            >
              <bdi>^/{target.repoPath}</bdi>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="eyebrow flex-none pt-px">Shelves</dt>
            <dd
              className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
              style={{ direction: 'rtl', textAlign: 'left' }}
              title={target.localPath}
            >
              <bdi>{target.localPath}</bdi>
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <label htmlFor="shelf-name" className="mb-1.5 block text-xs font-bold text-text">
            Shelf name <span className="text-svn-conflict">*</span>
          </label>
          <input
            id="shelf-name"
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="feature-wip"
            disabled={isBusy}
            autoComplete="off"
          />
        </div>

        <div className="mt-3">
          <label htmlFor="shelf-message" className="mb-1.5 block text-xs font-bold text-text">
            Message <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <textarea
            id="shelf-message"
            className="input h-20 resize-none"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What is sitting on this shelf?"
            disabled={isBusy}
          />
        </div>

        <div className="mt-3 rounded-9 border border-border bg-bg-tertiary/40 p-3">
          <b className="block text-xs font-bold text-text">Command that will run</b>
          <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
            {`svn shelve${message.trim() ? ' -m <message>' : ''} ${trimmedName ? `"${trimmedName}"` : '<name>'} "${target.localPath}"`}
          </code>
        </div>

        {error ? (
          <div
            className="mt-3 flex items-start justify-between gap-2 rounded bg-error/10 p-3 text-sm text-error"
            role="alert"
            data-testid="shelf-action-error"
          >
            <span className="break-words">{error}</span>
            <button
              type="button"
              className="btn-icon-sm flex-shrink-0"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {notice ? (
          <div
            className="mt-3 flex items-start justify-between gap-2 rounded bg-success/10 p-3 text-sm text-success"
            role="status"
            data-testid="shelf-action-notice"
          >
            <span className="break-words">{notice}</span>
            <button
              type="button"
              className="btn-icon-sm flex-shrink-0"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          Shelves are local — they are not on the server until you commit.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isBusy}>
          Close
        </button>
        <button
          type="button"
          onClick={() => void runShelve()}
          className="btn btn-primary"
          disabled={isBusy || !trimmedName}
          aria-busy={isBusy}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Archive className="h-4 w-4" aria-hidden="true" />
          )}
          {isBusy ? 'Shelving…' : 'Shelve changes'}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default ShelfDialog;
