import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@renderer/components/ui/Popover';
import { useQuery } from '@tanstack/react-query';
import { EllipsisVertical, ExternalLink, FolderOpen, Monitor, SquareTerminal } from 'lucide-react';
import type { CodeEditorInfo, ExternalToolSummary } from '@shared/types';
import { useCodeEditors } from '@renderer/hooks/useCodeEditors';
import {
  buildQuickActions,
  runQuickAction,
  type QuickActionItem,
  type QuickActionKind,
} from '@renderer/lib/quickActions';
import { pushNotification } from '@renderer/lib/notificationCenterStore';

const KIND_ICON: Record<QuickActionKind, typeof ExternalLink> = {
  reveal: ExternalLink,
  'open-folder': FolderOpen,
  editor: Monitor,
  tool: Monitor,
  terminal: SquareTerminal,
};

/** The registered-tool query behind the quick actions (#86). */
export function useExternalToolsRegistry(): readonly ExternalToolSummary[] {
  const { data } = useQuery({
    queryKey: ['externalTools:list'],
    queryFn: () => window.api.externalTools.list(),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? [];
}

function useQuickActions(workingCopyPath: string | undefined): QuickActionItem[] {
  const editors: readonly CodeEditorInfo[] = useCodeEditors();
  const tools = useExternalToolsRegistry();
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
  return useMemo(
    () => buildQuickActions({ workingCopyPath, editors, tools, isMac }),
    [workingCopyPath, editors, tools, isMac]
  );
}

function runAction(action: QuickActionItem, workingCopyPath: string | undefined): void {
  runQuickAction(action, workingCopyPath, {
    reveal: (path) => {
      void window.api.external.revealPath(path).then((result) => {
        if (!result.success)
          pushNotification({
            severity: 'warning',
            title: 'Could not reveal the working copy',
            body: result.error,
            source: 'shell',
            workingCopyPath: path,
          });
      });
    },
    openFolder: (path) => {
      void window.api.external.openFolder(path).then((result) => {
        if (!result.success)
          pushNotification({
            severity: 'warning',
            title: 'Could not open the folder',
            body: result.error,
            source: 'shell',
            workingCopyPath: path,
          });
      });
    },
    openInEditor: (editorId, path) => {
      void window.api.external.openInEditor(editorId, path).then((result) => {
        if (!result.success)
          pushNotification({
            severity: 'warning',
            title: 'Could not open the working copy in the editor',
            body: result.error,
            source: 'shell',
            workingCopyPath: path,
          });
      });
    },
  });
}

function QuickActionRow({
  action,
  workingCopyPath,
  onRun,
}: {
  action: QuickActionItem;
  workingCopyPath: string | undefined;
  onRun: () => void;
}) {
  const Icon = KIND_ICON[action.kind];
  return (
    <button
      type="button"
      role="menuitem"
      disabled={!action.available}
      title={action.reason}
      aria-disabled={!action.available || undefined}
      onClick={() => {
        runAction(action, workingCopyPath);
        onRun();
      }}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-12.5 transition-fast enabled:text-text enabled:hover:bg-bg-tertiary disabled:text-text-faint disabled:cursor-not-allowed"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{action.label}</span>
      {!action.available && action.reason && (
        <span className="text-10 text-text-faint truncate max-w-[130px]" title={action.reason}>
          {action.reason}
        </span>
      )}
    </button>
  );
}

function QuickActionList({
  actions,
  workingCopyPath,
  onRun,
}: {
  actions: QuickActionItem[];
  workingCopyPath: string | undefined;
  onRun: () => void;
}) {
  return (
    <>
      {actions.map((action) => (
        <QuickActionRow key={action.id} action={action} workingCopyPath={workingCopyPath} onRun={onRun} />
      ))}
    </>
  );
}

/**
 * Closes on Escape, or on a pointer press outside every passed container.
 * A popover panel is portaled to `body`, so it is not inside the trigger's
 * container — it has to be named here or its own rows would dismiss the menu
 * on mousedown, before their click could land.
 */
function useDismiss(onClose: () => void, ...containers: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside = containers.some((ref) => ref.current?.contains(target));
      if (!inside) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, ...containers]);
}

interface QuickActionsMenuButtonProps {
  workingCopyPath?: string;
}

/**
 * Toolbar kebab (#86): the quick-actions menu for the active working copy —
 * open in Finder/Explorer, open folder, open in any registered editor. Rows
 * only appear for what is actually registered; absent capabilities show
 * disabled with their reason.
 */
export function QuickActionsMenuButton({ workingCopyPath }: QuickActionsMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /* The portaled panel — counted as "inside" for dismissal. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actions = useQuickActions(workingCopyPath);
  useDismiss(() => setOpen(false), containerRef, panelRef);

  return (
    <div ref={containerRef} className="relative titlebar-no-drag">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="Quick actions for this working copy"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Quick actions — open in Finder, Terminal, editors"
        className={`w-8 h-8 grid place-items-center rounded-lg border transition-fast ${
          open
            ? 'bg-accent/10 border-accent/40 text-accent'
            : 'bg-transparent border-transparent text-text-secondary hover:bg-bg-tertiary hover:border-border hover:text-text'
        }`}
      >
        <EllipsisVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          panelRef={panelRef}
          onClose={() => setOpen(false)}
          align="end"
          role="menu"
          ariaLabel="Quick actions"
          className="w-64 py-1 rounded-lg border border-border bg-bg-elevated shadow-card"
        >
          <QuickActionList actions={actions} workingCopyPath={workingCopyPath} onRun={() => setOpen(false)} />
        </Popover>
      )}
    </div>
  );
}

interface QuickActionsContextMenuProps {
  position: { x: number; y: number };
  workingCopyPath?: string;
  onClose: () => void;
}

/**
 * The same menu, anchored at a pointer position — what the repository pill's
 * right-click opens (#86, per-WC context).
 */
export function QuickActionsContextMenu({ position, workingCopyPath, onClose }: QuickActionsContextMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actions = useQuickActions(workingCopyPath);
  useDismiss(onClose, containerRef);

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Quick actions for this working copy"
      style={{ position: 'fixed', left: position.x, top: position.y }}
      className="z-50 w-64 py-1 rounded-lg border border-border bg-bg-elevated shadow-card"
    >
      <QuickActionList actions={actions} workingCopyPath={workingCopyPath} onRun={onClose} />
    </div>
  );
}
