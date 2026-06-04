import { type MouseEvent } from 'react';
import { GitBranch, Tag } from 'lucide-react';

import { m, springs } from '../../lib/motion';
import { describeRepo, useRepoStatus, useWorkingCopyInfo } from './sidebarData';

interface WorkingCopyPanelProps {
  repoPath: string;
  onContextMenu?: (event: MouseEvent) => void;
}

/**
 * The active repository expands into this working-copy lozenge: name, branch/URL,
 * revision, and pending-change summary. Falls back to a compact label until
 * `svn info` resolves (so it still reads as the selected repo immediately).
 */
export function WorkingCopyPanel({ repoPath, onContextMenu }: WorkingCopyPanelProps) {
  const { data: info } = useWorkingCopyInfo(repoPath);
  const { data: status } = useRepoStatus(repoPath);

  const { name, parent } = describeRepo(repoPath);
  const changes = status?.changes ?? 0;
  const conflicts = status?.conflicts ?? 0;
  const BranchIcon = info?.branchKind === 'tag' ? Tag : GitBranch;

  // Until svn info resolves, show a minimal selected-repo card (no branch/rev yet).
  if (!info) {
    return (
      <m.div
        className="my-0.5 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.smooth}
        onContextMenu={onContextMenu}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-semibold text-text">{name}</span>
        </div>
        {parent && <span className="block truncate text-2xs text-text-muted mt-0.5">{parent}</span>}
      </m.div>
    );
  }

  return (
    <m.div
      className="my-0.5 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-sm font-semibold text-text">{name}</span>
        <span className="ml-auto flex-shrink-0 font-mono text-2xs text-text-muted">
          r{info.revision}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 min-w-0">
        <span className="flex items-center gap-1 min-w-0 px-1.5 py-0.5 rounded-md bg-bg-elevated text-2xs text-text-secondary">
          <BranchIcon className="w-3 h-3 flex-shrink-0 text-accent" />
          <span className="truncate">{info.branch}</span>
        </span>
        {changes > 0 ? (
          <span
            className={`flex items-center gap-1 text-2xs font-medium ${
              conflicts > 0 ? 'text-svn-conflict' : 'text-svn-modified'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                conflicts > 0 ? 'bg-svn-conflict' : 'bg-svn-modified'
              }`}
            />
            {changes} change{changes === 1 ? '' : 's'}
            {conflicts > 0 ? ` · ${conflicts} conflict${conflicts === 1 ? '' : 's'}` : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-2xs font-medium text-svn-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-svn-normal" />
            No local changes
          </span>
        )}
      </div>
    </m.div>
  );
}
