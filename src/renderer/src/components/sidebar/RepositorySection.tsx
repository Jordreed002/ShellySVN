import { useState, useCallback, useEffect, memo, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  Key,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { StatusDot } from '../ui/StatusIcon';

interface TreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface RepositorySectionProps {
  recentRepos: string[];
  currentPath: string;
  searchQuery: string;
  onAddRepository: () => void;
  onRemoveRepository: (repo: string) => Promise<void>;
  onManageCredentials: () => void;
}

function RepoTreeItem({
  path,
  depth = 0,
  currentPath,
}: {
  path: string;
  depth?: number;
  currentPath: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: entries, isLoading } = useQuery({
    queryKey: ['sidebar:tree', path],
    queryFn: async (): Promise<TreeEntry[]> => {
      const files = await window.api.fs.listDirectory(path);
      return files
        .filter((file) => file.isDirectory)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((file) => ({
          name: file.name,
          path: file.path,
          isDirectory: file.isDirectory,
        }));
    },
    enabled: isExpanded,
  });

  const isActive = currentPath === path;
  const name = path.split(/[/\\]/).pop() || path;

  return (
    <>
      <div
        className={`
          flex items-center gap-1 px-2 py-1 cursor-pointer transition-fast
          ${isActive ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}
        `}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="p-0.5 hover:bg-bg-elevated rounded transition-fast"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted" />
          )}
        </button>
        <Link
          to="/files"
          search={{ path }}
          className="flex items-center gap-1.5 min-w-0 flex-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Folder className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span
            className={`truncate text-xs ${isActive ? 'text-accent font-medium' : 'text-text-secondary'}`}
          >
            {name}
          </span>
        </Link>
      </div>

      {isExpanded && (
        <div className="border-l border-border ml-4">
          {isLoading ? (
            <div className="px-3 py-1">
              <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
            </div>
          ) : entries && entries.length > 0 ? (
            entries.map((entry) => (
              <RepoTreeItem
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                currentPath={currentPath}
              />
            ))
          ) : (
            <div className="px-3 py-1 text-xs text-text-muted">Empty</div>
          )}
        </div>
      )}
    </>
  );
}

export const RepositorySection = memo(function RepositorySection({
  recentRepos,
  currentPath,
  searchQuery,
  onAddRepository,
  onRemoveRepository,
  onManageCredentials,
}: RepositorySectionProps) {
  const navigate = useNavigate();
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: string } | null>(
    null
  );

  const toggleRepo = useCallback((path: string) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const filteredRepos = searchQuery
    ? recentRepos.filter((repo) => repo.toLowerCase().includes(searchQuery.toLowerCase()))
    : recentRepos;

  const handleContextMenu = useCallback((event: MouseEvent, repo: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, repo });
  }, []);

  const handleOpenInExplorer = useCallback(async (repo: string) => {
    await window.api.external.openFolder(repo);
    setContextMenu(null);
  }, []);

  const handleRemoveRepo = useCallback(
    async (repo: string) => {
      await onRemoveRepository(repo);
      setContextMenu(null);
    },
    [onRemoveRepository]
  );

  useEffect(() => {
    if (!contextMenu) return;

    const handleCloseContextMenu = () => setContextMenu(null);
    document.addEventListener('click', handleCloseContextMenu);

    return () => document.removeEventListener('click', handleCloseContextMenu);
  }, [contextMenu]);

  return (
    <>
      <div className="border-t border-border py-2">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">
            SVN Repositories
          </span>
          {recentRepos.length > 0 && (
            <button type="button" className="btn-icon-sm p-0.5">
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>

        {filteredRepos.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center mx-auto mb-2">
              <Folder className="w-5 h-5 text-text-muted" />
            </div>
            <p className="text-xs text-text-muted mb-2">No repositories yet</p>
            <button
              type="button"
              onClick={onAddRepository}
              className="text-xs text-accent hover:text-accent-hover"
            >
              Add your first repository
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredRepos.map((repo) => {
              const name = repo.split('/').pop() || repo;
              const isExpanded = expandedRepos.has(repo);
              const isActive = currentPath === repo || currentPath?.startsWith(repo + '/');
              const isContextMenuOpen = contextMenu?.repo === repo;

              return (
                <div key={repo}>
                  <div
                    role="treeitem"
                    aria-expanded={isExpanded}
                    tabIndex={0}
                    className={`
                      flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-fast group
                      ${isActive || isContextMenuOpen ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}
                    `}
                    onClick={() => toggleRepo(repo)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleRepo(repo);
                      }
                    }}
                    onContextMenu={(event) => handleContextMenu(event, repo)}
                  >
                    <button
                      type="button"
                      className="p-0.5 hover:bg-bg-elevated rounded transition-fast"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRepo(repo);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                      )}
                    </button>
                    <StatusDot status=" " />
                    <Link
                      to="/files"
                      search={{ path: repo }}
                      className="flex-1 flex items-center gap-2 min-w-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Folder className="w-4 h-4 text-accent flex-shrink-0" />
                      <span
                        className={`truncate text-sm ${isActive ? 'text-accent font-medium' : 'text-text-secondary'}`}
                      >
                        {name}
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="btn-icon-sm p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleContextMenu(event, repo);
                      }}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-l border-border ml-4">
                      <RepoTreeItem path={repo} depth={0} currentPath={currentPath} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          role="menu"
          aria-label="Repository actions"
          className="fixed z-50 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setContextMenu(null);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              navigate({ to: '/files', search: { path: contextMenu.repo } });
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <Folder className="w-4 h-4" />
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleOpenInExplorer(contextMenu.repo)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Explorer
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onManageCredentials();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <Key className="w-4 h-4" />
            Manage Credentials
          </button>
          <div className="border-t border-border my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={() => handleRemoveRepo(contextMenu.repo)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-error hover:bg-error/10 transition-fast"
          >
            <Trash2 className="w-4 h-4" />
            Remove
          </button>
        </div>
      )}
    </>
  );
});
