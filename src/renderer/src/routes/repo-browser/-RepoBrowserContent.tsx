import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SvnListResult } from '@shared/types';
import {
  Folder,
  FileText,
  RefreshCw,
  ChevronRight,
  Search,
  Download,
  ExternalLink,
  History,
  Globe,
  ArrowLeft,
  ArrowRight,
  X,
  Loader2,
  Lock,
  Key,
  Check,
  PlusCircle,
  AlertCircle,
  Trash2,
  Edit3,
  Copy,
} from 'lucide-react';
import { CheckoutDialog } from '@renderer/components/ui/CheckoutDialog';
import { useWorkingCopyContext } from '@renderer/hooks/useWorkingCopyContext';
import { resolveRemoteUrlToLocalPath } from '@renderer/utils/pathResolution';
import {
  isRepoBrowserAuthError,
  loadRepoBrowserCredentials,
  type RepoBrowserCredentials,
} from './-repoBrowserAuth';
import {
  getRepoBrowserListQueryKey,
  REPO_BROWSER_LIST_STALE_TIME_MS,
} from './-repoBrowserCache';
import { normalizeRepoBrowserRevision } from './-repoBrowserRevision';

interface RepoNode {
  name: string;
  path: string;
  url: string;
  kind: 'file' | 'dir';
  size?: number;
  revision: number;
  author: string;
  date: string;
}

interface RepoBrowserRuntimeOverrides {
  auth?: {
    get(realm: string): Promise<RepoBrowserCredentials | null>;
  };
  svnList?: (
    url: string,
    revision?: string,
    depth?: 'empty' | 'immediates' | 'infinity',
    credentials?: RepoBrowserCredentials
  ) => Promise<SvnListResult>;
}

function getRepoBrowserRuntime() {
  const overrides = (window as typeof window & { __repoBrowserE2e?: RepoBrowserRuntimeOverrides })
    .__repoBrowserE2e;

  return {
    auth: overrides?.auth ?? window.api.auth,
    svnList: overrides?.svnList ?? window.api.svn.list,
  };
}

// Module-level constant for default props to avoid new instances on every render
const EMPTY_PROPS: RepoBrowserContentProps = {};

interface RepoBrowserContentProps {
  /** Optional local path to detect working copy context */
  localPath?: string;
}

export function RepoBrowserContent({ localPath }: RepoBrowserContentProps = EMPTY_PROPS) {
  const search = useSearch({ from: '/repo-browser/' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState(search.url || '');
  const [revision, setRevision] = useState('HEAD');
  const [currentPath, setCurrentPath] = useState('/');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderMessage, setNewFolderMessage] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RepoNode | null>(null);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [isDeletingRemote, setIsDeletingRemote] = useState(false);
  const [deleteRemoteError, setDeleteRemoteError] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<RepoNode | null>(null);
  const [moveDestinationUrl, setMoveDestinationUrl] = useState('');
  const [moveMessage, setMoveMessage] = useState('');
  const [isMovingRemote, setIsMovingRemote] = useState(false);
  const [moveRemoteError, setMoveRemoteError] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<RepoNode | null>(null);
  const [copyDestinationUrl, setCopyDestinationUrl] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [isCopyingRemote, setIsCopyingRemote] = useState(false);
  const [copyRemoteError, setCopyRemoteError] = useState<string | null>(null);

  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [authRealm, setAuthRealm] = useState<string>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [credentials, setCredentials] = useState<RepoBrowserCredentials | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Add to Working Copy state
  const [isAddingToWc, setIsAddingToWc] = useState(false);
  const [addWcError, setAddWcError] = useState<string | null>(null);
  const [addWcSuccess, setAddWcSuccess] = useState(false);

  const { data: workingCopyContext } = useWorkingCopyContext(localPath);

  // Auto-fill saved credentials when auth prompt appears
  useEffect(() => {
    if (showAuthPrompt && authRealm) {
      getRepoBrowserRuntime()
        .auth
        .get(authRealm)
        .then((savedCreds) => {
          if (savedCreds) {
            setUsername(savedCreds.username);
            setPassword(savedCreds.password);
          }
        })
        .catch(() => {
          // Ignore errors - user can type manually
        });
    }
  }, [showAuthPrompt, authRealm]);

  const isValidUrl =
    repoUrl &&
    (repoUrl.startsWith('http://') ||
      repoUrl.startsWith('https://') ||
      repoUrl.startsWith('svn://') ||
      repoUrl.startsWith('svn+ssh://'));

  const currentUrl = useMemo(() => {
    if (!repoUrl) return '';
    if (currentPath === '/') return repoUrl;
    return `${repoUrl.replace(/\/$/, '')}${currentPath}`;
  }, [repoUrl, currentPath]);

  const selectedRevision = useMemo(() => normalizeRepoBrowserRevision(revision), [revision]);
  const listQueryKey = useMemo(
    () => getRepoBrowserListQueryKey(currentUrl, selectedRevision, credentials),
    [currentUrl, selectedRevision, credentials]
  );

  const {
    data: directoryData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const result = await getRepoBrowserRuntime().svnList(
        currentUrl,
        selectedRevision,
        'immediates',
        credentials || undefined
      );
      return result;
    },
    enabled: isConnected && Boolean(isValidUrl) && !showAuthPrompt,
    staleTime: REPO_BROWSER_LIST_STALE_TIME_MS,
    retry: false,
  });

  const entries = useMemo(() => {
    if (!directoryData?.entries) return [];

    let items = directoryData.entries.map((entry) => ({
      name: entry.name,
      path: currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`,
      url: entry.url,
      kind: entry.kind,
      size: entry.size,
      revision: entry.revision,
      author: entry.author,
      date: entry.date,
    }));

    if (searchQuery) {
      items = items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    return items.toSorted((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [directoryData, currentPath, searchQuery]);

  const isInWorkingCopy = useCallback(
    (entry: RepoNode): boolean => {
      if (!workingCopyContext || !repoUrl) return false;

      const normalizedEntryPath = entry.path.replace(/^\/+/, '');
      const normalizedWcPath = workingCopyContext.relativePath.replace(/^\/+/, '');

      const normalizedRepoRoot = workingCopyContext.repositoryRoot.replace(/\/$/, '');
      const normalizedBrowserRoot = repoUrl.replace(/\/$/, '');

      if (normalizedRepoRoot !== normalizedBrowserRoot) return false;

      if (normalizedWcPath) {
        return (
          normalizedEntryPath === normalizedWcPath ||
          normalizedEntryPath.startsWith(normalizedWcPath + '/')
        );
      }

      return true;
    },
    [workingCopyContext, repoUrl]
  );

  const navigateToPath = useCallback(
    (path: string) => {
      setCurrentPath(path);
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), path]);
      setHistoryIndex((prev) => prev + 1);
      setSelectedNode(null);
    },
    [historyIndex]
  );

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      setCurrentPath(history[historyIndex - 1]);
    }
  }, [historyIndex, history]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setCurrentPath(history[historyIndex + 1]);
    }
  }, [historyIndex, history]);

  const goUp = useCallback(() => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigateToPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
  }, [currentPath, navigateToPath]);

  const handleBrowse = useCallback(
    (node: RepoNode) => {
      if (node.kind === 'dir') {
        navigateToPath(node.path);
      }
    },
    [navigateToPath]
  );

  const prefetchDirectory = useCallback(
    (node: RepoNode) => {
      if (node.kind !== 'dir') return;

      queryClient.prefetchQuery({
        queryKey: getRepoBrowserListQueryKey(node.url, selectedRevision, credentials),
        queryFn: () =>
          getRepoBrowserRuntime().svnList(
            node.url,
            selectedRevision,
            'immediates',
            credentials || undefined
          ),
        staleTime: REPO_BROWSER_LIST_STALE_TIME_MS,
      });
    },
    [credentials, queryClient, selectedRevision]
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleOpenCreateFolder = useCallback(() => {
    setNewFolderName('');
    setNewFolderMessage('');
    setCreateFolderError(null);
    setIsCreateFolderOpen(true);
  }, []);

  const handleCloseCreateFolder = useCallback(() => {
    if (isCreatingFolder) return;
    setIsCreateFolderOpen(false);
    setCreateFolderError(null);
  }, [isCreatingFolder]);

  const handleCreateRemoteFolder = useCallback(async () => {
    const trimmedName = newFolderName.trim();
    const trimmedMessage = newFolderMessage.trim();
    if (!trimmedName || !trimmedMessage) {
      setCreateFolderError('Folder name and commit message are required.');
      return;
    }

    setIsCreatingFolder(true);
    setCreateFolderError(null);

    try {
      const result = await window.api.svn.remoteCreateFolder(
        currentUrl,
        trimmedName,
        trimmedMessage,
        credentials || undefined
      );

      if (!result.success) {
        setCreateFolderError(result.error || 'Failed to create remote folder.');
        return;
      }

      setIsCreateFolderOpen(false);
      setNewFolderName('');
      setNewFolderMessage('');
      setSelectedNode(null);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      refetch();
    } catch (error) {
      setCreateFolderError((error as Error)?.message || 'Failed to create remote folder.');
    } finally {
      setIsCreatingFolder(false);
    }
  }, [
    credentials,
    currentUrl,
    listQueryKey,
    newFolderMessage,
    newFolderName,
    queryClient,
    refetch,
  ]);

  const handleOpenRemoteDelete = useCallback((entry: RepoNode) => {
    setDeleteTarget(entry);
    setDeleteMessage('');
    setDeleteRemoteError(null);
  }, []);

  const handleCloseRemoteDelete = useCallback(() => {
    if (isDeletingRemote) return;
    setDeleteTarget(null);
    setDeleteRemoteError(null);
  }, [isDeletingRemote]);

  const handleDeleteRemoteItem = useCallback(async () => {
    if (!deleteTarget) return;
    const trimmedMessage = deleteMessage.trim();
    if (!trimmedMessage) {
      setDeleteRemoteError('Commit message is required.');
      return;
    }

    setIsDeletingRemote(true);
    setDeleteRemoteError(null);

    try {
      const result = await window.api.svn.remoteDelete(
        deleteTarget.url,
        trimmedMessage,
        credentials || undefined
      );

      if (!result.success) {
        setDeleteRemoteError(result.error || 'Failed to delete remote item.');
        return;
      }

      setDeleteTarget(null);
      setDeleteMessage('');
      setSelectedNode(null);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      refetch();
    } catch (error) {
      setDeleteRemoteError((error as Error)?.message || 'Failed to delete remote item.');
    } finally {
      setIsDeletingRemote(false);
    }
  }, [credentials, deleteMessage, deleteTarget, listQueryKey, queryClient, refetch]);

  const handleOpenRemoteMove = useCallback((entry: RepoNode) => {
    setMoveTarget(entry);
    setMoveDestinationUrl(entry.url);
    setMoveMessage('');
    setMoveRemoteError(null);
  }, []);

  const handleCloseRemoteMove = useCallback(() => {
    if (isMovingRemote) return;
    setMoveTarget(null);
    setMoveRemoteError(null);
  }, [isMovingRemote]);

  const handleMoveRemoteItem = useCallback(async () => {
    if (!moveTarget) return;
    const trimmedDestination = moveDestinationUrl.trim();
    const trimmedMessage = moveMessage.trim();
    if (!trimmedDestination || !trimmedMessage) {
      setMoveRemoteError('Destination URL and commit message are required.');
      return;
    }

    setIsMovingRemote(true);
    setMoveRemoteError(null);

    try {
      const result = await window.api.svn.remoteMove(
        moveTarget.url,
        trimmedDestination,
        trimmedMessage,
        credentials || undefined
      );

      if (!result.success) {
        setMoveRemoteError(result.error || 'Failed to move remote item.');
        return;
      }

      setMoveTarget(null);
      setMoveDestinationUrl('');
      setMoveMessage('');
      setSelectedNode(null);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      refetch();
    } catch (error) {
      setMoveRemoteError((error as Error)?.message || 'Failed to move remote item.');
    } finally {
      setIsMovingRemote(false);
    }
  }, [
    credentials,
    listQueryKey,
    moveDestinationUrl,
    moveMessage,
    moveTarget,
    queryClient,
    refetch,
  ]);

  const handleOpenRemoteCopy = useCallback((entry: RepoNode) => {
    setCopyTarget(entry);
    setCopyDestinationUrl(`${entry.url}-copy`);
    setCopyMessage('');
    setCopyRemoteError(null);
  }, []);

  const handleCloseRemoteCopy = useCallback(() => {
    if (isCopyingRemote) return;
    setCopyTarget(null);
    setCopyRemoteError(null);
  }, [isCopyingRemote]);

  const handleCopyRemoteItem = useCallback(async () => {
    if (!copyTarget) return;
    const trimmedDestination = copyDestinationUrl.trim();
    const trimmedMessage = copyMessage.trim();
    if (!trimmedDestination || !trimmedMessage) {
      setCopyRemoteError('Destination URL and commit message are required.');
      return;
    }

    setIsCopyingRemote(true);
    setCopyRemoteError(null);

    try {
      const result = await window.api.svn.copy(copyTarget.url, trimmedDestination, trimmedMessage);

      if (!result.success) {
        setCopyRemoteError(result.error || 'Failed to copy remote item.');
        return;
      }

      setCopyTarget(null);
      setCopyDestinationUrl('');
      setCopyMessage('');
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      refetch();
    } catch (error) {
      setCopyRemoteError((error as Error)?.message || 'Failed to copy remote item.');
    } finally {
      setIsCopyingRemote(false);
    }
  }, [copyDestinationUrl, copyMessage, copyTarget, listQueryKey, queryClient, refetch]);

  const handleConnect = useCallback(async () => {
    if (!isValidUrl) return;

    setCurrentPath('/');
    setHistory(['/']);
    setHistoryIndex(0);
    setShowAuthPrompt(false);
    setConnectionError(null);
    const { auth, svnList } = getRepoBrowserRuntime();
    const { realm, credentials: creds } = await loadRepoBrowserCredentials(repoUrl, auth);
    setAuthRealm(realm);

    setCredentials(creds);

    try {
      await svnList(repoUrl, selectedRevision, 'immediates', creds || undefined);
      setIsConnected(true);
      refetch();
    } catch (err) {
      const errorMsg = (err as Error)?.message || '';
      if (isRepoBrowserAuthError(err)) {
        setShowAuthPrompt(true);
      } else {
        setConnectionError(errorMsg);
      }
    }
  }, [isValidUrl, repoUrl, refetch, selectedRevision]);

  const handleAuthSubmit = useCallback(async () => {
    if (!username) return;

    const creds = { username, password };
    setCredentials(creds);
    setShowAuthPrompt(false);
    setConnectionError(null);

    try {
      await getRepoBrowserRuntime().svnList(currentUrl, selectedRevision, 'immediates', creds);
      setIsConnected(true);
      refetch();
    } catch (err) {
      const errorMsg = (err as Error)?.message || '';
      if (isRepoBrowserAuthError(err)) {
        setShowAuthPrompt(true);
      } else {
        setConnectionError(errorMsg);
      }
    }
  }, [username, password, currentUrl, refetch, selectedRevision]);

  const handleAddToWorkingCopy = useCallback(
    async (entry: RepoNode) => {
      if (!workingCopyContext) {
        setAddWcError('Cannot add: no working copy context');
        return;
      }

      const resolvedLocalPath = resolveRemoteUrlToLocalPath(
        entry.url,
        workingCopyContext.workingCopyRoot,
        workingCopyContext.repositoryRoot
      );

      if (!resolvedLocalPath) {
        setAddWcError('Cannot add: URL is outside the working copy repository');
        return;
      }

      setIsAddingToWc(true);
      setAddWcError(null);
      setAddWcSuccess(false);

      try {
        const result = await window.api.svn.updateToRevision(
          workingCopyContext.workingCopyRoot,
          entry.url,
          resolvedLocalPath,
          entry.kind === 'dir' ? 'infinity' : 'empty',
          true
        );

        if (result.success) {
          setAddWcSuccess(true);
        } else {
          setAddWcError(result.error || 'Failed to add to working copy');
        }
      } catch (err) {
        setAddWcError((err as Error)?.message || 'Failed to add to working copy');
      } finally {
        setIsAddingToWc(false);
      }
    },
    [workingCopyContext]
  );

  const formatSize = (bytes?: number): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Stable callback handlers for event handlers to prevent child re-renders
  const handleSelectNode = useCallback((entry: RepoNode) => {
    setSelectedNode(entry);
  }, []);

  const handleCloseAuthPrompt = useCallback(() => {
    setShowAuthPrompt(false);
  }, []);

  const handleOpenCheckout = useCallback(() => {
    setIsCheckoutOpen(true);
  }, []);

  const handleCloseCheckout = useCallback(() => {
    setIsCheckoutOpen(false);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary border-b border-border">
        <Globe className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-text">Repository Browser</span>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 bg-bg-secondary border-b border-border">
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          placeholder="Enter repository URL (https://, svn://, svn+ssh://)"
          className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <label htmlFor="repo-browser-revision" className="sr-only">
          Revision
        </label>
        <input
          id="repo-browser-revision"
          type="text"
          value={revision}
          onChange={(e) => setRevision(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          placeholder="HEAD"
          className="w-28 px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
          aria-label="Revision"
        />
        <button
          onClick={handleConnect}
          disabled={!isValidUrl || isLoading}
          className="btn btn-primary"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect'}
        </button>
      </div>

      {isValidUrl && (
        <>
          <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border">
            <button
              onClick={goBack}
              disabled={historyIndex <= 0}
              className="btn-icon-sm"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goForward}
              disabled={historyIndex >= history.length - 1}
              className="btn-icon-sm"
              title="Forward"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={goUp}
              disabled={currentPath === '/'}
              className="btn-icon-sm"
              title="Up"
            >
              <ChevronRight className="w-4 h-4 rotate-90" />
            </button>
            <button onClick={handleRefresh} className="btn-icon-sm" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleOpenCreateFolder}
              disabled={!isConnected || !currentUrl}
              className="btn-icon-sm"
              title="New Folder"
              aria-label="New Folder"
            >
              <PlusCircle className="w-4 h-4" />
            </button>

            <div className="flex-1 flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded border border-border text-sm">
              <span className="text-text-muted">{repoUrl}</span>
              {currentPath !== '/' && <span className="text-accent">{currentPath}</span>}
            </div>

            {credentials && (
              <div className="flex items-center gap-1 px-2 py-1 bg-success/20 rounded text-xs text-success">
                <Key className="w-3 h-3" />
                <span>{credentials.username}</span>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                className="w-40 pl-8 pr-2 py-1 text-sm bg-bg-tertiary border border-border rounded text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-auto">
              {connectionError && !showAuthPrompt ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center mb-4">
                    <X className="w-6 h-6 text-error" />
                  </div>
                  <h3 className="text-lg font-medium text-text mb-2">Connection Failed</h3>
                  <p className="text-sm text-text-secondary max-w-sm">{connectionError}</p>
                </div>
              ) : isLoading ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-accent mb-4" />
                  <span className="text-sm text-text-muted">Loading repository...</span>
                </div>
              ) : entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="w-12 h-12 rounded-full bg-bg-tertiary flex items-center justify-center mb-4">
                    <Folder className="w-6 h-6 text-text-muted" />
                  </div>
                  <p className="text-sm text-text-muted">
                    {searchQuery ? 'No matching files' : 'Empty directory'}
                  </p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-bg-secondary border-b border-border">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wider w-20">
                        Size
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wider w-20">
                        Revision
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-32">
                        Author
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-40">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {entries.map((entry) => (
                      <tr
                        key={entry.path}
                        className={`cursor-pointer transition-fast ${
                          selectedNode?.path === entry.path
                            ? 'bg-accent/10'
                            : 'hover:bg-bg-tertiary'
                        }`}
                        onClick={() => handleSelectNode(entry)}
                        onDoubleClick={() => handleBrowse(entry)}
                        onMouseEnter={() => prefetchDirectory(entry)}
                        onFocus={() => prefetchDirectory(entry)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleBrowse(entry);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td className="px-4 py-2">
                          {entry.kind === 'dir' ? (
                            <Folder className="w-4 h-4 text-amber-500" />
                          ) : (
                            <FileText className="w-4 h-4 text-text-muted" />
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-text truncate max-w-xs">
                          <div className="flex items-center gap-2">
                            {entry.name}
                            {isInWorkingCopy(entry) && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-success/20 rounded text-xs text-success"
                                title="Already in working copy"
                              >
                                <Check className="w-3 h-3" />
                                WC
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm text-text-muted text-right">
                          {entry.kind === 'file' ? formatSize(entry.size) : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-accent text-right">
                          r{entry.revision}
                        </td>
                        <td className="px-4 py-2 text-sm text-text-muted truncate">
                          {entry.author}
                        </td>
                        <td className="px-4 py-2 text-sm text-text-muted">
                          {formatDate(entry.date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {selectedNode && (
              <div className="w-72 bg-bg-secondary border-l border-border p-4">
                <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
                  {selectedNode.kind === 'dir' ? (
                    <Folder className="w-4 h-4 text-amber-500" />
                  ) : (
                    <FileText className="w-4 h-4 text-text-muted" />
                  )}
                  {selectedNode.name}
                </h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-text-muted">Kind:</span>
                    <span className="ml-2 text-text">
                      {selectedNode.kind === 'dir' ? 'Directory' : 'File'}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">Revision:</span>
                    <span className="ml-2 text-accent">r{selectedNode.revision}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Author:</span>
                    <span className="ml-2 text-text">{selectedNode.author}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Date:</span>
                    <span className="ml-2 text-text">{formatDate(selectedNode.date)}</span>
                  </div>
                  {selectedNode.kind === 'file' && selectedNode.size && (
                    <div>
                      <span className="text-text-muted">Size:</span>
                      <span className="ml-2 text-text">{formatSize(selectedNode.size)}</span>
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-2">
                  {selectedNode.kind === 'dir' && (
                    <button
                      type="button"
                      onClick={handleOpenCheckout}
                      className="w-full btn btn-primary text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Checkout
                    </button>
                  )}
                  {workingCopyContext && !isInWorkingCopy(selectedNode) && (
                      <button
                        type="button"
                        onClick={() => handleAddToWorkingCopy(selectedNode)}
                        disabled={isAddingToWc}
                        className="w-full btn btn-secondary text-sm"
                      >
                        {isAddingToWc ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <PlusCircle className="w-4 h-4" />
                        )}
                        {isAddingToWc ? 'Adding...' : 'Add to Working Copy'}
                      </button>
                    )}
                  {addWcSuccess && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-success/20 rounded text-sm text-success">
                      <Check className="w-4 h-4" />
                      Added to working copy
                    </div>
                  )}
                  {addWcError && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-error/20 rounded text-sm text-error">
                      <AlertCircle className="w-4 h-4" />
                      {addWcError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        to: '/history',
                        search: { path: selectedNode.url },
                      })
                    }
                    className="w-full btn btn-secondary text-sm"
                  >
                    <History className="w-4 h-4" />
                    Show Log
                  </button>
                  <button
                    type="button"
                    onClick={() => window.api.app.openExternal(selectedNode.url)}
                    className="w-full btn btn-ghost text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenRemoteDelete(selectedNode)}
                    className="w-full btn btn-ghost text-sm text-error"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenRemoteMove(selectedNode)}
                    className="w-full btn btn-ghost text-sm"
                  >
                    <Edit3 className="w-4 h-4" />
                    Move/Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenRemoteCopy(selectedNode)}
                    className="w-full btn btn-ghost text-sm"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!isValidUrl && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
            <Globe className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text mb-2">Repository Browser</h3>
          <p className="text-sm text-text-secondary max-w-sm mb-6">
            Enter a repository URL above to browse files and folders directly on the server, without
            needing a working copy.
          </p>
          <div className="text-xs text-text-muted space-y-1">
            <p>Supports: https://, http://, svn://, svn+ssh://</p>
            <p>Example: https://example.com/svn/repo/trunk</p>
          </div>
        </div>
      )}

      <CheckoutDialog
        isOpen={isCheckoutOpen}
        onClose={handleCloseCheckout}
        initialUrl={selectedNode?.url || repoUrl}
        onComplete={handleCloseCheckout}
      />

      {isCreateFolderOpen && (
        <div className="modal-overlay" onClick={handleCloseCreateFolder}>
          <div className="modal w-[440px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <PlusCircle className="w-5 h-5 text-accent" />
                New Remote Folder
              </h2>
              <button
                type="button"
                onClick={handleCloseCreateFolder}
                className="btn-icon-sm"
                disabled={isCreatingFolder}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <div className="block text-sm font-medium text-text mb-1.5">Parent URL</div>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted break-all">
                  {currentUrl}
                </div>
              </div>
              <div>
                <label
                  htmlFor="repo-browser-folder-name"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Folder name
                </label>
                <input
                  id="repo-browser-folder-name"
                  type="text"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  className="input"
                  disabled={isCreatingFolder}
                />
              </div>
              <div>
                <label
                  htmlFor="repo-browser-folder-message"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Commit message
                </label>
                <textarea
                  id="repo-browser-folder-message"
                  value={newFolderMessage}
                  onChange={(event) => setNewFolderMessage(event.target.value)}
                  className="input min-h-24 resize-y"
                  disabled={isCreatingFolder}
                />
              </div>
              {createFolderError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error/20 rounded text-sm text-error">
                  <AlertCircle className="w-4 h-4" />
                  {createFolderError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={handleCloseCreateFolder}
                className="btn btn-ghost"
                disabled={isCreatingFolder}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateRemoteFolder}
                disabled={isCreatingFolder || !newFolderName.trim() || !newFolderMessage.trim()}
                className="btn btn-primary"
              >
                {isCreatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={handleCloseRemoteDelete}>
          <div className="modal w-[440px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Trash2 className="w-5 h-5 text-error" />
                Delete Remote Item
              </h2>
              <button
                type="button"
                onClick={handleCloseRemoteDelete}
                className="btn-icon-sm"
                disabled={isDeletingRemote}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <p className="text-sm text-text-secondary">
                This will commit a delete directly to the repository.
              </p>
              <div>
                <div className="block text-sm font-medium text-text mb-1.5">Target URL</div>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted break-all">
                  {deleteTarget.url}
                </div>
              </div>
              <div>
                <label
                  htmlFor="repo-browser-delete-message"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Commit message
                </label>
                <textarea
                  id="repo-browser-delete-message"
                  value={deleteMessage}
                  onChange={(event) => setDeleteMessage(event.target.value)}
                  className="input min-h-24 resize-y"
                  disabled={isDeletingRemote}
                />
              </div>
              {deleteRemoteError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error/20 rounded text-sm text-error">
                  <AlertCircle className="w-4 h-4" />
                  {deleteRemoteError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={handleCloseRemoteDelete}
                className="btn btn-ghost"
                disabled={isDeletingRemote}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteRemoteItem}
                disabled={isDeletingRemote || !deleteMessage.trim()}
                className="btn btn-primary"
              >
                {isDeletingRemote ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {moveTarget && (
        <div className="modal-overlay" onClick={handleCloseRemoteMove}>
          <div className="modal w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Edit3 className="w-5 h-5 text-accent" />
                Move or Rename Remote Item
              </h2>
              <button
                type="button"
                onClick={handleCloseRemoteMove}
                className="btn-icon-sm"
                disabled={isMovingRemote}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <div className="block text-sm font-medium text-text mb-1.5">Source URL</div>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted break-all">
                  {moveTarget.url}
                </div>
              </div>
              <div>
                <label
                  htmlFor="repo-browser-move-destination"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Destination URL
                </label>
                <input
                  id="repo-browser-move-destination"
                  type="text"
                  value={moveDestinationUrl}
                  onChange={(event) => setMoveDestinationUrl(event.target.value)}
                  className="input"
                  disabled={isMovingRemote}
                />
              </div>
              <div>
                <label
                  htmlFor="repo-browser-move-message"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Commit message
                </label>
                <textarea
                  id="repo-browser-move-message"
                  value={moveMessage}
                  onChange={(event) => setMoveMessage(event.target.value)}
                  className="input min-h-24 resize-y"
                  disabled={isMovingRemote}
                />
              </div>
              {moveRemoteError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error/20 rounded text-sm text-error">
                  <AlertCircle className="w-4 h-4" />
                  {moveRemoteError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={handleCloseRemoteMove}
                className="btn btn-ghost"
                disabled={isMovingRemote}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMoveRemoteItem}
                disabled={isMovingRemote || !moveDestinationUrl.trim() || !moveMessage.trim()}
                className="btn btn-primary"
              >
                {isMovingRemote ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {copyTarget && (
        <div className="modal-overlay" onClick={handleCloseRemoteCopy}>
          <div className="modal w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Copy className="w-5 h-5 text-accent" />
                Copy Remote Item
              </h2>
              <button
                type="button"
                onClick={handleCloseRemoteCopy}
                className="btn-icon-sm"
                disabled={isCopyingRemote}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <div className="block text-sm font-medium text-text mb-1.5">Source URL</div>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted break-all">
                  {copyTarget.url}
                </div>
              </div>
              <div>
                <label
                  htmlFor="repo-browser-copy-destination"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Destination URL
                </label>
                <input
                  id="repo-browser-copy-destination"
                  type="text"
                  value={copyDestinationUrl}
                  onChange={(event) => setCopyDestinationUrl(event.target.value)}
                  className="input"
                  disabled={isCopyingRemote}
                />
              </div>
              <div>
                <label
                  htmlFor="repo-browser-copy-message"
                  className="block text-sm font-medium text-text mb-1.5"
                >
                  Commit message
                </label>
                <textarea
                  id="repo-browser-copy-message"
                  value={copyMessage}
                  onChange={(event) => setCopyMessage(event.target.value)}
                  className="input min-h-24 resize-y"
                  disabled={isCopyingRemote}
                />
              </div>
              {copyRemoteError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error/20 rounded text-sm text-error">
                  <AlertCircle className="w-4 h-4" />
                  {copyRemoteError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={handleCloseRemoteCopy}
                className="btn btn-ghost"
                disabled={isCopyingRemote}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCopyRemoteItem}
                disabled={isCopyingRemote || !copyDestinationUrl.trim() || !copyMessage.trim()}
                className="btn btn-primary"
              >
                {isCopyingRemote ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuthPrompt && (
        <div className="modal-overlay" onClick={handleCloseAuthPrompt}>
          <div className="modal w-[400px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Lock className="w-5 h-5 text-accent" />
                Authentication Required
              </h2>
              <button type="button" onClick={handleCloseAuthPrompt} className="btn-icon-sm">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <p className="text-sm text-text-secondary">
                Authentication is required to access this repository.
              </p>
              <div>
                <div className="block text-sm font-medium text-text mb-1.5">Realm</div>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted">
                  {authRealm}
                </div>
              </div>
              <div>
                <label htmlFor="repo-browser-auth-username" className="block text-sm font-medium text-text mb-1.5">
                  Username
                </label>
                <input
                  id="repo-browser-auth-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="repo-browser-auth-password" className="block text-sm font-medium text-text mb-1.5">
                  Password
                </label>
                <input
                  id="repo-browser-auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuthSubmit()}
                  className="input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={handleCloseAuthPrompt} className="btn btn-ghost">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAuthSubmit}
                disabled={!username}
                className="btn btn-primary"
              >
                Authenticate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
