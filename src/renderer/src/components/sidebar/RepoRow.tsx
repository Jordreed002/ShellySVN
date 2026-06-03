import { type MouseEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { FolderGit2, MoreHorizontal, Star } from 'lucide-react';

import { m, variants } from '../../lib/motion';
import { describeRepo, useRepoStatus } from './sidebarData';

interface RepoRowProps {
  repo: string;
  isActive: boolean;
  isPinned: boolean;
  isMenuOpen: boolean;
  onOpen: (repo: string) => void;
  onMenu: (event: MouseEvent, repo: string) => void;
}

/** A single repository row with a live status badge and pin indicator. */
export function RepoRow({ repo, isActive, isPinned, isMenuOpen, onOpen, onMenu }: RepoRowProps) {
  const { name, parent } = describeRepo(repo);
  const { data: status } = useRepoStatus(repo);
  const conflicts = status?.conflicts ?? 0;
  const changes = status?.changes ?? 0;

  return (
    <m.div className="group relative" variants={variants.listItem}>
      <Link
        to="/files"
        search={{ path: repo }}
        onClick={() => onOpen(repo)}
        onContextMenu={(e) => onMenu(e, repo)}
        className={`relative flex items-center gap-2.5 rounded-lg pl-2.5 pr-9 py-2 cursor-pointer transition-fast ${
          isActive || isMenuOpen
            ? 'tree-item-active'
            : 'text-text-secondary hover:bg-bg-elevated hover:text-text'
        }`}
      >
        <FolderGit2
          className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-tight">{name}</span>
          {parent && (
            <span className="block truncate text-2xs text-text-muted leading-tight">{parent}</span>
          )}
        </span>

        {/* Right slot: status badge / pin indicator (hidden while hovering to reveal actions) */}
        <span className="flex items-center gap-1.5 flex-shrink-0 group-hover:opacity-0 transition-opacity">
          {changes > 0 && (
            <span
              className={`flex items-center gap-1 text-2xs font-semibold tabular-nums ${
                conflicts > 0 ? 'text-svn-conflict' : 'text-svn-modified'
              }`}
              title={
                conflicts > 0
                  ? `${changes} change${changes === 1 ? '' : 's'}, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
                  : `${changes} pending change${changes === 1 ? '' : 's'}`
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  conflicts > 0 ? 'bg-svn-conflict' : 'bg-svn-modified'
                }`}
              />
              {changes}
            </span>
          )}
          {isPinned && <Star className="w-3.5 h-3.5 text-accent fill-current" />}
        </span>
      </Link>

      <button
        type="button"
        onClick={(e) => onMenu(e, repo)}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 btn-icon-sm transition-opacity ${
          isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
        aria-label={`Actions for ${name}`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </m.div>
  );
}
