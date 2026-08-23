/**
 * DiffWizard (#49) — arbitrary revision-to-revision and URL-to-URL diffs.
 *
 * The CompareDialog asks the two big questions (branch vs trunk, one path at
 * two revisions) and hands the answer to the repository browser's route. This
 * wizard is the *power tool* next to it: pick any left side and any right side
 * — repository URLs or working-copy paths — each with its own revision, run
 * the diff through the existing `svn:diffUrls` IPC, read it in the full
 * DiffViewer family (unified/side-by-side, word highlights, whitespace
 * options), and save the comparison under a name for next time.
 *
 * Every side is normalised to `URL@REV` before diffing: a working-copy side
 * resolves its repository URL through `svn info` (via
 * `getWorkingCopyContext`), so a checkout path is just a convenient way of
 * writing "this URL". No new IPC — `diffUrls` already speaks both operands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  GitCompare,
  Loader2,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { DialogBase } from './DialogBase';
import { VirtualizedDiffViewer } from './VirtualizedDiffViewer';
import {
  loadSavedComparisons,
  newComparisonId,
  saveSavedComparisons,
  type DiffComparisonSide,
  type SavedDiffComparison,
} from '@renderer/lib/savedComparisons';

export interface DiffWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-filled left side, e.g. from the CompareDialog's current value. */
  defaultLeft?: DiffComparisonSide | null;
  /** Pre-filled right side. */
  defaultRight?: DiffComparisonSide | null;
}

const DEFAULT_SIDE: DiffComparisonSide = { kind: 'url', target: '', revision: 'HEAD' };

/** True for the two revision specs SVN accepts on the command line here. */
function isValidRevision(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === 'HEAD' ||
    trimmed === 'BASE' ||
    trimmed === 'PREV' ||
    trimmed === 'COMMITTED' ||
    (/^r?\d+$/.test(trimmed) && Number.parseInt(trimmed.replace(/^r/, ''), 10) > 0)
  );
}

function isResolvedRevision(value: string): boolean {
  // BASE/PREV/COMMITTED only mean something against a working copy; on a URL
  // operand SVN resolves them from the URL's own history, which is valid but
  // rarely what anyone means, so the wizard keeps them for WC sides only.
  return isValidRevision(value);
}

function normalizeRevision(value: string): string {
  return value.trim().replace(/^r/i, '').toUpperCase() === 'HEAD'
    ? 'HEAD'
    : value.trim().replace(/^r/i, '');
}

/** URL operand for `svn diff --old/--new`: `target` plus `@rev` unless HEAD. */
function toOperand(target: string, revision: string): string {
  const rev = normalizeRevision(revision);
  if (rev === '' || rev === 'HEAD') return target;
  // A target that already carries a peg keeps it; the operand revision wins.
  const withoutPeg = target.replace(/@\d+$/, '');
  return `${withoutPeg}@${rev}`;
}

export function DiffWizard({ isOpen, onClose, defaultLeft, defaultRight }: DiffWizardProps) {
  const [left, setLeft] = useState<DiffComparisonSide>(defaultLeft ?? DEFAULT_SIDE);
  const [right, setRight] = useState<DiffComparisonSide>(defaultRight ?? DEFAULT_SIDE);
  const [diff, setDiff] = useState<SvnDiffResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedDiffComparison[]>([]);
  const [saveName, setSaveName] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Adopt the pre-filled sides whenever the wizard (re)opens with them.
  useEffect(() => {
    if (!isOpen) return;
    setLeft(defaultLeft ?? DEFAULT_SIDE);
    setRight(defaultRight ?? DEFAULT_SIDE);
    setDiff(null);
    setError(null);
    void loadSavedComparisons().then(setSaved);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [isOpen, defaultLeft, defaultRight]);

  const validateSide = useCallback((side: DiffComparisonSide): string | null => {
    if (side.target.trim() === '') return side.kind === 'url' ? 'Enter a URL' : 'Enter a path';
    if (!isResolvedRevision(side.revision)) {
      return 'Revision must be HEAD, BASE, PREV or a number';
    }
    return null;
  }, []);

  const leftError = validateSide(left);
  const rightError = validateSide(right);
  const canRun = !isRunning && leftError === null && rightError === null;

  /** Resolve one side to its URL form; working copies go through `svn info`. */
  const resolveSide = useCallback(
    async (side: DiffComparisonSide, signal: AbortSignal): Promise<string> => {
      const target = side.target.trim();
      if (side.kind === 'url') return toOperand(target, side.revision);

      const context = await window.api.svn.getWorkingCopyContext(target);
      if (!context || !context.url) {
        throw new Error(
          `"${target}" is not inside a working copy — switch the side to a repository URL.`
        );
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return toOperand(context.url, side.revision);
    },
    []
  );

  /** Resolve both sides and run the diff; one runner for the button and for saved entries. */
  const runForSides = useCallback(
    async (leftSide: DiffComparisonSide, rightSide: DiffComparisonSide) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setError(null);
      setDiff(null);

      try {
        const [leftOperand, rightOperand] = await Promise.all([
          resolveSide(leftSide, controller.signal),
          resolveSide(rightSide, controller.signal),
        ]);
        const result = await window.api.svn.diffUrls(leftOperand, rightOperand, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setDiff(result);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message || 'svn diff failed');
        }
      } finally {
        if (!controller.signal.aborted) setIsRunning(false);
      }
    },
    [resolveSide]
  );

  const runDiff = useCallback(() => {
    if (!canRun) return;
    void runForSides(left, right);
  }, [canRun, left, right, runForSides]);

  const persist = useCallback(async (next: SavedDiffComparison[]) => {
    setSaved(next);
    try {
      await saveSavedComparisons(next);
    } catch {
      // Storage failure keeps the in-memory list usable for this session.
    }
  }, []);

  const saveCurrent = useCallback(async () => {
    const name = saveName.trim();
    if (!name || leftError || rightError) return;
    const entry: SavedDiffComparison = {
      id: newComparisonId(),
      name,
      left: { ...left, target: left.target.trim() },
      right: { ...right, target: right.target.trim() },
      createdAt: new Date().toISOString(),
    };
    await persist([entry, ...saved.filter((item) => item.name !== name)].slice(0, 50));
    setSaveName('');
  }, [saveName, left, right, leftError, rightError, saved, persist]);

  const deleteSaved = useCallback(
    async (id: string) => {
      await persist(saved.filter((item) => item.id !== id));
    },
    [saved, persist]
  );

  const runSaved = useCallback(
    (entry: SavedDiffComparison) => {
      setLeft(entry.left);
      setRight(entry.right);
      void runForSides(entry.left, entry.right);
    },
    [runForSides]
  );

  const summary = useMemo(() => {
    if (!diff) return null;
    return {
      files: diff.files.length,
      additions: diff.files.reduce(
        (total, file) =>
          total +
          file.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'added').length,
            0
          ),
        0
      ),
      deletions: diff.files.reduce(
        (total, file) =>
          total +
          file.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'removed').length,
            0
          ),
        0
      ),
    };
  }, [diff]);

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-accent" aria-hidden="true" />
          Diff wizard — compare anything with anything
        </span>
      }
      dialogId="diff-wizard"
      draggable
      resizable
      className="w-[1000px] max-w-[95vw] h-[85vh]"
    >
      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3 overflow-auto">
        {/* Side pickers */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
          <SideEditor
            label="Left (old)"
            side={left}
            error={leftError}
            onChange={setLeft}
          />
          <div className="flex items-center justify-center pt-6">
            <ArrowRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
          </div>
          <SideEditor
            label="Right (new)"
            side={right}
            error={rightError}
            onChange={setRight}
          />
        </div>

        {/* Saved comparisons */}
        <div className="rounded-lg border border-border bg-bg-tertiary/40 p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              className="input text-xs flex-1 min-w-40"
              placeholder="Name this comparison to save it — e.g. 'trunk vs payments-v2'"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              aria-label="Saved comparison name"
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm text-xs"
              disabled={saveName.trim() === '' || leftError !== null || rightError !== null}
              onClick={() => void saveCurrent()}
            >
              <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Save
            </button>
          </div>
          {saved.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {saved.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded border border-border-muted bg-bg px-2 py-1"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => runSaved(entry)}
                    title={`${entry.left.target}@${entry.right.revision} ↔ ${entry.right.target}@${entry.right.revision}`}
                  >
                    <b className="block truncate text-xs text-text">{entry.name}</b>
                    <small className="block truncate font-mono text-[10px] text-text-muted">
                      {entry.left.target}@{normalizeRevision(entry.left.revision)} →{' '}
                      {entry.right.target}@{normalizeRevision(entry.right.revision)}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="btn-icon-sm"
                    onClick={() => void deleteSaved(entry.id)}
                    aria-label={`Delete saved comparison ${entry.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-svn-deleted/40 bg-svn-deleted/10 px-3 py-2 text-xs text-text"
          >
            <X className="mt-0.5 h-3.5 w-3.5 flex-none text-svn-deleted" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
          </div>
        )}

        {/* Result */}
        <div className="flex-1 min-h-[240px] rounded-lg border border-border overflow-hidden flex flex-col bg-bg">
          {isRunning ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
              <span className="text-xs text-text-secondary">Running svn diff…</span>
            </div>
          ) : diff ? (
            <>
              {summary && (
                <div className="flex items-center gap-3 border-b border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary">
                  <span>
                    {summary.files} file{summary.files !== 1 ? 's' : ''}
                  </span>
                  <span className="text-svn-added">+{summary.additions}</span>
                  <span className="text-svn-deleted">-{summary.deletions}</span>
                </div>
              )}
              <VirtualizedDiffViewer diff={diff} className="flex-1 min-h-0" />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-1 p-6 text-center">
              <GitCompare className="h-6 w-6 text-text-muted" aria-hidden="true" />
              <p className="text-xs text-text-secondary">
                Pick two sides and run the diff — the result opens here, with the
                unified/side-by-side toggle, word highlights and whitespace options.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="modal-footer flex-shrink-0">
        <span className="flex-1 text-2xs text-text-muted">
          Server-side diff via <code className="font-mono">svn diff --old --new</code>. Working-copy
          sides resolve to their repository URL first.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
        <button
          type="button"
          onClick={() => void runDiff()}
          disabled={!canRun}
          className="btn btn-primary"
          aria-busy={isRunning}
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          Run diff
        </button>
      </div>
    </DialogBase>
  );
}

/**
 * One side of the comparison: kind (URL or working copy), target, revision.
 * Revision chips cover the four specs people actually type.
 */
function SideEditor({
  label,
  side,
  error,
  onChange,
}: {
  label: string;
  side: DiffComparisonSide;
  error: string | null;
  onChange: (side: DiffComparisonSide) => void;
}) {
  const quickRevisions = side.kind === 'working-copy' ? ['HEAD', 'BASE', 'PREV', 'COMMITTED'] : ['HEAD'];

  return (
    <fieldset className="rounded-lg border border-border bg-bg-secondary/50 p-2.5 min-w-0">
      <legend className="px-1 text-2xs font-bold uppercase tracking-wide text-text-faint">
        {label}
      </legend>
      <div className="flex gap-1 mb-2" role="radiogroup" aria-label={`${label} source`}>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="radio"
            name={`${label}-kind`}
            checked={side.kind === 'url'}
            onChange={() => onChange({ ...side, kind: 'url', revision: 'HEAD' })}
            className="accent-accent"
          />
          Repository URL
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="radio"
            name={`${label}-kind`}
            checked={side.kind === 'working-copy'}
            onChange={() => onChange({ ...side, kind: 'working-copy', revision: 'HEAD' })}
            className="accent-accent"
          />
          Working copy
        </label>
      </div>

      <input
        type="text"
        className="input font-mono text-xs w-full mb-2"
        placeholder={
          side.kind === 'url' ? '^/trunk/src/app.ts or https://svn.example.com/repo/trunk' : '/path/to/checkout'
        }
        value={side.target}
        onChange={(event) => onChange({ ...side, target: event.target.value })}
        aria-label={`${label} ${side.kind === 'url' ? 'URL' : 'path'}`}
      />

      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          type="text"
          className="input font-mono text-xs w-24"
          placeholder="HEAD"
          value={side.revision}
          onChange={(event) => onChange({ ...side, revision: event.target.value })}
          aria-label={`${label} revision`}
        />
        {quickRevisions.map((rev) => (
          <button
            key={rev}
            type="button"
            className="btn-icon-sm text-[10px] px-1.5"
            onClick={() => onChange({ ...side, revision: rev })}
            aria-pressed={normalizeRevision(side.revision) === rev}
          >
            {rev}
          </button>
        ))}
      </div>

      {error && <p className="mt-1.5 text-[11px] text-svn-modified">{error}</p>}
    </fieldset>
  );
}

export default DiffWizard;
