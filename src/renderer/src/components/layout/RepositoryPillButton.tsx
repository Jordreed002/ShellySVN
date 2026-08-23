import { Box, ChevronDown } from 'lucide-react';
import type { RepositoryPill } from './repositoryPill';

interface RepositoryPillButtonProps {
  pill: RepositoryPill;
  onActivate: () => void;
  busy?: boolean;
  /** Right-click hook (#86): opens the per-WC quick actions in the Layout. */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function RepositoryPillButton({
  pill,
  onActivate,
  busy = false,
  onContextMenu,
}: RepositoryPillButtonProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      onContextMenu={onContextMenu}
      className="titlebar-no-drag flex items-center gap-2 h-control px-[11px] flex-shrink-0 min-w-0 rounded-9 bg-bg border border-border hover:border-border-strong text-12.5 transition-fast"
      aria-label={pill.ariaLabel}
      aria-haspopup={onContextMenu ? 'menu' : undefined}
      aria-busy={busy || undefined}
      title={pill.title}
    >
      <Box className="w-3 h-3 flex-shrink-0 text-text-faint" aria-hidden="true" />
      <span className="font-semibold text-text truncate max-w-[150px]">{pill.label}</span>
      {pill.host && (
        <span className="font-mono text-11 text-text-muted truncate max-w-[190px]">
          {pill.host}
        </span>
      )}
      <ChevronDown className="w-3 h-3 flex-shrink-0 text-text-faint" aria-hidden="true" />
    </button>
  );
}
