/**
 * Quick actions (#86) — "Open in …" for the active working copy.
 *
 * The menu is built only from what is actually registered/detected:
 *
 *  - Reveal/open the folder: the `external.revealPath` / `external.openFolder`
 *    IPC every install has (labels itself Finder or Explorer by platform).
 *  - Editors: `external.listEditors()` (the PATH scan + the user's own
 *    Settings entries) launched through `external.openInEditor`.
 *  - The `externalTools` registry's `editor`-role tools are consumed as
 *    labels too: one already launched by name merges with its editor action;
 *    one with no launcher renders disabled with the reason, never inventing a
 *    command the registry does not provide.
 *  - Terminal: no terminal role or tool exists anywhere in the IPC surface,
 *    so it is offered as a graceful-absent row (disabled, reason shown)
 *    rather than faked.
 */

import type { CodeEditorInfo, ExternalToolSummary } from '@shared/types';

export type QuickActionKind = 'reveal' | 'open-folder' | 'editor' | 'tool' | 'terminal';

export interface QuickActionItem {
  id: string;
  kind: QuickActionKind;
  label: string;
  /** Shown when `available` is false — why the row is disabled. */
  reason?: string;
  available: boolean;
  /** Editor/tool id for launcher-backed rows. */
  launcherId?: string;
}

export interface QuickActionRunner {
  reveal: (path: string) => void;
  openFolder: (path: string) => void;
  openInEditor: (editorId: string, path: string) => void;
}

export interface QuickActionInput {
  workingCopyPath?: string;
  editors: readonly CodeEditorInfo[];
  tools: readonly ExternalToolSummary[];
  isMac?: boolean;
}

/** Folder-capable editors only — the menu opens directories. */
function folderEditors(editors: readonly CodeEditorInfo[]): CodeEditorInfo[] {
  return editors.filter((editor) => (editor.appliesTo ?? 'both') !== 'files');
}

export function buildQuickActions({
  workingCopyPath,
  editors,
  tools,
  isMac = false,
}: QuickActionInput): QuickActionItem[] {
  const hasPath = !!workingCopyPath && workingCopyPath.trim() !== '';
  const pathReason = hasPath ? undefined : 'No working copy is open';

  const actions: QuickActionItem[] = [
    {
      id: 'reveal',
      kind: 'reveal',
      label: isMac ? 'Reveal in Finder' : 'Reveal in File Explorer',
      available: hasPath,
      reason: pathReason,
    },
    {
      id: 'open-folder',
      kind: 'open-folder',
      label: isMac ? 'Open folder' : 'Open folder window',
      available: hasPath,
      reason: pathReason,
    },
  ];

  for (const editor of folderEditors(editors)) {
    actions.push({
      id: `editor:${editor.id}`,
      kind: 'editor',
      label: `Open in ${editor.label}`,
      available: hasPath,
      reason: pathReason,
      launcherId: editor.id,
    });
  }

  const byName = new Map(folderEditors(editors).map((editor) => [editor.label.toLowerCase(), editor]));
  for (const tool of tools) {
    if (!tool.roles.includes('editor')) continue;
    // A registry tool whose name matches a detected editor is that editor.
    const launched = byName.get(tool.name.toLowerCase());
    if (launched) continue;
    actions.push({
      id: `tool:${tool.id}`,
      kind: 'tool',
      label: `Open in ${tool.name}`,
      available: hasPath && tool.available,
      reason: !hasPath
        ? pathReason
        : tool.available
          ? undefined
          : 'Registered but not found on this machine',
      launcherId: tool.available ? tool.id : undefined,
    });
  }

  // No terminal tool is registered anywhere in the IPC surface; say so
  // instead of inventing a launcher.
  actions.push({
    id: 'terminal',
    kind: 'terminal',
    label: 'Open in Terminal',
    available: false,
    reason: hasPath ? 'No terminal tool is registered' : pathReason,
  });

  return actions;
}

/** Run an action against the working copy it was built for. */
export function runQuickAction(
  action: QuickActionItem,
  workingCopyPath: string | undefined,
  runner: QuickActionRunner
): void {
  if (!action.available || !workingCopyPath) return;
  switch (action.kind) {
    case 'reveal':
      runner.reveal(workingCopyPath);
      return;
    case 'open-folder':
      runner.openFolder(workingCopyPath);
      return;
    case 'editor':
    case 'tool':
      if (action.launcherId) runner.openInEditor(action.launcherId, workingCopyPath);
      return;
    case 'terminal':
      return;
  }
}
