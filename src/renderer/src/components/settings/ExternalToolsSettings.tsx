/**
 * Custom external diff/merge tools (#87).
 *
 * Lists the tools registered with the main process (read-only) and lets the
 * user add custom tools: name, executable (native file picker), kind, and an
 * argument template with `{mine}` `{theirs}` `{base}` `{merged}` placeholders.
 * Template problems surface live via lib/externalToolTemplates validation.
 * Tools persist in `AppSettings.externalToolTemplates` and flow through the
 * dialog's normal Save/Cancel preview pipeline.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react';

import type { ExternalToolSummary, ExternalToolTemplateConfig } from '@shared/types';

import {
  createExternalToolId,
  describeRequiredPlaceholders,
  expandArgumentTemplate,
  validateExternalTool,
} from '../../lib/externalToolTemplates';
import { SettingsGroup } from './SettingsGroup';

interface ExternalToolsSettingsProps {
  tools: ExternalToolTemplateConfig[];
  onChange: (tools: ExternalToolTemplateConfig[]) => void;
}

interface EditorState {
  id: string;
  name: string;
  executablePath: string;
  kind: 'diff' | 'merge';
  argumentTemplate: string;
}

const SAMPLE_VALUES = {
  mine: '/tmp/conflict.mine',
  theirs: '/tmp/conflict.theirs.r2',
  base: '/tmp/conflict.base.r1',
  merged: '/tmp/conflict.working',
};

function emptyEditor(): EditorState {
  return {
    id: '',
    name: '',
    executablePath: '',
    kind: 'diff',
    argumentTemplate: '',
  };
}

export function ExternalToolsSettings({ tools, onChange }: ExternalToolsSettingsProps) {
  const [registered, setRegistered] = useState<ExternalToolSummary[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.api?.externalTools
      ?.list()
      .then((list) => {
        if (active) setRegistered(list);
      })
      .catch(() => {
        if (active) setRegistered([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const browseExecutable = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh', 'command'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path && editor) {
      const leaf = path.split(/[/\\]/).pop() ?? '';
      setEditor({
        ...editor,
        executablePath: path,
        name: editor.name || leaf.replace(/\.(exe|app|sh|command)$/i, ''),
      });
    }
  };

  const editorDraft: ExternalToolTemplateConfig | null = editor
    ? {
        id: editor.id || 'draft',
        name: editor.name,
        executablePath: editor.executablePath,
        kind: editor.kind,
        argumentTemplate: editor.argumentTemplate,
        createdAt: 0,
      }
    : null;
  const editorValidation = editorDraft ? validateExternalTool(editorDraft) : null;

  const startAdd = () => {
    setEditingId(null);
    setEditor({ ...emptyEditor(), id: createExternalToolId() });
  };

  const startEdit = (tool: ExternalToolTemplateConfig) => {
    setEditingId(tool.id);
    setEditor({
      id: tool.id,
      name: tool.name,
      executablePath: tool.executablePath,
      kind: tool.kind,
      argumentTemplate: tool.argumentTemplate,
    });
  };

  const commitEditor = () => {
    if (!editor || !editorValidation?.valid) return;
    const entry: ExternalToolTemplateConfig = {
      id: editor.id,
      name: editor.name.trim(),
      executablePath: editor.executablePath.trim(),
      kind: editor.kind,
      argumentTemplate: editor.argumentTemplate,
      createdAt: tools.find((tool) => tool.id === editor.id)?.createdAt ?? Date.now(),
    };
    onChange(
      tools.some((tool) => tool.id === entry.id)
        ? tools.map((tool) => (tool.id === entry.id ? entry : tool))
        : [...tools, entry]
    );
    setEditor(null);
    setEditingId(null);
  };

  const removeTool = (id: string) => {
    onChange(tools.filter((tool) => tool.id !== id));
    if (editingId === id) {
      setEditor(null);
      setEditingId(null);
    }
  };

  return (
    <SettingsGroup
      title="Custom Tools"
      description="Add diff or merge tools with your own executable and arguments"
    >
      <div className="space-y-4">
        {registered !== null && registered.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-muted">Registered with the system:</p>
            <div className="flex flex-wrap gap-1.5">
              {registered.map((tool) => (
                <span
                  key={tool.id}
                  className={`inline-flex items-center gap-1.5 rounded-7 border px-2 py-1 text-xs ${
                    tool.available
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-border-muted bg-bg-tertiary text-text-muted'
                  }`}
                >
                  {tool.name}
                  <span className="text-9.5">{tool.roles.join('/')}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {tools.length === 0 && !editor && (
          <p className="text-sm text-text-muted">
            No custom tools yet. The built-in viewer and the registered tools above stay available.
          </p>
        )}

        <div className="space-y-2">
          {tools.map((tool) => {
            const validation = validateExternalTool(tool);
            return (
              <div
                key={tool.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-tertiary p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-text">
                    {validation.valid ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    )}
                    {tool.name}
                    <span className="rounded bg-bg-sunk px-1.5 py-0.5 text-9.5 uppercase tracking-wide text-text-muted">
                      {tool.kind}
                    </span>
                  </p>
                  <p className="truncate font-mono text-10.5 text-text-muted" title={tool.executablePath}>
                    {tool.executablePath}
                  </p>
                  <p className="truncate font-mono text-10.5 text-text-faint" title={tool.argumentTemplate}>
                    {tool.argumentTemplate || '(no arguments)'}
                  </p>
                  {!validation.valid && (
                    <p className="mt-1 text-10.5 text-warning">{validation.errors.join(' ')}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                    onClick={() => startEdit(tool)}
                    aria-label={`Edit custom tool ${tool.name}`}
                    disabled={editingId === tool.id}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon-sm text-error hover:bg-error/10"
                    onClick={() => removeTool(tool.id)}
                    aria-label={`Remove custom tool ${tool.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {editor && editorValidation && (
          <div
            className="space-y-3 rounded-lg border border-border-focus bg-bg-sunk/60 p-3"
            data-testid="external-tool-editor"
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-text-muted">Name</span>
                <input
                  type="text"
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                  placeholder="Beyond Compare"
                  className="input mt-1 w-full"
                  aria-label="Custom tool name"
                  data-testid="external-tool-name"
                />
                {editorValidation.nameError && (
                  <span className="mt-1 block text-10.5 text-error">{editorValidation.nameError}</span>
                )}
              </label>
              <label className="block">
                <span className="text-xs text-text-muted">Kind</span>
                <select
                  value={editor.kind}
                  onChange={(event) =>
                    setEditor({ ...editor, kind: event.target.value as 'diff' | 'merge' })
                  }
                  className="input mt-1 w-full"
                  aria-label="Custom tool kind"
                  data-testid="external-tool-kind"
                >
                  <option value="diff">Diff</option>
                  <option value="merge">Merge</option>
                </select>
              </label>
            </div>
            <div>
              <span className="text-xs text-text-muted">Executable</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={editor.executablePath}
                  onChange={(event) => setEditor({ ...editor, executablePath: event.target.value })}
                  placeholder="/usr/local/bin/bcomp"
                  className="input flex-1 font-mono text-xs"
                  aria-label="Custom tool executable path"
                  data-testid="external-tool-executable"
                />
                <button type="button" className="btn btn-secondary" onClick={() => void browseExecutable()}>
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </button>
              </div>
              {editorValidation.executableError && (
                <span className="mt-1 block text-10.5 text-error">{editorValidation.executableError}</span>
              )}
            </div>
            <div>
              <span className="text-xs text-text-muted">
                Argument template — required: {describeRequiredPlaceholders(editor.kind)}
              </span>
              <input
                type="text"
                value={editor.argumentTemplate}
                onChange={(event) => setEditor({ ...editor, argumentTemplate: event.target.value })}
                placeholder={
                  editor.kind === 'diff' ? '{mine} {theirs}' : '{mine} {theirs} {base} {merged}'
                }
                className="input mt-1 w-full font-mono text-xs"
                aria-label="Custom tool argument template"
                data-testid="external-tool-template"
              />
              {editorValidation.errors.length > 0 && (
                <p className="mt-1 text-10.5 text-error" role="alert">
                  {editorValidation.errors.join(' ')}
                </p>
              )}
              {editorValidation.warnings.length > 0 && (
                <p className="mt-1 text-10.5 text-warning">{editorValidation.warnings.join(' ')}</p>
              )}
              {editor.argumentTemplate.trim() && (
                <p
                  className="mt-1 truncate font-mono text-10 text-text-faint"
                  data-testid="external-tool-preview"
                >
                  {expandArgumentTemplate(editor.argumentTemplate, SAMPLE_VALUES).join(' ')}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setEditor(null);
                  setEditingId(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={commitEditor}
                disabled={!editorValidation.valid}
                data-testid="external-tool-save"
              >
                Save Tool
              </button>
            </div>
          </div>
        )}

        {!editor && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={startAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Custom Tool
          </button>
        )}
      </div>
    </SettingsGroup>
  );
}
