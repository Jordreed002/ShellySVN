import { useMemo } from 'react';
import {
  collectRepositoryRoots,
  useWorkingCopyInfo,
  useWorkingCopyOverview,
} from '../sidebar/workingCopyOverview';
import { RepositoryPillButton } from './RepositoryPillButton';
import { describeRepositoryPill } from './repositoryPill';

export interface RepositoryPillControlProps {
  workingCopyPath?: string;
  browsedUrl?: string;
  recentRepositories: string[];
  onActivate: () => void;
  /** Right-click hook (#86): opens the per-WC quick actions in the Layout. */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function RepositoryPillControl({
  workingCopyPath,
  browsedUrl,
  recentRepositories,
  onActivate,
  onContextMenu,
}: RepositoryPillControlProps) {
  const { data: workingCopyInfo } = useWorkingCopyInfo(workingCopyPath);
  const overview = useWorkingCopyOverview(recentRepositories);
  const knownRoots = useMemo(
    () => collectRepositoryRoots(recentRepositories, overview),
    [recentRepositories, overview]
  );
  const pill = describeRepositoryPill({
    repositoryRoot: workingCopyInfo?.repositoryRoot,
    workingCopyPath,
    browsedUrl,
    knownRoots,
  });

  return <RepositoryPillButton pill={pill} onActivate={onActivate} onContextMenu={onContextMenu} />;
}
