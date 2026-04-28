import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import { CheckoutDialog } from '@renderer/components/ui/CheckoutDialog';
import { useWorkingCopyContext } from '@renderer/hooks/useWorkingCopyContext';
import { resolveRemoteUrlToLocalPath } from '@renderer/utils/pathResolution';

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

function getRealmFromUrl(url: string): string {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : url;
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

  const [repoUrl, setRepoUrl] = useState(search.url || '');
  const [currentPath, setCurrentPath] = useState('/');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [authRealm, setAuthRealm] = useState<string>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);
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
      window.api.auth
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

  const {
    data: directoryData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['repo-browser', currentUrl, credentials],
    queryFn: async () => {
      const result = await window.api.svn.list(
        currentUrl,
        'HEAD',
        'immediates',
        credentials || undefined
      );
      return result;
    },
    enabled: isConnected && Boolean(isValidUrl) && !showAuthPrompt,
    staleTime: 60000,
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

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleConnect = useCallback(async () => {
    if (!isValidUrl) return;

    setCurrentPath('/');
    setHistory(['/']);
    setHistoryIndex(0);
    setShowAuthPrompt(false);
    setConnectionError(null);
    setAuthRealm(repoUrl);

    const realm = getRealmFromUrl(repoUrl);
    let creds: { username: string; password: string } | null = null;

    try {
      const storedCreds = await window.api.auth.get(realm);
      if (storedCreds) {
        creds = {
          username: storedCreds.username,
          password: storedCreds.password,
        };
      }
    } catch {
      setCredentials(null);
    }

    setCredentials(creds);

    try {
      await window.api.svn.list(repoUrl, 'HEAD', 'immediates', creds || undefined);
      setIsConnected(true);
      refetch();
    } catch (err) {
      const errorMsg = (err as Error)?.message || '';
      if (
        errorMsg.includes('credentials') ||
        errorMsg.includes('Authentication') ||
        errorMsg.includes('E215004')
      ) {
        setShowAuthPrompt(true);
      } else {
        setConnectionError(errorMsg);
      }
    }
  }, [isValidUrl, repoUrl, refetch]);

  const handleAuthSubmit = useCallback(async () => {
    if (!username) return;

    const creds = { username, password };
    setCredentials(creds);
    setShowAuthPrompt(false);
    setConnectionError(null);

    try {
      await window.api.svn.list(currentUrl, 'HEAD', 'immediates', creds);
      setIsConnected(true);
      refetch();
    } catch (err) {
      const errorMsg = (err as Error)?.message || '';
      if (
        errorMsg.includes('credentials') ||
        errorMsg.includes('Authentication') ||
        errorMsg.includes('E215004')
      ) {
        setShowAuthPrompt(true);
      } else {
        setConnectionError(errorMsg);
      }
    }
  }, [username, password, currentUrl, refetch]);

  const handleAddToWorkingCopy = useCallback(
    async (entry: RepoNode) => {
      if (!workingCopyContext || entry.kind !== 'dir') {
        setAddWcError('Cannot add: no working copy context or item is not a directory');
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
          'infinity',
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
                  {selectedNode.kind === 'dir' &&
                    workingCopyContext &&
                    !isInWorkingCopy(selectedNode) && (
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
                <label className="block text-sm font-medium text-text mb-1.5">Realm</label>
                <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted">
                  {authRealm}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1.5">Password</label>
                <input
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
