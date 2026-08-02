import { keepPreviousData, useQuery } from '@tanstack/react-query';

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
    // Approval errors require a native user gesture. Automatic retries only
    // repeat the same rejected IPC call and make the main-process log noisy.
    retry: false,
    // Keep the previous folder's listing visible while the next loads, so
    // navigating between folders doesn't flash an empty list.
    placeholderData: keepPreviousData,
  });

  const {
    data: directoryMetadata,
    error: metadataError,
    isFetching: isLoadingStatus,
    isPlaceholderData: isMetadataFromPreviousPath,
  } = useQuery({
    queryKey: ['fs:getDirectoryMetadata', path, Boolean(rawFiles?.length)],
    queryFn: () => window.api.fs.getDirectoryMetadata(path, Boolean(rawFiles?.length)),
    enabled: !!path && path !== 'DRIVES://' && !!rawFiles,
    staleTime: STATUS_STALE_TIME,
    retry: false,
    // Prevents isVersioned (and the version-control toolbar) from flickering
    // off/on while the new folder's metadata is fetched.
    placeholderData: keepPreviousData,
  });

  // While the placeholder is showing, `isVersioned` describes the folder the
  // user just left. Reads that only make sense inside a checkout have to wait
  // for this folder's own answer, or navigating into an unversioned folder
  // fires them against a path Subversion will reject with E155007.
  const isKnownVersioned = directoryMetadata?.isVersioned === true && !isMetadataFromPreviousPath;

  const { data: deepStatusData, isFetching: isLoadingDeep } = useQuery({
    queryKey: ['fs:getDeepStatus', path],
    queryFn: () => window.api.fs.getDeepStatus(path),
    enabled: !!path && path !== 'DRIVES://' && isKnownVersioned && !!rawFiles,
    staleTime: DEEP_STATUS_STALE_TIME,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  // Last-commit info per immediate child (offline) for the last-activity column.
  const { data: childCommits } = useQuery({
    queryKey: ['svn:childCommits', path],
    queryFn: () => window.api.svn.childCommits(path),
    enabled: !!path && path !== 'DRIVES://' && isKnownVersioned && !!rawFiles,
    staleTime: STATUS_STALE_TIME,
    retry: false,
    placeholderData: keepPreviousData,
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
    childCommits,
    deepStatusData,
    directoryMetadata,
    effectiveRepoRoot,
    effectiveUrl,
    error: error ?? metadataError,
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
