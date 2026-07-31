import { useCallback } from 'react';

import { ProblemsSection, ShelvesSection } from './LocalFacts';
import {
  buildDiskUsage,
  collectProblems,
  useWorkingCopyShelves,
  useWorkingCopySizes,
} from './sidebarInsights';
import { describeRepo, type SidebarPresence, type WorkingCopySummary } from './workingCopyOverview';
import { DiskCard } from './WorkingCopyPanel';

interface SidebarInsightsProps {
  recentRepos: string[];
  overview: ReadonlyMap<string, WorkingCopySummary>;
  searchQuery: string;
  activeRepo?: string;
  showFolderSizes: boolean;
  onOpenShelves: (workingCopyPath: string) => void;
}

/** Expensive, non-navigational facts loaded only after the expanded rail is idle. */
export function SidebarInsights({
  recentRepos,
  overview,
  searchQuery,
  activeRepo,
  showFolderSizes,
  onOpenShelves,
}: SidebarInsightsProps) {
  const matchesSearch = useCallback(
    (value: string) => !searchQuery || value.toLowerCase().includes(searchQuery.toLowerCase()),
    [searchQuery]
  );
  const presenceOf = (repo: string): SidebarPresence => overview.get(repo)?.presence ?? 'unknown';
  const presenceByPath = new Map<string, SidebarPresence>(
    recentRepos.map((repo) => [repo, presenceOf(repo)])
  );
  const onDiskRepos = recentRepos.filter((repo) => {
    const presence = presenceOf(repo);
    return presence === 'full' || presence === 'sparse';
  });
  const { data: workingCopySizes } = useWorkingCopySizes(onDiskRepos, showFolderSizes);
  const diskUsage = buildDiskUsage(workingCopySizes, presenceByPath);
  const problems = collectProblems(recentRepos.filter(matchesSearch), overview);
  const shelvesOf = useWorkingCopyShelves(onDiskRepos, true);
  const shelves = shelvesOf.shelves.filter(
    (shelf) => matchesSearch(shelf.name) || matchesSearch(shelf.workingCopyName)
  );
  const attributeWorkingCopy = onDiskRepos.length > 1;
  const shelveTargetPath =
    activeRepo && onDiskRepos.includes(activeRepo)
      ? activeRepo
      : onDiskRepos.length === 1
        ? onDiskRepos[0]
        : undefined;
  const shelveTarget = shelveTargetPath
    ? {
        path: shelveTargetPath,
        name: describeRepo(shelveTargetPath).name,
        hasChanges: (overview.get(shelveTargetPath)?.status?.changes ?? 0) > 0,
      }
    : undefined;
  const shelvesEmptyNote =
    shelveTarget && shelves.length === 0 && shelvesOf.measured.includes(shelveTarget.path)
      ? `No shelves in ${shelveTarget.name}`
      : undefined;

  return (
    <>
      {diskUsage && <DiskCard usage={diskUsage} />}
      <ProblemsSection problems={problems} attributeWorkingCopy={attributeWorkingCopy} />
      <ShelvesSection
        shelves={shelves}
        unsupported={shelvesOf.unsupported}
        attributeWorkingCopy={attributeWorkingCopy}
        onOpenShelves={onOpenShelves}
        shelveTarget={shelveTarget}
        emptyNote={shelvesEmptyNote}
      />
    </>
  );
}
