import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Loader2,
  FolderOpen,
  AlertCircle,
  CheckSquare,
  Square,
  HardDrive,
  Lock,
  User,
  Key,
  RefreshCw,
  Wifi,
} from 'lucide-react';
import { VirtualizedTree, type TreeNode } from './VirtualizedList';
import { useLazyTreeLoader } from '@renderer/hooks/useLazyTreeLoader';
import type { AuthCredential, LazyTreeNode } from '@shared/types';
import {
  classifySparseError,
  isNetworkError,
  credentialCache,
  type SparseCheckoutError,
} from '@renderer/utils/sparseErrorHandling';

interface ChooseItemsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Repository URL to browse */
  repoUrl: string;
  /** Optional credentials for authenticated access */
  credentials?: AuthCredential;
  /** Callback when user confirms selection */
  onSelect: (paths: string[]) => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Dialog title (optional) */
  title?: string;
  /** Whether to show size estimates (optional) */
  showSizeEstimate?: boolean;
}

interface FileSizeInfo {
  totalSize: number;
  fileCount: number;
}

/**
 * Convert LazyTreeNode array to TreeNode array for VirtualizedTree
 */
function lazyTreeToTreeNodes(nodes: LazyTreeNode[]): TreeNode[] {
  return nodes.map((node) => ({
    id: node.path,
    name: node.name,
    path: node.path,
    isDirectory: node.kind === 'dir',
    hasChildren: node.hasChildren,
    children: node.children.length > 0 ? lazyTreeToTreeNodes(node.children) : undefined,
  }));
}

/**
 * Filter tree nodes based on search query
 */
function filterTreeNodes(
  nodes: TreeNode[],
  query: string
): { filteredNodes: TreeNode[]; matchedPaths: Set<string> } {
  if (!query.trim()) {
    return { filteredNodes: nodes, matchedPaths: new Set() };
  }

  const lowerQuery = query.toLowerCase();
  const matchedPaths = new Set<string>();

  const filterNode = (node: TreeNode): TreeNode | null => {
    const nameMatches = node.name.toLowerCase().includes(lowerQuery);
    const pathMatches = node.path.toLowerCase().includes(lowerQuery);
    const matches = nameMatches || pathMatches;

    let filteredChildren: TreeNode[] = [];
    if (node.children) {
      filteredChildren = node.children
        .map((child) => filterNode(child))
        .filter((child): child is TreeNode => child !== null);
    }

    if (matches || filteredChildren.length > 0) {
      if (matches) {
        matchedPaths.add(node.path);
      }
      return {
        ...node,
        children: filteredChildren.length > 0 ? filteredChildren : node.children,
      };
    }

    return null;
  };

  const filteredNodes = nodes
    .map((node) => filterNode(node))
    .filter((node): node is TreeNode => node !== null);

  return { filteredNodes, matchedPaths };
}

export function ChooseItemsDialog({
  isOpen,
  repoUrl,
  credentials,
  onSelect,
  onCancel,
  title = 'Choose Items to Checkout',
  showSizeEstimate = true,
}: ChooseItemsDialogProps) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [classifiedError, setClassifiedError] = useState<SparseCheckoutError | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeCredentials, setActiveCredentials] = useState<AuthCredential | undefined>(() => {
    if (credentials) return credentials;
    return credentialCache.get(repoUrl);
  });

  const { loadNode, refreshTree, isLoading, error, nodes, roots, isNodeLoading, clearNodeError } =
    useLazyTreeLoader(repoUrl, activeCredentials);

  useEffect(() => {
    if (error) {
      setClassifiedError(classifySparseError(error));
    } else {
      setClassifiedError(null);
    }
  }, [error]);

  // Convert LazyTreeNode to TreeNode for VirtualizedTree
  const treeNodes = useMemo(() => lazyTreeToTreeNodes(roots), [roots]);

  // Filter tree based on search
  const { filteredNodes, matchedPaths } = useMemo(
    () => filterTreeNodes(treeNodes, searchQuery),
    [treeNodes, searchQuery]
  );

  // Auto-expand matching paths when searching
  useEffect(() => {
    if (searchQuery.trim() && matchedPaths.size > 0) {
      const parentPaths = new Set<string>();
      matchedPaths.forEach((path) => {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          parentPaths.add(parts.slice(0, i).join('/'));
        }
      });
      setExpandedPaths((prev) => {
        const hasNewPaths = [...parentPaths].some((p) => !prev.has(p));
        if (!hasNewPaths) return prev;
        return new Set([...prev, ...parentPaths]);
      });
    }
  }, [searchQuery, matchedPaths]);

  // Calculate selection stats
  const selectionStats = useMemo(() => {
    const stats: FileSizeInfo = { totalSize: 0, fileCount: 0 };

    // Count files in selection
    const countFiles = (nodeList: LazyTreeNode[], parentSelected: boolean): number => {
      let count = 0;
      for (const node of nodeList) {
        const isSelected = selectedPaths.has(node.path) || parentSelected;
        if (node.kind === 'file' && isSelected) {
          count++;
        }
        if (node.children && node.children.length > 0) {
          count += countFiles(node.children, isSelected);
        }
      }
      return count;
    };

    stats.fileCount = countFiles(Array.from(nodes.values()), false);
    // Size estimation is approximate - actual size depends on file sizes from SVN info
    // For now, we'll show item count only as size would require additional API calls

    return stats;
  }, [selectedPaths, nodes]);

  // Handle node expand toggle
  const handleToggleExpand = useCallback(
    async (node: TreeNode) => {
      const path = node.path;

      if (expandedPaths.has(path)) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } else {
        setExpandedPaths((prev) => new Set(prev).add(path));

        const lazyNode = nodes.get(path);
        if (lazyNode && !lazyNode.isLoaded && !lazyNode.isLoading) {
          try {
            await loadNode(path, activeCredentials);
            clearNodeError?.(path);
          } catch (err) {
            const classified = classifySparseError(err);
            if (classified.requiresAuth) {
              setPendingPath(path);
              setShowAuthPrompt(true);
            }
          }
        }
      }
    },
    [expandedPaths, nodes, loadNode, activeCredentials, clearNodeError]
  );

  // Handle auth prompt submit with loading state
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    const newCredentials: AuthCredential = {
      username: authUsername.trim(),
      password: authPassword,
    };

    try {
      credentialCache.set(repoUrl, newCredentials);
      setActiveCredentials(newCredentials);
      setShowAuthPrompt(false);

      if (pendingPath) {
        await loadNode(pendingPath, newCredentials);
        clearNodeError?.(pendingPath);
      }
    } catch (err) {
      const classified = classifySparseError(err);
      setAuthError(classified.message);
      credentialCache.clear(repoUrl);
    } finally {
      setAuthLoading(false);
      setPendingPath(null);
    }
  };

  const handleRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    retryTimeoutRef.current = setTimeout(
      () => {
        refreshTree();
      },
      isNetworkError(error) ? 1000 : 0
    );
  }, [error, refreshTree]);

  const handleSelectAll = useCallback(() => {
    const allPaths = new Set<string>();

    const collectPaths = (nodeList: TreeNode[]) => {
      for (const node of nodeList) {
        allPaths.add(node.path);
        if (node.children) {
          collectPaths(node.children);
        }
      }
    };

    collectPaths(treeNodes);
    setSelectedPaths(allPaths);
  }, [treeNodes]);

  const handleDeselectAll = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    const pathsArray = Array.from(selectedPaths);
    onSelect(pathsArray);
  }, [selectedPaths, onSelect]);

  useEffect(() => {
    if (isOpen) {
      setSelectedPaths(new Set());
      setExpandedPaths(new Set());
      setSearchQuery('');
      setShowAuthPrompt(false);
      setAuthUsername('');
      setAuthPassword('');
      setPendingPath(null);
      setAuthLoading(false);
      setAuthError(null);
      setClassifiedError(null);
      const cached = credentialCache.get(repoUrl);
      setActiveCredentials(credentials || cached);
    }
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [isOpen, credentials, repoUrl]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  // Loading paths set for VirtualizedTree
  const loadingPaths = useMemo(() => {
    const paths = new Set<string>();
    nodes.forEach((_, path) => {
      if (isNodeLoading(path)) {
        paths.add(path);
      }
    });
    return paths;
  }, [nodes, isNodeLoading]);

  if (!isOpen) return null;

  return (
    <>
      {/* Main Dialog */}
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal w-[700px] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="modal-header">
            <h2 className="modal-title">
              <FolderOpen className="w-5 h-5 text-accent" />
              {title}
            </h2>
            <button onClick={onCancel} className="btn-icon-sm" disabled={isLoading}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="modal-body flex flex-col min-h-0">
            {/* Search Bar */}
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search files and folders..."
                  className="input pl-10 w-full"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Repository URL */}
            <div className="mb-3 px-3 py-2 bg-surface-elevated rounded text-sm">
              <span className="text-text-muted">Repository:</span>{' '}
              <span className="text-text font-mono break-all">{repoUrl}</span>
            </div>

            {/* Tree Container */}
            <div className="flex-1 min-h-[300px] border border-border rounded overflow-hidden">
              {isLoading && roots.length === 0 ? (
                <div className="flex items-center justify-center h-full text-text-muted">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  <span>Loading repository structure...</span>
                </div>
              ) : classifiedError ? (
                <div className="flex flex-col items-center justify-center h-full p-4">
                  {isNetworkError(error) ? (
                    <Wifi className="w-8 h-8 text-warning mb-2" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-error mb-2" />
                  )}
                  <span className="text-center text-text font-medium mb-1">
                    {classifiedError.title}
                  </span>
                  <span className="text-center text-text-secondary text-sm mb-3">
                    {classifiedError.message}
                  </span>
                  {classifiedError.suggestions.length > 0 && (
                    <div className="text-xs text-text-muted mb-3 max-w-sm">
                      {classifiedError.suggestions[0]}
                    </div>
                  )}
                  {classifiedError.retryable && (
                    <button type="button" onClick={handleRetry} className="btn btn-secondary">
                      <RefreshCw
                        className={`w-4 h-4 ${isNetworkError(error) ? 'animate-spin' : ''}`}
                      />
                      Try Again
                    </button>
                  )}
                </div>
              ) : filteredNodes.length === 0 ? (
                <div className="flex items-center justify-center h-full text-text-muted">
                  {searchQuery ? 'No matching files or folders' : 'Repository is empty'}
                </div>
              ) : (
                <VirtualizedTree
                  nodes={filteredNodes}
                  expandedPaths={expandedPaths}
                  loadingPaths={loadingPaths}
                  onToggleExpand={handleToggleExpand}
                  checkboxSelection={{
                    selectedKeys: selectedPaths,
                    onSelectionChange: setSelectedPaths,
                  }}
                  estimatedRowHeight={28}
                  className="h-full"
                />
              )}
            </div>

            {/* Selection Actions */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="btn btn-ghost text-sm"
                disabled={isLoading || filteredNodes.length === 0}
              >
                <CheckSquare className="w-4 h-4" />
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="btn btn-ghost text-sm"
                disabled={isLoading || selectedPaths.size === 0}
              >
                <Square className="w-4 h-4" />
                Deselect All
              </button>
            </div>

            {/* Selection Summary */}
            {selectedPaths.size > 0 && (
              <div className="mt-3 px-3 py-2 bg-accent/10 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-accent" />
                  <span className="text-sm text-text-secondary">
                    {selectedPaths.size} item{selectedPaths.size !== 1 ? 's' : ''} selected
                    {showSizeEstimate && selectionStats.fileCount > 0 && (
                      <span className="text-text-muted ml-2">
                        (~{selectionStats.fileCount} file{selectionStats.fileCount !== 1 ? 's' : ''}
                        )
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mt-3 flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="btn btn-primary"
              disabled={isLoading || selectedPaths.size === 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Select ({selectedPaths.size})
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Authentication Prompt */}
      {showAuthPrompt && (
        <div className="modal-overlay" style={{ zIndex: 100 }}>
          <div className="modal w-[400px]" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleAuthSubmit}>
              <div className="modal-header">
                <h2 className="modal-title">
                  <Lock className="w-5 h-5 text-accent" />
                  Authentication Required
                </h2>
              </div>

              <div className="modal-body space-y-4">
                <p className="text-text-secondary text-sm">
                  Authentication is required to access this repository path.
                </p>

                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Username <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    placeholder="Enter username"
                    className="input"
                    disabled={authLoading}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Password
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Enter password"
                    className="input"
                    disabled={authLoading}
                  />
                </div>

                {authError && (
                  <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowAuthPrompt(false);
                    setPendingPath(null);
                    setAuthError(null);
                  }}
                  className="btn btn-secondary"
                  disabled={authLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!authUsername.trim() || authLoading}
                >
                  {authLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Authenticate
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default ChooseItemsDialog;
