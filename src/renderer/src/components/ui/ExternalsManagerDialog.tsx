import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { DialogBase } from './DialogBase';
import { confirmAppAction } from '../../utils/dialogs';
import {
  formatSvnExternals,
  parseSvnExternals,
  validateExternalFields,
  type SvnExternalDefinition,
  type SvnExternalLine,
  type SvnExternalsWarning,
} from '../../lib/svnExternals';

export interface ExternalsManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Directory carrying the svn:externals property (display + write target). */
  path: string;
  /** Current svn:externals property value. */
  initialValue: string;
  /**
   * Draft mode: receives the formatted new value (PropertiesDialog persists
   * it with its Save Changes flow). Without it the dialog writes the property
   * itself via `svn propset` after an explicit confirmation.
   */
  onApply?: (value: string) => void;
  /** Called after a successful self-write (for cache invalidation). */
  onApplied?: (path: string) => void;
}

type Row =
  | {
      kind: 'definition';
      id: number;
      fields: {
        localPath: string;
        url: string;
        operativeRevision: string;
        pegRevision: string;
      };
      raw: string;
      legacy: boolean;
      warnings: SvnExternalsWarning[];
    }
  | { kind: 'comment'; id: number; raw: string }
  | { kind: 'blank'; id: number; raw: string }
  | { kind: 'invalid'; id: number; raw: string; error: string };

let rowIdSeed = 1;
const nextRowId = () => rowIdSeed++;

type DefinitionRow = Extract<Row, { kind: 'definition' }>;

function definitionToRow(
  definition: SvnExternalDefinition,
  raw: string,
  warnings: SvnExternalsWarning[]
): DefinitionRow {
  return {
    kind: 'definition',
    id: nextRowId(),
    fields: {
      localPath: definition.localPath,
      url: definition.url,
      operativeRevision: definition.operativeRevision ?? '',
      pegRevision: definition.pegRevision ?? '',
    },
    raw,
    legacy: definition.legacy === true,
    warnings,
  };
}

function rowToDefinition(row: Extract<Row, { kind: 'definition' }>): SvnExternalDefinition {
  return {
    localPath: row.fields.localPath.trim(),
    url: row.fields.url.trim(),
    ...(row.fields.operativeRevision.trim()
      ? { operativeRevision: row.fields.operativeRevision.trim() }
      : {}),
    ...(row.fields.pegRevision.trim() ? { pegRevision: row.fields.pegRevision.trim() } : {}),
    ...(row.legacy ? { legacy: true } : {}),
  };
}

function rowsToLines(rows: Row[]): SvnExternalLine[] {
  return rows.map((row) => {
    switch (row.kind) {
      case 'definition':
        return {
          kind: 'definition',
          raw: row.raw,
          definition: rowToDefinition(row),
          warnings: row.warnings,
        };
      case 'comment':
        return { kind: 'comment', raw: row.raw, comment: row.raw.replace(/^#\s?/, '') };
      case 'blank':
        return { kind: 'blank', raw: row.raw };
      case 'invalid':
        return { kind: 'invalid', raw: row.raw, error: row.error };
    }
  });
}

/** Split a best-effort `URL@PEG` token for the "Fix" prefill. */
function splitUrlToken(token: string): { url: string; peg: string } {
  const match = /^(.*)@(\d+|HEAD)$/i.exec(token);
  return match ? { url: match[1], peg: match[2] } : { url: token, peg: '' };
}

/** Table editor for svn:externals (#54): parse, edit peg/operative revisions, write back. */
export function ExternalsManagerDialog({
  isOpen,
  onClose,
  path,
  initialValue,
  onApply,
  onApplied,
}: ExternalsManagerDialogProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Extract<Row, { kind: 'definition' }>['fields'] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const reset = useCallback(() => {
    const parsed = parseSvnExternals(initialValue);
    setRows(
      parsed.lines.map((line) => {
        if (line.kind === 'definition') return definitionToRow(line.definition, line.raw, line.warnings);
        if (line.kind === 'comment') return { kind: 'comment', id: nextRowId(), raw: line.raw };
        if (line.kind === 'blank') return { kind: 'blank', id: nextRowId(), raw: line.raw };
        return { kind: 'invalid', id: nextRowId(), raw: line.raw, error: line.error };
      })
    );
    setEditingId(null);
    setDraft(null);
    setError(null);
    setSuccess(null);
    setWriteError(null);
  }, [initialValue]);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  const startEdit = (row: Extract<Row, { kind: 'definition' }>) => {
    setEditingId(row.id);
    setDraft({ ...row.fields });
    setSuccess(null);
    setWriteError(null);
  };

  const draftIssues = useMemo(
    () =>
      draft
        ? validateExternalFields({
            localPath: draft.localPath,
            url: draft.url,
            operativeRevision: draft.operativeRevision || undefined,
            pegRevision: draft.pegRevision || undefined,
          })
        : null,
    [draft]
  );

  const draftValid =
    draftIssues !== null &&
    Object.values(draftIssues).every((fieldIssues) => fieldIssues.length === 0);

  const commitEdit = () => {
    if (draft === null || editingId === null || !draftValid) return;
    setRows((current) =>
      current.map((row) =>
        row.kind === 'definition' && row.id === editingId ? { ...row, fields: { ...draft } } : row
      )
    );
    setEditingId(null);
    setDraft(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const addRow = () => {
    const row = definitionToRow({ localPath: '', url: '' }, '(new definition)', []);
    setRows((current) => [...current, row]);
    setEditingId(row.id);
    setDraft({ ...row.fields });
  };

  const removeRow = (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id));
    if (editingId === id) cancelEdit();
  };

/** Fix up an unparseable line: prefill the editor with a best-effort split. */
const repairInvalidRow = (row: Extract<Row, { kind: 'invalid' }>) => {
  const tokens = row.raw.trim().split(/\s+/).filter(Boolean);
  const firstIsUrl = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\^\/|\/\/|\/|\.{1,2}\/)/.test(tokens[0] ?? '');
  const { url, peg } = splitUrlToken((firstIsUrl ? tokens[0] : tokens[1]) ?? '');
  const operative = tokens.find((token) => /^-r(.+)$/i.test(token))?.replace(/^-r/i, '') ?? '';
  const fields = {
    localPath: firstIsUrl ? (tokens[1] ?? '') : (tokens[0] ?? ''),
    url,
    operativeRevision: operative,
    pegRevision: peg,
  };
  setRows((current) =>
    current.map((entry) =>
      entry.id === row.id
        ? definitionToRow({ localPath: fields.localPath, url: fields.url }, row.raw, [])
        : entry
    )
  );
  setEditingId(row.id);
  setDraft(fields);
};

  const newValue = useMemo(() => formatSvnExternals(rowsToLines(rows)), [rows]);

  const duplicatePaths = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.kind !== 'definition') continue;
      const key = row.fields.localPath.trim().replace(/\\/g, '/').toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(counts.entries().filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);

  const hasBlockingIssues =
    rows.some(
      (row) =>
        row.kind === 'definition' &&
        (row.fields.localPath.trim() === '' || row.fields.url.trim() === '')
    ) || Object.values(draftIssues ?? {}).some((fieldIssues) => fieldIssues.length > 0);

  const handleSave = async () => {
    if (editingId !== null) {
      setError('Finish or cancel the row being edited first.');
      return;
    }
    setError(null);
    setSuccess(null);
    setWriteError(null);

    if (onApply) {
      onApply(newValue);
      onClose();
      return;
    }

    const confirmed = await confirmAppAction({
      type: 'warning',
      message: `Set svn:externals on ${path}?`,
      detail: `New value:\n${newValue || '(empty — property will be cleared)'}`,
      confirmLabel: 'Set Property',
    });
    if (!confirmed) return;

    setIsSaving(true);
    try {
      await window.api.svn.propset(path, 'svn:externals', newValue);
      onApplied?.(path);
      setSuccess('svn:externals updated');
    } catch (err) {
      setWriteError((err as Error).message || 'Failed to set svn:externals');
    } finally {
      setIsSaving(false);
    }
  };

  const definitionRows = rows.filter((row): row is Extract<Row, { kind: 'definition' }> => row.kind === 'definition');

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-accent" />
          Externals Manager
        </span>
      }
      dialogId="svn-externals-manager"
      className="w-[860px] max-h-[85vh] flex flex-col"
      initialFocus="first-control"
    >
      <div className="px-4 py-2 bg-bg-tertiary border-b border-border text-sm text-text-secondary truncate">
        <span className="font-mono">{path}</span>
        <span className="ml-2 text-xs text-text-faint">
          svn:externals — one definition per line: URL[@PEG] [-r REV] local-path
        </span>
      </div>

      <div className="modal-body overflow-auto">
        {error && (
          <p className="text-sm text-error mb-2" role="alert">
            {error}
          </p>
        )}
        {writeError && (
          <p className="text-sm text-error mb-2" role="alert">
            {writeError}
          </p>
        )}
        {success && (
          <p className="text-sm text-success mb-2 flex items-center gap-1" role="status">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="svn:externals definitions">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Local path</th>
                <th className="py-1.5 pr-3 font-medium">URL</th>
                <th className="py-1.5 pr-3 font-medium">Operative rev (-r)</th>
                <th className="py-1.5 pr-3 font-medium">Peg rev (@)</th>
                <th className="py-1.5 pr-3 font-medium">Raw line</th>
                <th className="py-1.5 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-xs text-text-muted">
                    No svn:externals definitions. Use “Add Definition” to create one.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                if (row.kind === 'blank') {
                  return (
                    <tr key={row.id} className="border-b border-border/50">
                      <td colSpan={6} className="py-1 text-center text-text-faint text-xs">
                        ·
                      </td>
                    </tr>
                  );
                }
                if (row.kind === 'comment') {
                  return (
                    <tr key={row.id} className="border-b border-border/50">
                      <td colSpan={5} className="py-1.5 px-1 text-xs text-text-faint font-mono">
                        {row.raw}
                      </td>
                      <td />
                    </tr>
                  );
                }
                if (row.kind === 'invalid') {
                  return (
                    <tr key={row.id} className="border-b border-border/50 bg-error/5">
                      <td colSpan={5} className="py-1.5 px-1 text-xs">
                        <span className="flex items-start gap-1.5 text-error">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>
                            <span className="font-mono">{row.raw}</span>
                            <span className="block">{row.error}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => repairInvalidRow(row)}
                        >
                          <Pencil className="w-3 h-3" />
                          Fix
                        </button>
                      </td>
                    </tr>
                  );
                }

                const isEditing = editingId === row.id;
                const duplicate =
                  duplicatePaths.has(row.fields.localPath.trim().replace(/\\/g, '/').toLowerCase());
                return (
                  <tr key={row.id} className="border-b border-border/50 align-top">
                    {isEditing && draft ? (
                      <>
                        <td className="py-1.5 pr-3">
                          <input
                            value={draft.localPath}
                            onChange={(event) => setDraft({ ...draft, localPath: event.target.value })}
                            aria-label="Local path"
                            className={`input w-36 text-xs ${draftIssues?.localPath.length ? 'border-error' : ''}`}
                          />
                          {draftIssues?.localPath.map((issue, index) => (
                            <p key={index} className="text-xs text-error mt-0.5">
                              {issue}
                            </p>
                          ))}
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            value={draft.url}
                            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                            aria-label="External URL"
                            className={`input w-64 text-xs ${draftIssues?.url.length ? 'border-error' : ''}`}
                          />
                          {draftIssues?.url.map((issue, index) => (
                            <p key={index} className="text-xs text-error mt-0.5">
                              {issue}
                            </p>
                          ))}
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            value={draft.operativeRevision}
                            onChange={(event) =>
                              setDraft({ ...draft, operativeRevision: event.target.value })
                            }
                            placeholder="HEAD"
                            aria-label="Operative revision"
                            className={`input w-20 text-xs ${draftIssues?.operativeRevision.length ? 'border-error' : ''}`}
                          />
                          {draftIssues?.operativeRevision.map((issue, index) => (
                            <p key={index} className="text-xs text-error mt-0.5">
                              {issue}
                            </p>
                          ))}
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            value={draft.pegRevision}
                            onChange={(event) => setDraft({ ...draft, pegRevision: event.target.value })}
                            placeholder="HEAD"
                            aria-label="Peg revision"
                            className={`input w-20 text-xs ${draftIssues?.pegRevision.length ? 'border-error' : ''}`}
                          />
                          {draftIssues?.pegRevision.map((issue, index) => (
                            <p key={index} className="text-xs text-error mt-0.5">
                              {issue}
                            </p>
                          ))}
                        </td>
                        <td className="py-1.5 pr-3 text-xs font-mono text-text-faint">
                          {row.raw}
                        </td>
                        <td className="py-1.5">
                          <div className="flex gap-1 justify-end">
                            <button
                              type="button"
                              onClick={commitEdit}
                              disabled={!draftValid}
                              className="btn btn-primary btn-sm"
                              aria-label="Save row"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="btn btn-secondary btn-sm"
                              aria-label="Cancel row edit"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {row.fields.localPath || <span className="text-error">(missing)</span>}
                          {duplicate && (
                            <span className="block text-warning text-xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> duplicate local path
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs break-all">
                          {row.fields.url || <span className="text-error">(missing)</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-xs">{row.fields.operativeRevision || '—'}</td>
                        <td className="py-1.5 pr-3 text-xs">{row.fields.pegRevision || '—'}</td>
                        <td className="py-1.5 pr-3 text-xs font-mono text-text-faint break-all">
                          {row.raw}
                          {row.warnings.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5">
                              {row.warnings.map((warning, index) => (
                                <li
                                  key={index}
                                  className="text-warning text-xs flex items-start gap-1"
                                >
                                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                  {warning.message}
                                </li>
                              ))}
                            </ul>
                          )}
                          {row.legacy && (
                            <span className="block text-text-faint text-xs">
                              legacy layout — will be saved as URL-first
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <div className="flex gap-1 justify-end">
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="btn-icon-sm"
                              aria-label={`Edit ${row.fields.localPath || 'row'}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="btn-icon-sm hover:text-error"
                              aria-label={`Remove ${row.fields.localPath || 'row'}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={addRow} className="btn btn-secondary btn-sm">
            <Plus className="w-3.5 h-3.5" />
            Add Definition
          </button>
          <span className="text-xs text-text-faint">
            {definitionRows.length} definition{definitionRows.length !== 1 ? 's' : ''}
            {rows.some((row) => row.kind === 'invalid') && ' — unparseable lines are kept verbatim until fixed'}
          </span>
        </div>

        <details className="mt-3">
          <summary className="text-xs text-text-muted cursor-pointer">
            Resulting property value
          </summary>
          <pre className="mt-1.5 text-xs font-mono bg-bg-secondary border border-border rounded-lg p-2.5 text-text-secondary whitespace-pre-wrap break-all">
            {newValue || '(empty)'}
          </pre>
        </details>
      </div>

      <div className="modal-footer">
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || hasBlockingIssues || editingId !== null}
            className="btn btn-primary"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {onApply ? 'Apply Value' : 'Set svn:externals'}
              </>
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}

