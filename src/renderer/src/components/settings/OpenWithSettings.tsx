import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CustomOpenWithTool, ExternalToolSummary } from '@shared/types';

export interface OpenWithSettingsProps {
  /** Legacy props are accepted during the beta.2 settings migration but ignored. */
  tools?: CustomOpenWithTool[];
  onChange?: (tools: CustomOpenWithTool[]) => void;
}

export function describeCommandLine(tool: CustomOpenWithTool): string {
  const command = tool.command.trim() || '<command>';
  const args = (tool.arguments ?? '').trim();
  if (!args) return `${command} <path>`;
  return args.includes('{path}') ? `${command} ${args}` : `${command} ${args} <path>`;
}

export function OpenWithSettings(_props: OpenWithSettingsProps) {
  const [tools, setTools] = useState<ExternalToolSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setTools((await window.api.externalTools.list()).filter((tool) => tool.roles.includes('editor')));
  }, []);

  useEffect(() => {
    void refresh().catch((reason) => setError((reason as Error).message));
  }, [refresh]);

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.externalTools.register('editor');
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await window.api.externalTools.remove(id);
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Applications are registered through the system picker. Legacy command strings are disabled
        and must be registered again.
      </p>
      {error ? <p className="text-sm text-error">{error}</p> : null}
      {tools.length ? (
        <ul className="space-y-2">
          {tools.map((tool) => (
            <li
              key={tool.id}
              className="flex items-center justify-between rounded-lg border border-border bg-bg-tertiary/40 p-3"
            >
              <div>
                <p className="text-sm font-medium text-text">{tool.name}</p>
                <p className="text-xs text-text-muted">Registered application · path hidden</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                aria-label={`Remove ${tool.name}`}
                disabled={busy}
                onClick={() => void remove(tool.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-text-muted">No registered applications.</p>
      )}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void register()}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Register application
      </button>
    </div>
  );
}
