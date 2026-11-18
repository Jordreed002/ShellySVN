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
      className="repository-switcher titlebar-no-drag flex h-7 min-w-0 flex-shrink items-center gap-1.5 rounded-md px-2 text-13 transition-fast hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      aria-label={pill.ariaLabel}
      aria-haspopup={onContextMenu ? 'menu' : undefined}
      aria-busy={busy || undefined}
      title={pill.title}
    >
      <Box className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 max-w-[180px] truncate font-medium text-text">{pill.label}</span>
      {pill.host && (
        <span className="hidden min-w-0 max-w-[180px] truncate font-mono text-11 text-text-muted xl:inline">
          {pill.host}
        </span>
      )}
      <ChevronDown className="h-3 w-3 flex-shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  );
}
