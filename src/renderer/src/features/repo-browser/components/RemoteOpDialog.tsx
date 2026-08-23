/**
 * RemoteOpDialog — the one confirmation every repository-side write goes
 * through (#68, #69): `svn mkdir`, `svn delete`, `svn move`, `svn copy` on
 * URLs, each of which is an immediate commit.
 *
 * The rules the whole feature holds write operations to:
 *
 * 1. **Affected paths are counted, not guessed.** Descendants come from the
 *    loaded tree; directories never listed are counted on the server while
 *    the dialog says "counting…", and until they answer the summary reads
 *    "at least N paths affected".
 * 2. **The command shown is the command that runs** — one line per IPC call,
 *    in execution order, with the log message quoted.
 * 3. **Deleting a top-level node requires typing its name.** Losing `trunk`
 *    is a different order of mistake from deleting `trunk/tmp`; the typed
 *    form is asked for only where the blast radius is the whole repository.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FolderPlus,
  GitBranch,
  Loader2,
  Trash2,
  TriangleAlert,
  ArrowRight,
} from 'lucide-react';

import { AccessibleDialog, AccessibleDialogBody, AccessibleDialogFooter } from '@renderer/components/AccessibleDialog';

import type { PegRevision, RepoEntry } from '../types';
import { joinRepoUrl } from '../hooks/queryKeys';
import { useAffectedCounts } from '../hooks/useAffectedCounts';
import {
  buildRemoteOpCommands,
  canDropRepoPaths,
  defaultLogMessage,
  destinationChildUrl,
  executeRemoteOp,
  toRemoteOpItem,
  typedConfirmationFor,
  type RemoteOpExecution,
  type RemoteOpItem,
  type RemoteOpKind,
  type RemoteOpPlan,
} from '../lib/remoteOps';

/** What RepoBrowserView holds while a confirmation is pending. */
export interface RemoteOpRequest {
  kind: RemoteOpKind;
  /** Items the operation names. For mkdir this is the one directory to create inside. */
  entries: RepoEntry[];
  /** Destination repo-relative directory, when the drag or menu already chose it. */
  destinationPath?: string;
  /** The destination came from a drop and is not editable. */
  destinationLocked?: boolean;
}

export interface RemoteOpDialogProps {
  request: RemoteOpRequest;
  /** Repository root URL — destinations are entered repo-relative and resolved against it. */
  rootUrl: string;
  peg?: PegRevision;
  /** Loaded tree data, for descendant counts that need no server call. */
  childrenByPath?: Readonly<Record<string, RepoEntry[] | undefined>>;
  childCountByPath?: Readonly<Record<string, number | undefined>>;
  onClose: () => void;
  /** Called once the server accepted every call; the view refreshes its listings. */
  onApplied?: (plan: RemoteOpPlan) => void;
  /** Injection seam for tests; defaults to the preload-backed adapter. */
  execute?: (plan: RemoteOpPlan) => Promise<RemoteOpExecution>;
}

const KIND_META: Record<
  RemoteOpKind,
  { title: (count: number) => string; verb: string; icon: typeof FolderPlus; tone: 'accent' | 'danger' }
> = {
  mkdir: {
    title: () => 'Create folder in the repository',
    verb: 'Create',
    icon: FolderPlus,
    tone: 'accent',
  },
  delete: {
    title: (count) => (count === 1 ? 'Delete from the repository' : `Delete ${count} items from the repository`),
    verb: 'Delete',
    icon: Trash2,
    tone: 'danger',
  },
  move: {
    title: (count) => (count === 1 ? 'Move in the repository' : `Move ${count} items in the repository`),
    verb: 'Move',
    icon: ArrowRight,
    tone: 'accent',
  },
  copy: {
    title: (count) => (count === 1 ? 'Copy in the repository' : `Copy ${count} items in the repository`),
    verb: 'Copy',
    icon: GitBranch,
    tone: 'accent',
  },
};

/** The item list the dialog confirms — presentational, so module-scoped. */
function listRows(list: readonly RemoteOpItem[]): JSX.Element {
  return (
    <ul className="mt-2 max-h-36 space-y-1 overflow-auto rounded-9 border border-border bg-bg-tertiary/40 p-2.5">
      {list.map((item) => (
        <li key={item.path} className="flex items-baseline gap-2 text-xs">
          <span className="flex-none font-mono text-2xs text-text-faint">
            {item.kind === 'dir' ? 'dir' : 'file'}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={`^/${item.path}`}
          >
            <bdi>^/{item.path}</bdi>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RemoteOpDialog({
  request,
  rootUrl,
  peg,
  childrenByPath,
  childCountByPath,
  onClose,
  onApplied,
  execute = executeRemoteOp,
}: RemoteOpDialogProps): JSX.Element {
  const { kind, entries } = request;
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const isDelete = kind === 'delete';
  const isMkdir = kind === 'mkdir';

  const items = useMemo<RemoteOpItem[]>(() => entries.map(toRemoteOpItem), [entries]);

  // The directory a mkdir lands in; entries[0] is "create folder here"'s target.
  const mkdirParent = isMkdir ? entries[0] : null;

  const [folderName, setFolderName] = useState('');
  const [destination, setDestination] = useState(request.destinationPath ?? '');
  const [message, setMessage] = useState(() =>
    defaultLogMessage(kind, items, request.destinationPath)
  );
  const [typed, setTyped] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  // Fresh defaults whenever a new request opens the dialog.
  useEffect(() => {
    setFolderName('');
    setDestination(request.destinationPath ?? '');
    setMessage(defaultLogMessage(kind, items, request.destinationPath));
    setTyped('');
    setError(null);
    setAppliedNotice(null);
    setInFlight(false);
    // `items` derives from `entries`; resetting on entry identity is the intent.
  }, [kind, entries, request.destinationPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const destinationPath = useMemo(
    () => destination.replace(/^\/+/, '').replace(/\/+$/, ''),
    [destination]
  );
  const destinationUrl = destinationPath ? joinRepoUrl(rootUrl, destinationPath) : '';

  const affectedItems = useMemo<RemoteOpItem[]>(
    () => (isMkdir ? [] : items),
    [isMkdir, items]
  );
  const { counts, isCounting } = useAffectedCounts(affectedItems, {
    rootUrl,
    peg,
    childrenByPath,
    childCountByPath,
  });

  const requiredTyped = useMemo(() => (isDelete ? typedConfirmationFor(items) : null), [isDelete, items]);

  const plan = useMemo<RemoteOpPlan | null>(() => {
    if (isMkdir) {
      if (!mkdirParent || folderName.trim() === '' || folderName.includes('/')) return null;
      const name = folderName.trim();
      return {
        kind,
        items: [
          {
            path: mkdirParent.path ? `${mkdirParent.path}/${name}` : name,
            name,
            url: destinationChildUrl(mkdirParent.url, name),
            kind: 'dir',
          },
        ],
        destinationUrl: mkdirParent.url,
        folderName: name,
        message,
      };
    }
    if (!destinationUrl || message.trim() === '') return null;
    if (!request.destinationLocked) {
      const ok = canDropRepoPaths(items.map((item) => item.path), destinationPath);
      if (!ok) return null;
    }
    return { kind, items, destinationUrl, message };
  }, [isMkdir, mkdirParent, folderName, kind, message, destinationUrl, destinationPath, items, request.destinationLocked]);

  const commands = useMemo(() => (plan ? buildRemoteOpCommands(plan) : []), [plan]);

  const typedSatisfied = requiredTyped === null || typed.trim() === requiredTyped;
  const canConfirm = plan !== null && typedSatisfied;

  const run = async (): Promise<void> => {
    if (!plan) return;
    setInFlight(true);
    setError(null);
    try {
      const result = await execute(plan);
      if (!result.success) {
        setError(
          result.completed > 0
            ? `Stopped after ${result.completed} of ${plan.items.length}: ${result.error ?? 'Subversion refused the operation'}`
            : (result.error ?? 'Subversion refused the operation')
        );
        return;
      }
      onApplied?.(plan);
      setAppliedNotice(
        `${meta.verb} completed in ${plan.items.length} ${plan.items.length === 1 ? 'revision' : 'revisions'}.`
      );
    } catch (thrown) {
      setError((thrown as Error)?.message ?? String(thrown));
    } finally {
      setInFlight(false);
    }
  };

  return (
    <AccessibleDialog
      isOpen
      onClose={inFlight ? () => undefined : onClose}
      title={meta.title(items.length)}
      icon={meta.icon}
      tone={meta.tone}
      size="md"
      description={
        isDelete
          ? 'Repository deletion is immediate: one commit per item, no working copy involved, and the paths stay recoverable only through repository history.'
          : isMkdir
            ? `A new directory in ^/${mkdirParent?.path ?? ''}, committed straight to the repository.`
            : `Items keep their names and land inside the destination — one commit per item, straight to the repository.`
      }
    >
      <AccessibleDialogBody>
        {appliedNotice ? (
          <div className="flex items-start gap-2.5 rounded-9 border border-svn-added/40 bg-svn-added/10 p-3 text-xs leading-relaxed text-text-secondary">
            <span className="font-semibold text-svn-added">Done.</span>
            <span>{appliedNotice}</span>
          </div>
        ) : (
          <>
            {isMkdir ? (
              <div>
                <label htmlFor="remote-op-folder-name" className="mb-1.5 block text-xs font-bold text-text">
                  Folder name
                </label>
                <input
                  id="remote-op-folder-name"
                  className="input"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="release-2.0"
                  disabled={inFlight}
                />
                <p className="mt-1.5 text-2xs text-text-muted">
                  Inside <b className="font-mono">^/{mkdirParent?.path ?? ''}</b>. One level at a time — nested
                  paths need their parents to exist first.
                </p>
              </div>
            ) : (
              <>
                {kind !== 'delete' ? (
                  <div>
                    <label htmlFor="remote-op-destination" className="mb-1.5 block text-xs font-bold text-text">
                      Destination folder
                    </label>
                    <input
                      id="remote-op-destination"
                      className="input font-mono"
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="trunk/deploy"
                      disabled={inFlight || request.destinationLocked}
                    />
                    <p className="mt-1.5 text-2xs text-text-muted">
                      Repository-relative. Items keep their names:{' '}
                      <b className="font-mono">^/{destinationPath || '…'}/{items[0]?.name ?? '…'}</b>
                    </p>
                  </div>
                ) : null}
                <div className="mt-3">
                  <b className="text-xs font-bold text-text">
                    {isDelete ? 'Deleting' : kind === 'move' ? 'Moving' : 'Copying'}
                  </b>
                  {listRows(items)}
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-9 border border-border bg-bg-tertiary/40 p-3 text-xs leading-relaxed text-text-secondary">
                  {isCounting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-accent" aria-hidden="true" />
                      <span>Counting the paths beneath these folders on the server…</span>
                    </>
                  ) : (
                    <>
                      {isDelete ? (
                        <TriangleAlert className="h-3.5 w-3.5 flex-none text-svn-conflict" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
                      )}
                      <span>
                        {isDelete ? 'Affected: ' : 'Scope: '}
                        <b className="font-semibold text-text">
                          {counts.direct + counts.knownDescendants === 1
                            ? '1 path'
                            : `${(counts.direct + counts.knownDescendants).toLocaleString()} paths`}
                        </b>
                        {counts.unloadedDirs > 0
                          ? ' at least — some folders below were never listed'
                          : ' — every folder below was counted'}
                        .
                      </span>
                    </>
                  )}
                </div>
              </>
            )}

            <div className="mt-3">
              <label htmlFor="remote-op-message" className="mb-1.5 block text-xs font-bold text-text">
                Log message
              </label>
              <textarea
                id="remote-op-message"
                className="input min-h-[56px] resize-y"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={inFlight}
                rows={2}
              />
            </div>

            {requiredTyped !== null && (
              <div className="mt-3 rounded-9 border border-svn-conflict/40 bg-svn-conflict/10 p-3">
                <label htmlFor="remote-op-typed" className="block text-xs font-bold text-text">
                  Type <b className="font-mono">{requiredTyped}</b> to confirm deleting{' '}
                  {requiredTyped.includes(', ') ? 'these top-level paths' : 'this top-level path'}
                </label>
                <input
                  id="remote-op-typed"
                  className="input mt-1.5 font-mono"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={requiredTyped}
                  disabled={inFlight}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            <div className="mt-3 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <b className="block text-xs font-bold text-text">Command{commands.length === 1 ? '' : 's'} that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {commands.length > 0 ? commands.join('\n') : '—'}
              </code>
            </div>

            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-9 border border-svn-conflict/40 bg-svn-conflict/10 p-3 text-xs leading-relaxed text-text-secondary"
              >
                {error}
              </p>
            ) : null}
          </>
        )}
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          {appliedNotice
            ? 'Close when ready.'
            : 'Each item is its own commit, run in order, stopping at the first failure.'}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={inFlight}
        >
          {appliedNotice ? 'Close' : 'Cancel'}
        </button>
        {appliedNotice ? null : (
          <button
            type="button"
            className={isDelete ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => void run()}
            disabled={!canConfirm || inFlight}
            aria-busy={inFlight}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="h-4 w-4" aria-hidden="true" />
            )}
            {inFlight ? `${meta.verb}…` : isDelete ? 'Delete' : meta.verb}
          </button>
        )}
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default RemoteOpDialog;
