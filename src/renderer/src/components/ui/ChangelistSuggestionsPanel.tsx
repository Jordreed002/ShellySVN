/**
 * Changelist auto-grouping suggestions UI (#65).
 *
 * Two exports:
 *
 * - `ChangelistSuggestionsList` — the suggestion cards (accept / dismiss /
 *   adjust) shared by `ChangelistDialog` and the entry below. Accepting calls
 *   the existing `svn:changelist:add` IPC; nothing is ever auto-applied.
 * - `ChangelistSuggestionsEntry` — a self-contained floating entry point for
 *   the file explorer: fetches its own status, renders nothing when there is
 *   nothing to group, and opens a `DialogBase` dialog on click. Kept fully
 *   self-contained so mounting it is a single line.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { SvnStatusChar } from '@shared/types';
import {
  confidenceLabel,
  suggestChangelists,
  type ChangelistSuggestion,
} from '@renderer/lib/changelistSuggestions';
import { DialogBase } from './DialogBase';

/** Statuses that cannot join a changelist (unversioned / ignored / externals). */
const NON_CHANGELIST_STATUSES: ReadonlySet<SvnStatusChar> = new Set([
  ' ',
  '?',
  'I',
  'X',
] as const);

export function isChangelistCandidate(status: SvnStatusChar, isDirectory: boolean): boolean {
  return !NON_CHANGELIST_STATUSES.has(status) && !isDirectory;
}

interface SuggestionCardProps {
  suggestion: ChangelistSuggestion;
  onAccept: (name: string, members: string[]) => void;
  onDismiss: () => void;
  isAccepting: boolean;
}

function SuggestionCard({ suggestion, onAccept, onDismiss, isAccepting }: SuggestionCardProps) {
  const [name, setName] = useState(suggestion.name);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const members = suggestion.members.filter((path) => !excluded.has(path));
  const allExcluded = members.length === 0;

  const toggleMember = (path: string) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const label = confidenceLabel(suggestion.confidence);

  return (
    <div
      className="border border-border rounded-lg p-3 space-y-2"
      role="group"
      aria-label={`Suggestion ${suggestion.name}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={`Changelist name for ${suggestion.name} suggestion`}
              className="input flex-1 min-w-32 py-1 text-sm"
            />
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full border ${
                label === 'high'
                  ? 'border-success/40 bg-success/10 text-success'
                  : label === 'medium'
                    ? 'border-info/40 bg-info/10 text-info'
                    : 'border-border bg-bg-tertiary text-text-faint'
              }`}
            >
              {label} confidence
            </span>
          </div>
          <p className="text-xs text-text-faint mt-1">
            {suggestion.description} · grouped by{' '}
            {suggestion.reason === 'same-directory'
              ? 'shared directory'
              : suggestion.reason === 'common-prefix'
                ? 'common path prefix'
                : 'file type'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="btn-icon-sm"
          aria-label={`Dismiss suggestion ${suggestion.name}`}
          title="Dismiss suggestion"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <ul className="max-h-28 overflow-auto text-xs font-mono space-y-0.5">
        {suggestion.members.map((path) => (
          <li key={path}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!excluded.has(path)}
                onChange={() => toggleMember(path)}
              />
              <span className={excluded.has(path) ? 'line-through text-text-faint' : ''}>
                {path}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!name.trim() || allExcluded || isAccepting}
          onClick={() => onAccept(name.trim(), members)}
        >
          {isAccepting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Create changelist ({members.length})
        </button>
      </div>
    </div>
  );
}

export interface ChangelistSuggestionsListProps {
  /** Changed paths to group. */
  paths: string[];
  /** Working-copy root; used to derive root-relative suggestion names. */
  rootPath: string;
  /** Query keys invalidated after an accepted suggestion. */
  invalidateKeys?: string[][];
  /** Heading level element for the section title. */
  title?: string;
}

export function ChangelistSuggestionsList({
  paths,
  rootPath,
  invalidateKeys,
  title = 'Suggested changelists',
}: ChangelistSuggestionsListProps) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => suggestChangelists(paths, { rootPath }),
    [paths, rootPath]
  );
  const visible = suggestions.filter(
    (suggestion) => !dismissed.has(suggestion.id) && !accepted.has(suggestion.id)
  );

  const addMutation = useMutation({
    mutationFn: ({ name, members }: { id: string; name: string; members: string[] }) =>
      window.api.svn.changelist.add(members, name),
    onSuccess: (_result, variables) => {
      setAccepted((previous) => new Set(previous).add(variables.id));
      const keys = invalidateKeys ?? [
        ['svn:changelist:list', rootPath],
        ['svn:status', rootPath],
      ];
      for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (mutationError) => setError((mutationError as Error).message),
  });

  if (suggestions.length === 0) {
    return (
      <p className="text-xs text-text-faint">
        No changelist groupings found for the current changes.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="changelist-suggestions">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Lightbulb className="w-4 h-4 text-accent" />
        {title}
      </div>
      <p className="text-xs text-text-faint">
        Grouped by path heuristics. Review, adjust names and members, then accept — nothing is
        applied automatically.
      </p>
      {visible.length === 0 ? (
        <p className="text-xs text-text-faint">All suggestions handled.</p>
      ) : (
        visible.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            isAccepting={addMutation.isPending}
            onDismiss={() =>
              setDismissed((previous) => new Set(previous).add(suggestion.id))
            }
            onAccept={(name, members) =>
              addMutation.mutate({ id: suggestion.id, name, members })
            }
          />
        ))
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

export interface ChangelistSuggestionsEntryProps {
  /** Any path inside the working copy (the file explorer's current path). */
  workingCopyPath: string;
}

/**
 * Self-contained entry: renders a floating "suggest changelists" chip only
 * when the working copy has two or more changed files. Clicking opens the
 * suggestions dialog. Mounting this component is the only integration needed.
 */
export function ChangelistSuggestionsEntry({ workingCopyPath }: ChangelistSuggestionsEntryProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['changelist-suggestions:status', workingCopyPath],
    queryFn: () => window.api.svn.status(workingCopyPath),
    enabled: !!workingCopyPath,
  });

  const { data: context } = useQuery({
    queryKey: ['changelist-suggestions:context', workingCopyPath],
    queryFn: () => window.api.svn.getWorkingCopyContext(workingCopyPath),
    enabled: !!workingCopyPath,
  });

  const changedPaths = useMemo(() => {
    const entries = status?.entries ?? [];
    return entries
      .filter((entry) => isChangelistCandidate(entry.status, entry.isDirectory))
      .map((entry) => entry.path);
  }, [status]);

  if (changedPaths.length < 2) return null;

  const rootPath = context?.workingCopyRoot ?? workingCopyPath;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 text-xs glass-strong border border-border rounded-full text-text hover:border-accent hover:text-accent transition-fast shadow-lg"
        aria-label="Suggest changelists from current changes"
        title="Suggest changelists based on path groupings"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Suggest changelists
      </button>

      <DialogBase
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        dialogId="changelist-suggestions"
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            Suggested changelists
          </span>
        }
        className="w-[560px] max-h-[80vh] flex flex-col"
      >
        <div className="modal-body overflow-auto space-y-3">
          <p className="text-sm text-text-secondary">
            {changedPaths.length} changed files in{' '}
            <span className="font-mono text-xs">{rootPath}</span>
          </p>
          <ChangelistSuggestionsList
            paths={changedPaths}
            rootPath={rootPath}
            invalidateKeys={[
              ['svn:changelist:list', rootPath],
              ['svn:status', workingCopyPath],
              ['changelist-suggestions:status', workingCopyPath],
            ]}
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={() => setIsOpen(false)}>
            Done
          </button>
        </div>
      </DialogBase>
    </>
  );
}

export default ChangelistSuggestionsEntry;
