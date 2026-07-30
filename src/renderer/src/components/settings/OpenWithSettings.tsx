/**
 * Applications for the "Open in" context menu.
 *
 * ShellySVN finds editors on `PATH` by itself, but that only covers launchers it
 * knows the name of. This is the escape hatch: name anything on the machine, give
 * the command, and it joins the same menu. Kept deliberately literal — the row
 * shows the exact command line that will run, because a launcher that silently
 * does nothing is the worst outcome here.
 */

import { useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { CustomOpenWithTool } from '@shared/types';

export interface OpenWithSettingsProps {
  tools: CustomOpenWithTool[];
  onChange: (tools: CustomOpenWithTool[]) => void;
}

const APPLIES_TO: Array<{ value: NonNullable<CustomOpenWithTool['appliesTo']>; label: string }> = [
  { value: 'both', label: 'Files and folders' },
  { value: 'files', label: 'Files only' },
  { value: 'folders', label: 'Folders only' },
];

/** What the menu will run, so nobody has to guess how `{path}` is treated. */
export function describeCommandLine(tool: CustomOpenWithTool): string {
  const command = tool.command.trim() || '<command>';
  const args = (tool.arguments ?? '').trim();
  if (!args) return `${command} <path>`;
  return args.includes('{path}') ? `${command} ${args}` : `${command} ${args} <path>`;
}

function createId(): string {
  return `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function OpenWithSettings({ tools, onChange }: OpenWithSettingsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<CustomOpenWithTool>) => {
    onChange(tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)));
  };

  const browseForCommand = async (id: string) => {
    setBusyId(id);
    try {
      const chosen = await window.api.dialog.openFile();
      if (chosen) update(id, { command: chosen });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {tools.length === 0 ? (
        <p className="py-2 text-sm text-text-muted">
          No applications added. Editors already on your <code className="font-mono">PATH</code> are
          offered automatically; add anything else here.
        </p>
      ) : (
        <ul className="space-y-3">
          {tools.map((tool) => (
            <li key={tool.id} className="rounded-lg border border-border bg-bg-tertiary/40 p-3">
              <div className="flex gap-2">
                <label className="sr-only" htmlFor={`open-with-name-${tool.id}`}>
                  Application name
                </label>
                <input
                  id={`open-with-name-${tool.id}`}
                  className="input flex-1"
                  value={tool.name}
                  placeholder="Name shown in the menu, e.g. Beyond Compare"
                  onChange={(event) => update(tool.id, { name: event.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label={`Remove ${tool.name || 'application'}`}
                  onClick={() => onChange(tools.filter((candidate) => candidate.id !== tool.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <label className="sr-only" htmlFor={`open-with-command-${tool.id}`}>
                  Command or application path
                </label>
                <input
                  id={`open-with-command-${tool.id}`}
                  className="input flex-1 font-mono text-xs"
                  value={tool.command}
                  placeholder="code, /usr/local/bin/subl, or /Applications/Nova.app"
                  onChange={(event) => update(tool.id, { command: event.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void browseForCommand(tool.id)}
                  disabled={busyId === tool.id}
                >
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <label className="sr-only" htmlFor={`open-with-args-${tool.id}`}>
                  Arguments
                </label>
                <input
                  id={`open-with-args-${tool.id}`}
                  className="input flex-1 font-mono text-xs"
                  value={tool.arguments ?? ''}
                  placeholder="Arguments (optional) — {path} marks where the path goes"
                  onChange={(event) => update(tool.id, { arguments: event.target.value })}
                />
                <label className="sr-only" htmlFor={`open-with-applies-${tool.id}`}>
                  Offer this application for
                </label>
                <select
                  id={`open-with-applies-${tool.id}`}
                  className="input w-44"
                  value={tool.appliesTo ?? 'both'}
                  onChange={(event) =>
                    update(tool.id, {
                      appliesTo: event.target.value as CustomOpenWithTool['appliesTo'],
                    })
                  }
                >
                  {APPLIES_TO.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mt-2 truncate font-mono text-[11px] text-text-faint">
                {describeCommandLine(tool)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          onChange([...tools, { id: createId(), name: '', command: '', appliesTo: 'both' }])
        }
      >
        <Plus className="h-4 w-4" />
        Add application
      </button>
    </div>
  );
}
