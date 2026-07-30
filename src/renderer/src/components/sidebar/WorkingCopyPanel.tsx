/**
 * Rail pieces that describe the state of the checkouts on this machine:
 * the actions strip under the active working copy, and the disk card
 * (`.diskcard` in `prototypes/12-browser.html`).
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { FolderOpen, History } from 'lucide-react';

import { m, springs } from '../../lib/motion';
import {
  formatDiskSize,
  type DiskUsage,
  type RepoStatusCounts,
  type WorkingCopyInfo,
} from './sidebarData';

interface WorkingCopyPanelProps {
  repoPath: string;
  info?: WorkingCopyInfo;
  status?: RepoStatusCounts;
}

/**
 * Sits directly beneath the active working-copy row: its Files / History
 * navigation, its change summary, and a marker when the underlying `svn info`
 * read came from the offline cache rather than the working copy.
 */
export function WorkingCopyPanel({ repoPath, info, status }: WorkingCopyPanelProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const changes = status?.changes ?? 0;
  const conflicts = status?.conflicts ?? 0;
  const filesActive = pathname.startsWith('/files');
  const historyActive = pathname.startsWith('/history');
  const tabBase =
    'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium transition-fast';

  return (
    <m.div
      className="mx-1.5 mb-1 flex items-center gap-1 rounded-lg border border-accent/20 bg-accent/5 px-1.5 py-1"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
    >
      <Link
        to="/files"
        search={{ path: repoPath }}
        className={`${tabBase} ${
          filesActive
            ? 'bg-accent/15 text-accent'
            : 'text-text-secondary hover:bg-bg-elevated hover:text-text'
        }`}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Files
      </Link>
      <Link
        to="/history"
        search={{ path: repoPath }}
        className={`${tabBase} ${
          historyActive
            ? 'bg-accent/15 text-accent'
            : 'text-text-secondary hover:bg-bg-elevated hover:text-text'
        }`}
      >
        <History className="h-3.5 w-3.5" />
        History
      </Link>

      <span className="ml-auto flex items-center gap-1.5 pr-1">
        {info?.source === 'cache' && (
          <span
            className="text-2xs font-medium text-warning"
            title={`Cached working-copy information (${Math.floor(info.cacheAge / 60_000)} minutes old)`}
          >
            cached
          </span>
        )}
        {changes === 0 && status && (
          <span className="text-2xs font-medium text-svn-normal">No local changes</span>
        )}
        {conflicts > 0 && (
          <span className="text-2xs font-medium text-svn-conflict">
            {conflicts} conflict{conflicts === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </m.div>
  );
}

/**
 * Total bytes checked out, a bar segmented by working copy and tinted by local
 * presence, and a mono breakdown.
 *
 * Every figure here is measured (`fs.getFolderSizes`). The prototype's third
 * "not fetched" segment is deliberately absent: it needs the repository's
 * server-side size, which no API reports, and this card will not guess.
 */
export function DiskCard({ usage }: { usage: DiskUsage }) {
  const breakdown = [
    usage.fullBytes > 0 ? `full ${formatDiskSize(usage.fullBytes)}` : null,
    usage.sparseBytes > 0 ? `sparse ${formatDiskSize(usage.sparseBytes)}` : null,
    usage.notCheckedOut > 0 ? `${usage.notCheckedOut} not checked out` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="mx-3.5 mt-2 rounded-[10px] border border-border bg-bg-secondary p-2.5 shadow-card">
      <b className="block text-xs font-bold text-text">
        {formatDiskSize(usage.totalBytes)} checked out
      </b>
      <div aria-hidden="true" className="mt-2 flex h-[5px] overflow-hidden rounded-full bg-bg-sunk">
        {usage.segments.map((segment) => (
          <span
            key={segment.path}
            style={{ width: `${(segment.bytes / usage.totalBytes) * 100}%` }}
            className={segment.presence === 'sparse' ? 'bg-svn-added/45' : 'bg-svn-added'}
          />
        ))}
      </div>
      <span className="mt-1.5 block font-mono text-2xs leading-relaxed text-text-muted">
        {breakdown}
      </span>
    </div>
  );
}
