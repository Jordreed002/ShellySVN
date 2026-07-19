import { useRouterState } from '@tanstack/react-router';
import { GitBranch, FolderGit2, Tag } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { useWorkingCopyInfo } from '../sidebar/sidebarData';

/**
 * Bottom status bar — reflects the active working copy (repo, branch, revision)
 * and current location. Respects the showStatusBar setting.
 */
export function StatusBar() {
  const { settings } = useSettings();
  const routerState = useRouterState();

  const currentPath = (routerState.location.search as { path?: string })?.path || '';
  const recentRepos = settings?.recentRepositories || [];
  const activeRepo = recentRepos.find(
    (repo) => currentPath === repo || currentPath.startsWith(repo + '/')
  );
  const { data: info } = useWorkingCopyInfo(activeRepo);

  if (!settings?.showStatusBar) {
    return null;
  }

  const repoName = activeRepo ? activeRepo.split(/[/\\]/).pop() || activeRepo : null;
  const BranchIcon = info?.branchKind === 'tag' ? Tag : GitBranch;

  return (
    <footer
      className="status-bar"
      role="status"
      aria-live="polite"
      aria-label="Application status"
    >
      {/* Left — active working copy */}
      <div className="flex items-center gap-3 min-w-0">
        {repoName ? (
          <>
            <span className="flex items-center gap-1.5 text-text-secondary">
              <FolderGit2 className="w-3 h-3 text-accent" />
              {repoName}
            </span>
            {info && (
              <>
                <span className="flex items-center gap-1.5 text-text-muted">
                  <BranchIcon className="w-3 h-3" />
                  {info.branch}
                </span>
                <span className="text-text-muted font-mono">r{info.revision}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-text-muted">No working copy open</span>
        )}
      </div>

      {/* Right — current location */}
      <div className="flex items-center gap-3 min-w-0">
        {currentPath && (
          <span className="text-text-faint truncate max-w-[42vw]" title={currentPath}>
            {currentPath}
          </span>
        )}
      </div>
    </footer>
  );
}
