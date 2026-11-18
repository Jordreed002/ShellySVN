/**
 * Rail pieces that describe the state of the checkouts on this machine:
 * the actions strip under the active working copy, and the disk card
 * (`.diskcard` in `prototypes/12-browser.html`).
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { AlertTriangle, Database, FileDiff, History } from 'lucide-react';

import { m, springs } from '../../lib/motion';
import { formatDiskSize, type DiskUsage } from './sidebarInsights';
import { type RepoStatusCounts, type WorkingCopyInfo } from './workingCopyOverview';

interface WorkingCopyPanelProps {
  repoPath: string;
  info?: WorkingCopyInfo;
  status?: RepoStatusCounts;
}

/**
 * The selected working copy's views, nested directly under its row — the one
 * place the journey (inspect Changes → review History → browse its Repository)
 * is offered. The row above already carries the name, branch · revision and
 * change count, so nothing here repeats them.
 */
export function WorkingCopyPanel({ repoPath, info, status }: WorkingCopyPanelProps) {
  const location = useRouterState({ select: (s) => s.location });
  const pathname = location.pathname;
  const localPath = (location.search as { localPath?: string })?.localPath;

  const problems = status?.problems.total ?? 0;
  const changesActive = pathname.startsWith('/files');
  const historyActive = pathname.startsWith('/history');
  const repositoryActive = pathname.startsWith('/repo-browser') && localPath === repoPath;

  const item = (active: boolean) =>
    `rail-row flex h-7 items-center gap-2 rounded-md pl-2 pr-2 text-13 transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
      active
        ? 'bg-bg-tertiary font-medium text-text'
        : 'text-text-secondary hover:bg-bg-tertiary/70 hover:text-text'
    }`;
  const icon = 'h-3.5 w-3.5 flex-shrink-0 text-text-muted';

  return (
    <m.ul
      className="working-copy-views mb-1 ml-[15px] space-y-px border-l border-border pl-1.5"
      aria-label="Working copy views"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
    >
      <li>
        <Link
          to="/files"
          search={{ path: repoPath }}
          className={item(changesActive)}
          aria-current={changesActive ? 'page' : undefined}
          title="Inspect, review and commit local changes — svn status"
        >
          <FileDiff className={icon} aria-hidden="true" />
          <span className="flex-1 truncate">Changes</span>
        </Link>
      </li>
      <li>
        <Link
          to="/history"
          search={{ path: repoPath }}
          className={item(historyActive)}
          aria-current={historyActive ? 'page' : undefined}
          title="Review committed revisions — svn log"
        >
          <History className={icon} aria-hidden="true" />
          <span className="flex-1 truncate">History</span>
        </Link>
      </li>
      {info?.url && (
        <li>
          <Link
            to="/repo-browser"
            search={{ url: info.url, localPath: repoPath }}
            className={item(repositoryActive)}
            aria-current={repositoryActive ? 'page' : undefined}
            title={`Browse ${info.url} on the server — svn list`}
          >
            <Database className={icon} aria-hidden="true" />
            <span className="flex-1 truncate">Repository</span>
            {info.source === 'cache' && (
              <span
                className="text-11 text-text-muted"
                title={`Cached working-copy information (${Math.floor(info.cacheAge / 60_000)} minutes old)`}
              >
                cached
              </span>
            )}
          </Link>
        </li>
      )}
      {problems > 0 && (
        <li>
          <Link
            to="/files"
            search={{ path: repoPath, dialog: 'problems' }}
            className={item(false)}
            title={status?.problems.summary}
          >
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
            <span className="flex-1 truncate">Problems</span>
            <span className="font-mono text-11 tabular-nums text-svn-conflict">{problems}</span>
          </Link>
        </li>
      )}
    </m.ul>
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
    <div className="mx-3.5 mt-2 rounded-md border border-border bg-bg p-2.5">
      <b className="block text-12 font-semibold text-text">
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
      <span className="mt-1.5 block font-mono text-11 leading-relaxed text-text-muted">
        {breakdown}
      </span>
    </div>
  );
}
