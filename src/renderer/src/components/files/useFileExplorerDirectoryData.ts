import { useQuery } from '@tanstack/react-query';

export const FILE_CACHE_TIME = 5 * 60 * 1000;
export const STATUS_STALE_TIME = 30 * 1000;

const DEEP_STATUS_STALE_TIME = 2 * 60 * 1000;

export function useFileExplorerDirectoryData(path: string) {
  const {
    data: rawFiles,
    isLoading: isLoadingFiles,
    error,
    refetch,
  } = useQuery({
    queryKey: ['fs:listDirectory', path],
    queryFn: () => window.api.fs.listDirectory(path),
    enabled: !!path,
    staleTime: FILE_CACHE_TIME,
    gcTime: FILE_CACHE_TIME,
  });

  const { data: directoryMetadata, isFetching: isLoadingStatus } = useQuery({
    queryKey: ['fs:getDirectoryMetadata', path, Boolean(rawFiles?.length)],
    queryFn: () => window.api.fs.getDirectoryMetadata(path, Boolean(rawFiles?.length)),
    enabled: !!path && path !== 'DRIVES://' && !!rawFiles,
    staleTime: STATUS_STALE_TIME,
    retry: false,
  });

  const { data: deepStatusData, isFetching: isLoadingDeep } = useQuery({
    queryKey: ['fs:getDeepStatus', path],
    queryFn: () => window.api.fs.getDeepStatus(path),
    enabled:
      !!path && path !== 'DRIVES://' && directoryMetadata?.isVersioned === true && !!rawFiles,
    staleTime: DEEP_STATUS_STALE_TIME,
    refetchOnWindowFocus: false,
  });

  const isVersioned = path === 'DRIVES://' ? false : directoryMetadata?.isVersioned;
  const parentPath = path === 'DRIVES://' ? null : directoryMetadata?.parentPath;
  const statusData = directoryMetadata?.statusData;
  const svnInfo = directoryMetadata?.svnInfo;
  const workingCopyUpgradeStatus = directoryMetadata?.workingCopyUpgradeStatus;
  const workingCopyContext = directoryMetadata?.workingCopyContext;
  const effectiveRepoRoot = svnInfo?.repositoryRoot || workingCopyContext?.repositoryRoot;
  const effectiveUrl = svnInfo?.url || workingCopyContext?.url;

  return {
    deepStatusData,
    directoryMetadata,
    effectiveRepoRoot,
    effectiveUrl,
    error,
    isLoadingDeep,
    isLoadingFiles,
    isLoadingStatus,
    isVersioned,
    parentPath,
    rawFiles,
    refetch,
    statusData,
    svnInfo,
    workingCopyContext,
    workingCopyUpgradeStatus,
  };
}
