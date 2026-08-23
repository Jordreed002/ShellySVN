import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  FolderTree,
  Loader2,
  Minus,
  Plus,
  Save,
  X,
} from 'lucide-react';
import { confirmAppAction } from '../../utils/dialogs';
import { assertSuccessfulSvnRead } from '../../utils/svnReadResult';
import {
  computeEffectiveIgnore,
  formatIgnorePatterns,
  hasIgnoreLintErrors,
  lintIgnorePatterns,
  matchUnversionedEntries,
  parentDirectoryOf,
  parseIgnorePatterns,
  type UnversionedCandidate,
} from '../../lib/svnIgnorePatterns';
import type { FileInfo } from '@shared/types';

interface IgnoreDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Legacy mode (an `onApply` delegate is given, e.g. FileExplorer): full path
   * of the file/directory being ignored — the property is written to its
   * parent by the caller. Editor mode: the directory whose property is edited.
   */
  path: string;
  fileName?: string;
  /**
   * Legacy delegate contract (unchanged): receives only the patterns the user
   * newly added; the caller merges them into the existing property value.
   */
  onApply?: (patterns: string[]) => void;
  /** Which property the editor edits; defaults to svn:ignore. */
  propertyName?: 'svn:ignore' | 'svn:global-ignores';
  /**
   * Seed the pattern list from this value instead of the property on disk
   * (draft mode — PropertiesDialog hands in its current draft).
   */
  initialValue?: string;
  /**
   * Draft mode: instead of writing via IPC, hand the full edited value to the
   * caller (PropertiesDialog keeps its single "Save Changes" write path).
   */
  onApplyValue?: (value: string) => void;
  /** Called after every successful self-write target (for cache invalidation). */
  onApplied?: (path: string) => void;
}

interface PatternRow {
  id: number;
  text: string;
  /** Pre-existing pattern — locked (not removable) in legacy delegate mode. */
  locked: boolean;
}

interface SiblingDirectory {
  name: string;
  path: string;
}

interface TargetWriteResult {
  path: string;
  ok: boolean;
  error?: string;
}

const COMMON_IGNORE_PATTERNS = [
  { pattern: '*.log', description: 'Log files' },
  { pattern: '*.tmp', description: 'Temporary files' },
  { pattern: 'node_modules', description: 'Node.js modules' },
  { pattern: '.env', description: 'Environment files' },
  { pattern: '.DS_Store', description: 'macOS metadata' },
  { pattern: 'Thumbs.db', description: 'Windows thumbnails' },
  { pattern: '*.swp', description: 'Vim swap files' },
  { pattern: '.idea', description: 'IntelliJ IDEA config' },
  { pattern: '.vscode', description: 'VS Code config' },
  { pattern: 'dist', description: 'Build output' },
  { pattern: 'build', description: 'Build output' },
  { pattern: 'coverage', description: 'Test coverage' },
];

function joinPath(parent: string, name: string): string {
  if (parent === '' || parent === '.') return name;
  return parent.endsWith('/') || parent.endsWith('\\') ? parent + name : `${parent}/${name}`;
}

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function nextRowId(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

async function listSiblingDirectories(parent: string, selfPath: string): Promise<SiblingDirectory[]> {
  try {
    const [listing, childCommits] = await Promise.all([
      window.api.fs.listDirectory(parent).catch(() => [] as FileInfo[]),
      window.api.svn.childCommits(parent).catch(() => ({}) as Record<string, unknown>),
    ]);
    const versioned = new Set(
      Object.entries(childCommits)
        .filter(([, info]) => !(info as { excluded?: boolean } | null)?.excluded)
        .map(([name]) => name)
    );
    const self = normalizeComparablePath(selfPath);
    return listing
      .filter((entry) => entry.isDirectory && versioned.has(entry.name))
      .map((entry) => ({ name: entry.name, path: joinPath(parent, entry.name) }))
      .filter((sibling) => normalizeComparablePath(sibling.path) !== self);
  } catch {
    return [];
  }
}

async function fetchUnversionedChildren(directory: string): Promise<UnversionedCandidate[]> {
  const result = assertSuccessfulSvnRead(await window.api.svn.status(directory));
  const normalizedDir = directory.replace(/\\/g, '/').replace(/\/+$/, '');
  return result.entries
    .filter((entry) => {
      if (entry.status !== '?') return false;
      const entryPath = entry.path.replace(/\\/g, '/');
      const parent = entryPath.slice(0, entryPath.lastIndexOf('/'));
      return parent === normalizedDir;
    })
    .map((entry) => ({
      name: entry.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? entry.path,
      isDirectory: entry.isDirectory,
    }));
}

export function IgnoreDialog({
  isOpen,
  onClose,
  path,
  fileName,
  onApply,
  propertyName: forcedPropertyName,
  initialValue,
  onApplyValue,
  onApplied,
}: IgnoreDialogProps) {
  const isLegacyDelegateMode = onApply !== undefined;
  const targetDir = isLegacyDelegateMode
    ? parentDirectoryOf(path)
    : path.replace(/[\\/]+$/, '') || '/';

  const [propertyName, setPropertyName] = useState<'svn:ignore' | 'svn:global-ignores'>(
    forcedPropertyName ?? 'svn:ignore'
  );
  const [rows, setRows] = useState<PatternRow[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [ignoreType, setIgnoreType] = useState<'file' | 'extension' | 'pattern'>('file');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unversioned, setUnversioned] = useState<UnversionedCandidate[] | null>(null);
  const [otherIgnoreValue, setOtherIgnoreValue] = useState<string | null>(null);
  const [explicitGlobal, setExplicitGlobal] = useState<string | null>(null);
  const [inheritedGlobal, setInheritedGlobal] = useState<string | null>(null);
  const [inheritedGlobalFrom, setInheritedGlobalFrom] = useState<string | undefined>(undefined);
  const [inheritedIgnore, setInheritedIgnore] = useState<{ value: string; from: string } | null>(
    null
  );
  const [showSiblings, setShowSiblings] = useState(false);
  const [siblings, setSiblings] = useState<SiblingDirectory[] | null>(null);
  const [selectedSiblings, setSelectedSiblings] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<TargetWriteResult[] | null>(null);
  const applyCounter = useRef(0);
  /** Unsaved drafts per property, so switching svn:ignore <-> global-ignores keeps edits. */
  const draftsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    setPropertyName(forcedPropertyName ?? 'svn:ignore');
  }, [forcedPropertyName]);

  const loadExisting = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setApplyResults(null);
    setSelectedSiblings(new Set());
    setSiblings(null);
    setUnversioned(null);

    const initialPropertyName = forcedPropertyName ?? 'svn:ignore';

    try {
      // Property context (explicit/inherited values). In draft mode the seed
      // comes from `initialValue`; the proplist call only enriches the
      // effective-vs-explicit display, so its failure is not fatal there.
      let list: Array<{ name: string; value: string; inherited?: boolean; inheritedFrom?: string }> = [];
      try {
        const props = assertSuccessfulSvnRead(
          await window.api.svn.proplist(targetDir, { showInherited: true })
        ).properties;
        list = Array.isArray(props) ? props : [];
      } catch (proplistError) {
        if (initialValue === undefined) throw proplistError;
      }
      const explicit = (name: string) =>
        list.find((prop) => prop.name === name && !prop.inherited)?.value ?? null;
      const inherited = (name: string) =>
        list.find((prop) => prop.name === name && prop.inherited);

      const existing = initialValue ?? explicit(initialPropertyName);
      setRows(parseIgnorePatterns(existing).map((text) => ({ id: nextRowId(), text, locked: isLegacyDelegateMode })));
      setOtherIgnoreValue(
        initialPropertyName === 'svn:ignore' && initialValue !== undefined
          ? initialValue
          : explicit('svn:ignore')
      );
      setExplicitGlobal(
        initialPropertyName === 'svn:global-ignores' && initialValue !== undefined
          ? initialValue
          : explicit('svn:global-ignores')
      );
      const inheritedGlobalProp = inherited('svn:global-ignores');
      setInheritedGlobal(inheritedGlobalProp?.value ?? null);
      setInheritedGlobalFrom(inheritedGlobalProp?.inheritedFrom || undefined);
      const inheritedIgnoreProp = inherited('svn:ignore');
      setInheritedIgnore(
        inheritedIgnoreProp
          ? {
              value: inheritedIgnoreProp.value,
              from: inheritedIgnoreProp.inheritedFrom || 'parent',
            }
          : null
      );

      // Seed the file-name quick suggestion for the delegate flow.
      if (fileName && isLegacyDelegateMode) {
        setIgnoreType('file');
      }

      setUnversioned(await fetchUnversionedChildren(targetDir).catch(() => null));

      if (!isLegacyDelegateMode && initialPropertyName === 'svn:ignore') {
        setSiblings(await listSiblingDirectories(parentDirectoryOf(targetDir), targetDir));
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to load ignore properties');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [targetDir, forcedPropertyName, isLegacyDelegateMode, fileName, initialValue]);

  useEffect(() => {
    if (isOpen) {
      setNewPattern('');
      setFieldError(null);
      setShowSiblings(false);
      draftsRef.current = {};
      void loadExisting();
    }
  }, [isOpen, loadExisting]);

  const patterns = useMemo(() => rows.map((row) => row.text), [rows]);
  const lintIssues = useMemo(() => lintIgnorePatterns(patterns), [patterns]);
  const lintErrors = hasIgnoreLintErrors(lintIssues);
  const hasInheritedIgnore =
    propertyName === 'svn:ignore' && inheritedIgnore !== null && otherIgnoreValue === null;

  const effective = useMemo(
    () =>
      computeEffectiveIgnore({
        explicitIgnore:
          propertyName === 'svn:ignore'
            ? formatIgnorePatterns(patterns)
            : (draftsRef.current['svn:ignore'] ?? otherIgnoreValue),
        explicitGlobalIgnores:
          propertyName === 'svn:global-ignores'
            ? formatIgnorePatterns(patterns)
            : (draftsRef.current['svn:global-ignores'] ?? explicitGlobal),
        inheritedGlobalIgnores: inheritedGlobal,
        inheritedGlobalFrom: inheritedGlobalFrom,
      }),
    [patterns, propertyName, otherIgnoreValue, explicitGlobal, inheritedGlobal, inheritedGlobalFrom]
  );

  const preview = useMemo(
    () => (unversioned ? matchUnversionedEntries(effective.effective, unversioned) : null),
    [effective, unversioned]
  );

  const addPattern = (raw: string) => {
    const pattern = raw.trim();
    if (!pattern) {
      setFieldError('Pattern cannot be empty');
      return;
    }
    if (patterns.includes(pattern)) {
      setFieldError('Pattern already in the list');
      return;
    }
    setRows((current) => [...current, { id: nextRowId(), text: pattern, locked: false }]);
    setNewPattern('');
    setFieldError(null);
  };

  const removeRow = (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const moveRow = (index: number, delta: -1 | 1) => {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const suggestedPattern = () => {
    if (!fileName) return newPattern;
    if (ignoreType === 'file') return fileName;
    if (ignoreType === 'extension') {
      const ext = fileName.split('.').pop();
      return ext ? `*.${ext}` : fileName;
    }
    return newPattern;
  };

  const newValue = formatIgnorePatterns(patterns);

  const switchProperty = (name: 'svn:ignore' | 'svn:global-ignores') => {
    if (name === propertyName) return;
    draftsRef.current[propertyName] = newValue;
    const loaded = name === 'svn:ignore' ? otherIgnoreValue : explicitGlobal;
    const draft = draftsRef.current[name];
    setPropertyName(name);
    setRows(
      parseIgnorePatterns(draft ?? loaded).map((text) => ({
        id: nextRowId(),
        text,
        locked: false,
      }))
    );
  };

  const handleApply = async () => {
    setSuccess(null);
    setApplyResults(null);

    if (isLegacyDelegateMode && onApply) {
      const added = rows.filter((row) => !row.locked).map((row) => row.text);
      onApply(added);
      onClose();
      return;
    }

    if (onApplyValue) {
      onApplyValue(newValue);
      onClose();
      return;
    }

    const siblingTargets = siblings
      ? siblings.filter((sibling) => selectedSiblings.has(sibling.path)).map((s) => s.path)
      : [];
    const confirmed = await confirmAppAction({
      type: 'warning',
      message:
        siblingTargets.length > 0
          ? `Set ${propertyName} on ${targetDir} and ${siblingTargets.length} sibling director${siblingTargets.length !== 1 ? 'ies' : 'y'}?`
          : `Set ${propertyName} on ${targetDir}?`,
      detail:
        `New value (${patterns.length} pattern${patterns.length !== 1 ? 's' : ''}):\n${newValue || '(empty — property will be cleared)'}`,
      confirmLabel: 'Set Property',
    });
    if (!confirmed) return;

    setIsApplying(true);
    setError(null);
    const runId = ++applyCounter.current;
    const targets = [targetDir, ...siblingTargets];
    const results: TargetWriteResult[] = [];
    for (const target of targets) {
      try {
        await window.api.svn.propset(target, propertyName, newValue);
        results.push({ path: target, ok: true });
        onApplied?.(target);
      } catch (err) {
        results.push({ path: target, ok: false, error: (err as Error).message || 'Failed' });
      }
      if (applyCounter.current !== runId) return; // superseded (re-opened)
      setApplyResults([...results]);
    }
    setIsApplying(false);
    const failures = results.filter((result) => !result.ok);
    if (failures.length === 0) {
      setSuccess(
        targets.length > 1
          ? `${propertyName} set on all ${targets.length} directories`
          : `${propertyName} set`
      );
    } else {
      setError(`${failures.length} of ${targets.length} directories failed — see details below.`);
    }
  };

  if (!isOpen) return null;

  const issuesForRow = (index: number) => lintIssues.filter((issue) => issue.line === index + 1);
  const addedCount = rows.filter((row) => !row.locked).length;
  const canApply = !isApplying && !lintErrors && (!isLegacyDelegateMode || addedCount > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-[600px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Eye className="w-5 h-5 text-accent" />
            {isLegacyDelegateMode ? 'Add to Ignore List' : `Edit ${propertyName}`}
          </h2>
          <button onClick={onClose} className="btn-icon-sm" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target line */}
        <div className="px-4 py-2 bg-bg-tertiary border-b border-border text-sm text-text-secondary truncate">
          {isLegacyDelegateMode ? (
            <>
              Patterns apply to the <code>svn:ignore</code> property of{' '}
              <span className="font-mono">{targetDir}</span>
            </>
          ) : (
            <span className="font-mono">{targetDir}</span>
          )}
        </div>

        {/* Content */}
        <div className="modal-body overflow-auto space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <>
              {error && (
                <div className="text-sm text-error flex items-center gap-1.5" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              {success && (
                <div className="text-sm text-success flex items-center gap-1.5" role="status">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {success}
                </div>
              )}

              {/* Property switch (editor mode only) */}
              {!isLegacyDelegateMode && !forcedPropertyName && (
                <div className="flex gap-2" role="radiogroup" aria-label="Property to edit">
                  {(['svn:ignore', 'svn:global-ignores'] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={propertyName === name}
                      onClick={() => switchProperty(name)}
                      className={`btn btn-sm ${propertyName === name ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {propertyName === 'svn:global-ignores' && !isLegacyDelegateMode && (
                <p className="text-xs text-text-muted">
                  <code>svn:global-ignores</code> applies to this directory <em>and everything
                  below it</em>. An explicit value replaces any inherited one.
                </p>
              )}

              {/* Quick options for a selected file (legacy flow) */}
              {fileName && (
                <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-text">Ignore this file by:</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIgnoreType('file')}
                      className={`btn btn-sm ${ignoreType === 'file' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Exact name ({fileName})
                    </button>
                    <button
                      type="button"
                      onClick={() => setIgnoreType('extension')}
                      className={`btn btn-sm ${ignoreType === 'extension' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Extension (*.{fileName.split('.').pop()})
                    </button>
                    <button
                      type="button"
                      onClick={() => setIgnoreType('pattern')}
                      className={`btn btn-sm ${ignoreType === 'pattern' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Custom pattern
                    </button>
                  </div>
                </div>
              )}

              {/* Add pattern */}
              <div>
                <label
                  htmlFor="ignore-pattern-input"
                  className="text-sm font-medium text-text-secondary mb-1.5 block"
                >
                  Add pattern
                </label>
                <div className="flex gap-2">
                  <input
                    id="ignore-pattern-input"
                    type="text"
                    value={ignoreType !== 'pattern' && fileName ? suggestedPattern() : newPattern}
                    onChange={(e) => {
                      setIgnoreType('pattern');
                      setNewPattern(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addPattern(suggestedPattern());
                      }
                    }}
                    placeholder="*.log, node_modules, .env"
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => addPattern(suggestedPattern())}
                    className="btn btn-primary"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </div>
                {fieldError && (
                  <p className="text-xs text-error mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldError}
                  </p>
                )}
              </div>

              {/* Pattern list (line-based editor) */}
              <div>
                <div className="text-sm font-medium text-text-secondary mb-1.5">
                  {propertyName} — {patterns.length} pattern{patterns.length !== 1 ? 's' : ''}
                  {hasInheritedIgnore && (
                    <span className="ml-2 text-xs text-text-muted">
                      (an inherited svn:ignore exists but only applies on its own directory)
                    </span>
                  )}
                </div>
                {patterns.length === 0 ? (
                  <p className="text-xs text-text-muted px-1 py-2">
                    No patterns yet — nothing is ignored by this property here.
                  </p>
                ) : (
                  <ul className="space-y-1" aria-label="Ignore patterns">
                    {rows.map((row, index) => {
                      const rowIssues = issuesForRow(index);
                      return (
                        <li
                          key={row.id}
                          className="bg-bg-tertiary rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-x-2"
                        >
                          <span className="text-xs text-text-faint w-5 text-right tabular-nums">
                            {index + 1}
                          </span>
                          <span className="font-mono text-sm flex-1 truncate" title={row.text}>
                            {row.text}
                          </span>
                          <button
                            type="button"
                            onClick={() => moveRow(index, -1)}
                            disabled={index === 0}
                            className="btn-icon-sm"
                            aria-label={`Move ${row.text} up`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(index, 1)}
                            disabled={index === rows.length - 1}
                            className="btn-icon-sm"
                            aria-label={`Move ${row.text} down`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            disabled={row.locked}
                            className="btn-icon-sm hover:text-error"
                            aria-label={row.locked ? 'Existing pattern (managed by caller)' : `Remove ${row.text}`}
                            title={
                              row.locked
                                ? 'Pre-existing pattern — removal is only available in the full editor'
                                : 'Remove pattern'
                            }
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          {rowIssues.length > 0 && (
                            <ul className="w-full flex flex-col gap-0.5 mb-1">
                              {rowIssues.map((issue, issueIndex) => (
                                <li
                                  key={issueIndex}
                                  className={`text-xs flex items-start gap-1 ${
                                    issue.severity === 'error'
                                      ? 'text-error'
                                      : issue.severity === 'warning'
                                        ? 'text-warning'
                                        : 'text-text-muted'
                                  }`}
                                >
                                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                  <span>
                                    {issue.message}
                                    {issue.fix && (
                                      <>
                                        {' '}
                                        <button
                                          type="button"
                                          className="underline underline-offset-2"
                                          onClick={() =>
                                            setRows((current) =>
                                              current.map((candidate) =>
                                                candidate.id === row.id
                                                  ? { ...candidate, text: issue.fix! }
                                                  : candidate
                                              )
                                            )
                                          }
                                        >
                                          use “{issue.fix}”
                                        </button>
                                      </>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Quick patterns */}
              <div>
                <div className="text-sm font-medium text-text-secondary mb-1.5">
                  Quick add common patterns:
                </div>
                <div className="flex flex-wrap gap-1">
                  {COMMON_IGNORE_PATTERNS.map(({ pattern, description }) => (
                    <button
                      key={pattern}
                      type="button"
                      onClick={() => addPattern(pattern)}
                      disabled={patterns.includes(pattern)}
                      className={`text-xs px-2 py-1 rounded transition-fast ${
                        patterns.includes(pattern)
                          ? 'bg-bg-elevated text-text-faint'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated'
                      }`}
                      title={description}
                    >
                      {pattern}
                    </button>
                  ))}
                </div>
              </div>

              {/* Effective vs explicit */}
              {!isLegacyDelegateMode && effective.effectiveGlobal.source !== 'none' && (
                <div className="bg-bg-secondary border border-border rounded-lg p-2.5 text-xs space-y-1">
                  <p className="font-medium text-text">
                    Effective ignore set for this directory
                  </p>
                  <p className="text-text-secondary">
                    {propertyName === 'svn:ignore'
                      ? `${patterns.length} explicit svn:ignore pattern${patterns.length !== 1 ? 's' : ''}`
                      : `${patterns.length} explicit svn:global-ignores pattern${patterns.length !== 1 ? 's' : ''}`}{' '}
                    + svn:global-ignores{' '}
                    {effective.effectiveGlobal.source === 'explicit' ? '(set here)' : '(inherited)'}
                    {effective.effectiveGlobal.source === 'inherited' && effective.effectiveGlobal.from
                      ? ` from ${effective.effectiveGlobal.from}`
                      : ''}
                    : {effective.effectiveGlobal.patterns.length} pattern
                    {effective.effectiveGlobal.patterns.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-text-faint">
                    Inherited svn:ignore never applies to subdirectories — that is what
                    svn:global-ignores is for. Your runtime global-ignores config also applies but
                    is not part of the property.
                  </p>
                </div>
              )}

              {/* Live preview */}
              {preview && (preview.matched.length > 0 || preview.unmatched.length > 0) && (
                <div className="bg-bg-secondary border border-border rounded-lg p-2.5 text-xs space-y-1.5">
                  <p className="font-medium text-text">Live preview — unversioned items here</p>
                  {preview.matched.length > 0 && (
                    <ul className="space-y-0.5" aria-label="Unversioned items that match">
                      {preview.matched.slice(0, 8).map((item) => (
                        <li key={item.name} className="text-text-muted line-through">
                          {item.isDirectory ? '▸' : '•'}{' '}
                          <span className="font-mono">{item.name}</span>{' '}
                          <span className="text-text-faint">matched by {item.matchedBy}</span>
                        </li>
                      ))}
                      {preview.matched.length > 8 && (
                        <li className="text-text-faint">
                          … and {preview.matched.length - 8} more
                        </li>
                      )}
                    </ul>
                  )}
                  {preview.unmatched.length > 0 && (
                    <ul className="space-y-0.5" aria-label="Unversioned items that do not match">
                      {preview.unmatched.slice(0, 8).map((item) => (
                        <li key={item.name} className="text-text-secondary">
                          {item.isDirectory ? '▸' : '•'}{' '}
                          <span className="font-mono">{item.name}</span>{' '}
                          <span className="text-text-faint">still shows as unversioned</span>
                        </li>
                      ))}
                      {preview.unmatched.length > 8 && (
                        <li className="text-text-faint">
                          … and {preview.unmatched.length - 8} more
                        </li>
                      )}
                    </ul>
                  )}
                  {preview.matched.length === 0 && (
                    <p className="text-text-faint">
                      No known unversioned item matches yet — add a pattern to see it here.
                    </p>
                  )}
                </div>
              )}

              {/* Apply to siblings (editor + self-write only) */}
              {!isLegacyDelegateMode && !onApplyValue && propertyName === 'svn:ignore' && (
                <div className="border border-border rounded-lg p-2.5 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSiblings((v) => !v)}
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text"
                    aria-expanded={showSiblings}
                  >
                    <FolderTree className="w-4 h-4" />
                    Apply to sibling directories
                    {selectedSiblings.size > 0 && (
                      <span className="text-xs text-accent">({selectedSiblings.size} selected)</span>
                    )}
                  </button>
                  {showSiblings && (
                    siblings === null ? (
                      <p className="text-xs text-text-muted">Looking up siblings…</p>
                    ) : siblings.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        No versioned sibling directories found next to{' '}
                        <span className="font-mono">{targetDir}</span>.
                      </p>
                    ) : (
                      <ul className="max-h-32 overflow-auto space-y-1" aria-label="Sibling directories">
                        {siblings.map((sibling) => (
                          <li key={sibling.path}>
                            <label className="flex items-center gap-2 text-xs text-text-secondary">
                              <input
                                type="checkbox"
                                checked={selectedSiblings.has(sibling.path)}
                                onChange={(event) =>
                                  setSelectedSiblings((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(sibling.path);
                                    else next.delete(sibling.path);
                                    return next;
                                  })
                                }
                              />
                              <span className="font-mono truncate">{sibling.name}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                  {selectedSiblings.size > 0 && (
                    <p className="text-xs text-text-muted">
                      The same {propertyName} value will be written to {selectedSiblings.size}{' '}
                      sibling director{selectedSiblings.size !== 1 ? 'ies' : 'y'} — each write is
                      independent; failures are reported per directory.
                    </p>
                  )}
                </div>
              )}

              {/* Per-target write results */}
              {applyResults && applyResults.length > 0 && (
                <ul className="text-xs space-y-0.5" aria-label="Property write results">
                  {applyResults.map((result) => (
                    <li
                      key={result.path}
                      className={result.ok ? 'text-success' : 'text-error'}
                    >
                      {result.ok ? '✓' : '✗'} <span className="font-mono">{result.path}</span>
                      {!result.ok && result.error ? ` — ${result.error}` : ''}
                    </li>
                  ))}
                </ul>
              )}

              {/* Lint summary */}
              {lintIssues.length > 0 && (
                <p
                  className={`text-xs ${lintErrors ? 'text-error' : 'text-warning'}`}
                  role="status"
                >
                  {lintErrors
                    ? `${lintIssues.filter((i) => i.severity === 'error').length} blocking issue${lintIssues.filter((i) => i.severity === 'error').length !== 1 ? 's' : ''} — fix them before applying.`
                    : `${lintIssues.length} advisory hint${lintIssues.length !== 1 ? 's' : ''} (see the list above).`}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              className="btn btn-primary"
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {isLegacyDelegateMode
                    ? `Ignore ${addedCount} pattern${addedCount !== 1 ? 's' : ''}`
                    : onApplyValue
                      ? 'Apply to Draft'
                      : `Set ${propertyName}`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
