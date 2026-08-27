import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GitCommit,
  ListPlus,
  Loader2,
  MoveRight,
  Trash2,
} from 'lucide-react';
import { useCommitStack } from './useCommitStack';
import { ReviewEmptyState } from './ReviewEmptyState';
import { AiRichText } from '@renderer/components/ai/AiRichText';

export function CommitStackPanel({ workingCopyPath }: { workingCopyPath: string }) {
  const {
    stack,
    diagnostics,
    isLoading,
    busyGroupId,
    error,
    reorder,
    updateMessage,
    movePath,
    createChangelist,
    commitGroup,
    clear,
  } = useCommitStack(workingCopyPath);

  if (isLoading)
    return (
      <div
        className="h-32 animate-pulse rounded-10 border border-border bg-bg-secondary motion-reduce:animate-none"
        role="status"
        aria-label="Loading commit stack"
      />
    );
  if (!stack.groups.length) {
    return (
      <ReviewEmptyState
        icon={GitCommit}
        title="No commit stack"
        detail="Run “Plan” from the commit window. Its logical groups become an ordered, recoverable stack here."
      />
    );
  }

  return (
    <section aria-label="Commit stack" className="space-y-3">
      {(diagnostics.duplicates.size > 0 || diagnostics.unassigned.length > 0) && (
        <div
          className="rounded-9 border border-warning/40 bg-warning/[0.07] px-3 py-2 text-10.5 text-warning"
          role="status"
          aria-live="polite"
        >
          {diagnostics.duplicates.size > 0 &&
            `${diagnostics.duplicates.size} duplicate path assignment${diagnostics.duplicates.size === 1 ? '' : 's'}. `}
          {diagnostics.unassigned.length > 0 &&
            `${diagnostics.unassigned.length} unassigned path${diagnostics.unassigned.length === 1 ? '' : 's'}.`}
        </div>
      )}
      {error && (
        <div
          className="rounded-9 border border-error/40 bg-error/[0.07] px-3 py-2 text-10.5 text-error"
          role="alert"
        >
          {error}
        </div>
      )}
      <ol className="space-y-2">
        {stack.groups.map((group, index) => {
          const busy = busyGroupId === group.id;
          const immutable = group.status === 'committed' || group.status === 'stale';
          return (
            <li
              key={group.id}
              className={`border bg-bg-secondary ${group.status === 'ready' ? 'border-svn-normal/40' : group.status === 'committed' ? 'border-border opacity-65' : group.status === 'stale' ? 'border-svn-modified/30 opacity-60' : 'border-border-strong'}`}
            >
              <header className="flex items-center gap-2 border-b border-border-muted px-3 py-2">
                <span className="grid h-6 w-6 place-items-center rounded-6 bg-bg-sunk font-mono text-9.5 text-text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-12 font-semibold">{group.title}</h3>
                  <p className="font-mono text-9.5 uppercase tracking-wider text-text-faint">
                    {group.status}
                    {group.committedRevision ? ` · r${group.committedRevision}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-icon-sm h-7 w-7"
                  onClick={() => reorder(group.id, -1)}
                  disabled={index === 0 || busyGroupId !== null}
                  aria-label={`Move ${group.title} earlier`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="btn-icon-sm h-7 w-7"
                  onClick={() => reorder(group.id, 1)}
                  disabled={index === stack.groups.length - 1 || busyGroupId !== null}
                  aria-label={`Move ${group.title} later`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </header>
              <div className="p-3">
                {group.description && (
                  <AiRichText
                    className="mb-2"
                    markdown={group.description}
                    aria-label={`Description for ${group.title} (AI output)`}
                  />
                )}
                <textarea
                  className="input min-h-16 w-full resize-y font-mono text-11"
                  value={group.draftMessage}
                  disabled={immutable || busyGroupId !== null}
                  onChange={(event) => updateMessage(group.id, event.target.value)}
                  aria-label={`Commit message for ${group.title}`}
                />
                <ul className="mt-2 divide-y divide-border-muted overflow-hidden rounded-8 border border-border-muted">
                  {group.paths.map((path) => (
                    <li key={path} className="flex min-h-8 items-center gap-2 px-2">
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-9.5 text-text-muted"
                        title={path}
                      >
                        {path.replaceAll('\\', '/').split('/').slice(-3).join('/')}
                      </span>
                      {!immutable && (
                        <label className="flex items-center gap-1 text-9.5 text-text-faint">
                          <MoveRight className="h-3 w-3" />
                          <select
                            className="h-6 max-w-32 rounded-6 border border-border bg-bg px-1 text-9.5 text-text"
                            value={group.id}
                            disabled={busyGroupId !== null}
                            onChange={(event) => movePath(path, event.target.value || null)}
                            aria-label={`Move ${path} to group`}
                          >
                            <option value="">Unassigned</option>
                            {stack.groups
                              .filter(
                                (candidate) =>
                                  candidate.status !== 'committed' && candidate.status !== 'stale'
                              )
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.title}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
                  {group.changelistName && (
                    <span className="font-mono text-9.5 text-accent">
                      changelist: {group.changelistName}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm ml-auto gap-1"
                    disabled={immutable || group.paths.length === 0 || busyGroupId !== null}
                    onClick={() => void createChangelist(group.id)}
                  >
                    {busy ? (
                      <Loader2
                        className="h-3 w-3 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <ListPlus className="h-3 w-3" />
                    )}
                    {group.changelistName ? 'Update changelist' : 'Create changelist'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm gap-1"
                    disabled={group.status !== 'ready' || busyGroupId !== null}
                    onClick={() => void commitGroup(group.id)}
                  >
                    {group.status === 'committed' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : busy ? (
                      <Loader2
                        className="h-3 w-3 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <GitCommit className="h-3 w-3" />
                    )}
                    {group.status === 'committed' ? 'Committed' : 'Commit this group'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {diagnostics.unassigned.length > 0 && (
        <div className="rounded-10 border border-dashed border-border-strong p-3">
          <h3 className="font-mono text-9.5 uppercase tracking-wider text-text-faint">
            Unassigned
          </h3>
          {diagnostics.unassigned.map((path) => (
            <div key={path} className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-9.5">{path}</span>
              <select
                className="h-7 rounded-6 border border-border bg-bg px-1 text-9.5"
                defaultValue=""
                aria-label={`Assign ${path} to a commit group`}
                onChange={(event) => event.target.value && movePath(path, event.target.value)}
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {stack.groups
                  .filter((group) => group.status !== 'committed' && group.status !== 'stale')
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.title}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm gap-1 text-svn-conflict"
        onClick={() => void clear()}
        disabled={busyGroupId !== null}
      >
        <Trash2 className="h-3 w-3" />
        Clear stack
      </button>
    </section>
  );
}
