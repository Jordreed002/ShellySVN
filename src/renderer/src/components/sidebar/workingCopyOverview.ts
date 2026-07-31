/**
 * Lightweight working-copy facts consumed by the application shell.
 *
 * These exports intentionally form the stable shell-facing surface while the
 * legacy `sidebarData` facade remains available to existing direct tests.
 */
export {
  PRESENCE_LABEL,
  collectRepositoryRoots,
  deriveBranch,
  describeRepo,
  shortenPath,
  useWorkingCopyInfo,
  useWorkingCopyOverview,
  type RepoStatusCounts,
  type RepositoryRoot,
  type SidebarPresence,
  type WorkingCopyInfo,
  type WorkingCopySummary,
} from './sidebarData';
