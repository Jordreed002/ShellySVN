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
    setTools(
      (await window.api.externalTools.list()).filter((tool) => tool.roles.includes('editor'))
    );
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
      <p className="settings-hint">
        Applications are registered through the system picker. Legacy command strings are disabled
        and must be registered again.
      </p>
      {error ? <p className="text-12 text-error" role="alert">{error}</p> : null}
      {tools.length ? (
        <ul className="settings-list">
          {tools.map((tool) => (
            <li
              key={tool.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div>
                <p className="text-13 font-medium text-text">{tool.name}</p>
                <p className="text-12 text-text-muted">Registered application · path hidden</p>
              </div>
              <button
                type="button"
                className="btn-icon-sm text-text-muted hover:bg-error/10 hover:text-error"
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
        <p className="settings-empty text-13 text-text-muted">No registered applications.</p>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => void register()}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Register application
      </button>
    </div>
  );
}
