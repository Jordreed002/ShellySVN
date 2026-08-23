import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle,
  FileCog,
  Loader2,
  RotateCcw,
} from 'lucide-react';

import {
  type PropertyChoice,
  type PropertyResolution,
  type PropertySides,
  describePropertyResolution,
  findConflictedPropertyNames,
  parsePrejPropertyNames,
  planPropertyApply,
  resolvePropertySides,
  suggestMergedValue,
  valueForChoice,
} from '@renderer/lib/propertyConflictModel';

/**
 * Property-conflict resolution flow (#56).
 *
 * Shows each conflicted property's mine/theirs/base values, offers a merge
 * editor (pick a side or hand-edit the merged result), applies through the
 * existing property IPC (`svn propset` / `svn propdel`), and then lets the
 * wizard mark the conflict resolved (`svn resolve --accept working`).
 *
 * Values come from `svn proplist`/`svn propget`: BASE revision for the common
 * ancestor, the working copy for mine, and the repository HEAD for theirs
 * (correct for update/switch conflicts; for merge conflicts without reject
 * artifacts the theirs slot is honestly labeled unavailable instead of
 * guessed).
 */

interface LoadedProperty extends PropertySides {
  merged: string;
  choice: PropertyChoice;
}

interface PropertyConflictPanelProps {
  conflictPath: string;
  isProcessing: boolean;
  /** Fired after every property applied cleanly; the wizard then marks the conflict resolved. */
  onPropertiesApplied: () => Promise<void> | void;
}

function propsToRecord(properties: ReadonlyArray<{ name: string; value: string }>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const property of properties) record[property.name] = property.value;
  return record;
}

export function PropertyConflictPanel({
  conflictPath,
  isProcessing,
  onPropertiesApplied,
}: PropertyConflictPanelProps) {
  const [loaded, setLoaded] = useState<LoadedProperty[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PropertyResolution[] | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState<string[] | null>(null);

  const filename = conflictPath.split(/[/\\]/).pop() || conflictPath;

  useEffect(() => {
    setLoaded(null);
    setLoadError(null);
    setApplyError(null);
    setPendingConfirm(null);
    setAppliedSummary(null);
  }, [conflictPath]);

  const handleLoad = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [workingResult, baseResult, prejNames] = await Promise.all([
        window.api.svn.proplist(conflictPath),
        window.api.svn.proplist(conflictPath, { revision: 'BASE' }),
        readPrejNames(conflictPath),
      ]);

      const working = propsToRecord(workingResult.properties ?? []);
      const base = propsToRecord(baseResult.properties ?? []);
      const names = new Set([
        ...findConflictedPropertyNames(working, base),
        ...prejNames,
      ]);

      const entries: LoadedProperty[] = [];
      for (const name of names) {
        const sides = resolvePropertySides(name, {
          base: base[name],
          mine: working[name],
        });
        // Fetch the incoming value where it is knowable: the repository HEAD.
        let theirs: string | undefined;
        let theirsSource: PropertySides['theirsSource'] = 'unavailable';
        try {
          const head = await window.api.svn.propget(conflictPath, name, { revision: 'HEAD' });
          if (head.value !== undefined) {
            theirs = head.value;
            theirsSource = 'repository-head';
          }
        } catch {
          // Merge conflicts without artifacts: theirs is not fetchable; the
          // user can still pick mine/base or resolve with an accept mode.
        }
        const withTheirs: PropertySides = { ...sides, theirs, theirsSource };
        entries.push({
          ...withTheirs,
          merged: suggestMergedValue(withTheirs),
          choice: 'custom',
        });
      }

      if (entries.length === 0) {
        setLoadError(
          'No conflicting properties detected between the working copy and BASE. You can still mark the conflict resolved below.'
        );
      }
      setLoaded(entries);
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to load property values');
    } finally {
      setIsLoading(false);
    }
  }, [conflictPath]);

  const setChoice = (name: string, choice: PropertyChoice) => {
    setLoaded((previous) =>
      (previous ?? []).map((entry) => {
        if (entry.name !== name) return entry;
        if (choice === 'custom') return { ...entry, choice };
        return { ...entry, choice, merged: valueForChoice(entry, choice) };
      })
    );
  };

  const setMergedValue = (name: string, value: string) => {
    setLoaded((previous) =>
      (previous ?? []).map((entry) =>
        entry.name === name ? { ...entry, merged: value, choice: 'custom' } : entry
      )
    );
  };

  const resolutions = useMemo<PropertyResolution[]>(
    () =>
      (loaded ?? []).map((entry) => ({
        name: entry.name,
        choice: entry.choice,
        value: entry.choice === 'custom' ? entry.merged : valueForChoice(entry, entry.choice),
      })),
    [loaded]
  );

  const handleApply = () => setPendingConfirm(resolutions);

  const handleConfirmApply = async () => {
    if (!pendingConfirm) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const applied: string[] = [];
      for (const resolution of pendingConfirm) {
        const plan = planPropertyApply(resolution);
        const result =
          plan.action === 'del'
            ? await window.api.svn.propdel(conflictPath, resolution.name)
            : await window.api.svn.propset(conflictPath, resolution.name, plan.value);
        if (!result.success) {
          throw new Error(result.error || `Failed to apply ${resolution.name}`);
        }
        applied.push(describePropertyResolution(resolution));
      }
      await onPropertiesApplied();
      setAppliedSummary(applied);
      setPendingConfirm(null);
    } catch (err) {
      setApplyError((err as Error).message || 'Failed to apply property values');
    } finally {
      setIsApplying(false);
    }
  };

  const busy = isProcessing || isApplying;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary p-4 space-y-4" data-testid="property-conflict-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-medium text-text flex items-center gap-2">
            <FileCog className="w-4 h-4 text-warning" />
            Property conflict
          </h5>
          <p className="text-xs text-text-secondary mt-1">
            {filename}: at least one property changed differently on both sides. Pick a value per
            property or edit the merged result, then apply.
          </p>
        </div>
        {!loaded && (
          <button
            type="button"
            onClick={handleLoad}
            disabled={isLoading || busy}
            className="btn btn-secondary btn-sm flex-shrink-0"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            Load property details
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 p-2.5 text-xs text-text-secondary">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-info" />
          <span>{loadError}</span>
        </div>
      )}
      {applyError && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{applyError}</span>
        </div>
      )}

      {loaded && loaded.length > 0 && (
        <div className="space-y-4">
          {loaded.map((entry) => (
            <div key={entry.name} className="rounded-lg border border-border bg-bg-secondary p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium text-text">{entry.name}</span>
                <span className="text-[10px] text-text-faint">
                  {entry.theirsSource === 'repository-head'
                    ? 'theirs from repository @ HEAD'
                    : 'theirs value unavailable'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <ValueBox label="Base" value={entry.base} />
                <ValueBox label="Mine" value={entry.mine ?? '(not set)'} />
                <ValueBox
                  label="Theirs"
                  value={entry.theirs !== undefined ? entry.theirs : '(unavailable)'}
                  dim={entry.theirs === undefined}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">Merged result</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setChoice(entry.name, 'mine')}
                      disabled={busy}
                      className="btn btn-secondary btn-sm text-xs"
                    >
                      Use my value
                    </button>
                    <button
                      type="button"
                      onClick={() => setChoice(entry.name, 'theirs')}
                      disabled={busy || entry.theirs === undefined}
                      className="btn btn-secondary btn-sm text-xs"
                    >
                      Use their value
                    </button>
                    <button
                      type="button"
                      onClick={() => setChoice(entry.name, 'base')}
                      disabled={busy}
                      className="btn btn-secondary btn-sm text-xs"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Base
                    </button>
                  </div>
                </div>
                <textarea
                  value={entry.merged}
                  onChange={(event) => setMergedValue(entry.name, event.target.value)}
                  disabled={busy}
                  rows={Math.min(6, Math.max(2, entry.merged.split('\n').length))}
                  className="input font-mono text-xs resize-y"
                  aria-label={`Merged value for ${entry.name}`}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleApply}
            disabled={busy}
            className="btn btn-primary w-full"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Apply {loaded.length} propert{loaded.length === 1 ? 'y' : 'ies'} and mark resolved
          </button>
        </div>
      )}

      {appliedSummary && (
        <div className="rounded-lg border border-svn-added/40 bg-svn-added/10 p-3 text-xs text-text-secondary space-y-1">
          {appliedSummary.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="text-svn-added">Conflict marked resolved.</p>
        </div>
      )}

      {pendingConfirm && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
          <p className="text-xs font-medium text-warning">Apply these property changes?</p>
          <ul className="list-disc pl-4 text-xs text-text-secondary space-y-0.5">
            {pendingConfirm.map((resolution) => (
              <li key={resolution.name}>{describePropertyResolution(resolution)}</li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingConfirm(null)}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmApply}
              disabled={busy}
              className="btn btn-primary btn-sm"
            >
              Apply and resolve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ValueBox({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  const display = value === '' ? '(empty)' : value;
  return (
    <div className={`rounded border border-border bg-bg-tertiary p-2 ${dim ? 'opacity-50' : ''}`}>
      <p className="text-[10px] uppercase tracking-wide text-text-faint">{label}</p>
      <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-text">
        {display}
      </pre>
      <p className="mt-1 text-[10px] text-text-faint">{value.length} chars</p>
    </div>
  );
}

/**
 * Best-effort extraction of property names from the `.prej` reject artifacts
 * SVN leaves next to the conflicted file. Missing/unreadable artifacts are
 * fine — the proplist diff is the primary source.
 */
async function readPrejNames(conflictPath: string): Promise<string[]> {
  try {
    const lastSepIndex = Math.max(conflictPath.lastIndexOf('/'), conflictPath.lastIndexOf('\\'));
    const dirPath = lastSepIndex >= 0 ? conflictPath.substring(0, lastSepIndex) : conflictPath;
    const baseName = lastSepIndex >= 0 ? conflictPath.substring(lastSepIndex + 1) : conflictPath;

    const files = await window.api.fs.listDirectory(dirPath);
    const names: string[] = [];
    for (const file of files) {
      if (!file.name.startsWith(`${baseName}.`) || !file.name.includes('.prej')) continue;
      const read = await window.api.fs.readFile(file.path);
      if (read.success) names.push(...parsePrejPropertyNames(read.content ?? ''));
    }
    return [...new Set(names)];
  } catch {
    return [];
  }
}
