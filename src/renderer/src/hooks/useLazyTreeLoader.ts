import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuthCredential, LazyTreeLoaderState, LazyTreeNode, SvnListResult } from '@shared/types';

/**
 * Cached tree data structure for TanStack Query
 */
interface SvnTreeCacheData {
  path: string;
  nodes: LazyTreeNode[];
  result: SvnListResult;
}

const TREE_CACHE_STALE_TIME = 5 * 60 * 1000; // 5 minutes staleTime as required
const TREE_CACHE_GC_TIME = 30 * 60 * 1000; // 30 minutes

function svnListToLazyTreeNode(result: SvnListResult): LazyTreeNode[] {
  const nodes: LazyTreeNode[] = [];

  for (const entry of result.entries) {
    const fullPath = entry.path;
    const name = entry.name;
    const isDirectory = entry.kind === 'dir';

    const hasChildren = isDirectory;

    const node: LazyTreeNode = {
      path: fullPath,
      name,
      kind: isDirectory ? 'dir' : 'file',
      isLoading: false,
      isLoaded: true,
      children: [],
      hasChildren,
      status: undefined,
    };

    nodes.push(node);
  }

  return nodes;
}

function findNodeInTree(nodes: LazyTreeNode[], path: string): LazyTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.hasChildren) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function getRootNodes(tree: LazyTreeNode[]): LazyTreeNode[] {
  return tree.filter((node) => {
    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/'))
      : node.path.includes('\\')
        ? node.path.substring(0, node.path.lastIndexOf('\\'))
        : '';

    return !tree.some((other) => other.path === parentPath);
  });
}

export function useLazyTreeLoader(rootUrl: string, credentials?: AuthCredential) {
  const queryClient = useQueryClient();

  // State for individual node loading
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());

  // State for individual node errors
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());

  // Query key for the root tree
  const rootQueryKey = ['svn:tree', rootUrl, credentials?.username];

  // Query to fetch the root directory children
  const {
    data: rootData,
    isLoading: isLoadingRoot,
    error: rootError,
    refetch: refetchRoot,
  } = useQuery({
    queryKey: rootQueryKey,
    queryFn: async () => {
      try {
        const result = await window.api.svn.list(
          rootUrl,
          undefined, // revision
          'immediates', // depth: get immediate children only
          credentials
            ? { username: credentials.username, password: credentials.password }
            : undefined
        );

        return {
          path: rootUrl,
          nodes: svnListToLazyTreeNode(result),
          result,
        };
      } catch (error) {
        throw new Error(
          `Failed to load root tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { cause: error }
        );
      }
    },
    enabled: !!rootUrl,
    staleTime: TREE_CACHE_STALE_TIME,
    gcTime: TREE_CACHE_GC_TIME,
  });

  // Mutation for loading individual nodes (children)
  const loadNodeMutation = useMutation({
    mutationFn: async ({ path, credentials }: { path: string; credentials?: AuthCredential }) => {
      setLoadingNodes((prev) => new Set(prev).add(path));

      try {
        const result = await window.api.svn.list(
          path,
          undefined, // revision
          'immediates', // depth: immediate children only
          credentials
            ? { username: credentials.username, password: credentials.password }
            : undefined
        );

        return {
          path,
          nodes: svnListToLazyTreeNode(result),
          result,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load node';
        setNodeErrors((prev) => new Map(prev).set(path, errorMessage));
        throw error;
      } finally {
        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    onSuccess: (data) => {
      // Update the tree with loaded children
      queryClient.setQueryData<SvnTreeCacheData | undefined>(['svn:tree', rootUrl], (oldData) => {
        if (!oldData) return oldData;

        const updatedNodes = [...oldData.nodes];
        const parentNode = findNodeInTree(updatedNodes, data.path);

        if (parentNode) {
          parentNode.children = data.nodes;
          parentNode.isLoaded = true;
          parentNode.isLoading = false;
        }

        return {
          ...oldData,
          nodes: updatedNodes,
        };
      });
    },
    onError: (error, variables) => {
      // Update error state
      setNodeErrors((prev) =>
        new Map(prev).set(variables.path, error instanceof Error ? error.message : 'Unknown error')
      );

      // Update loading state
      queryClient.setQueryData<SvnTreeCacheData | undefined>(['svn:tree', rootUrl], (oldData) => {
        if (!oldData) return oldData;

        const updatedNodes = [...oldData.nodes];
        const parentNode = findNodeInTree(updatedNodes, variables.path);

        if (parentNode) {
          parentNode.isLoading = false;
        }

        return {
          ...oldData,
          nodes: updatedNodes,
        };
      });
    },
  });

  // Build the full tree state
  const treeState: LazyTreeLoaderState = {
    isLoading: isLoadingRoot || loadingNodes.size > 0,
    error: rootError instanceof Error ? rootError.message : undefined,
    nodes: new Map<string, LazyTreeNode>(),
    roots: [],
    selection: {
      selectedPaths: new Set(),
      expandedPaths: new Set(),
    },
  };

  // Populate nodes and roots if we have data
  if (rootData?.nodes) {
    const addNodesToMap = (nodeList: LazyTreeNode[]) => {
      for (const node of nodeList) {
        treeState.nodes.set(node.path, { ...node });
        if (node.hasChildren && node.children.length > 0) {
          addNodesToMap(node.children);
        }
      }
    };

    addNodesToMap(rootData.nodes);
    treeState.roots = getRootNodes(rootData.nodes);
  }

  /**
   * Load children for a specific node (on-demand)
   */
  const loadNode = useCallback(
    async (path: string, nodeCredentials?: AuthCredential) => {
      // Check if already loaded or loading
      const node = treeState.nodes.get(path);
      if (node?.isLoaded || node?.isLoading || loadingNodes.has(path)) {
        return Promise.resolve();
      }

      try {
        await loadNodeMutation.mutateAsync({
          path,
          credentials: nodeCredentials || credentials,
        });
      } catch (error) {
        // Error is already handled by the mutation
        console.error(`Failed to load node ${path}:`, error);
      }
    },
    [treeState.nodes, loadingNodes, loadNodeMutation, credentials]
  );

  /**
   * Refresh the root tree
   */
  const refreshTree = useCallback(() => {
    refetchRoot();
    // Clear any node errors
    setNodeErrors(new Map());
    // Clear loading states
    setLoadingNodes(new Set());
  }, [refetchRoot]);

  /**
   * Clear error state for a specific node
   */
  const clearNodeError = useCallback((path: string) => {
    setNodeErrors((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }, []);

  /**
   * Check if a node is currently loading
   */
  const isNodeLoading = useCallback(
    (path: string) => {
      return loadingNodes.has(path);
    },
    [loadingNodes]
  );

  /**
   * Get error for a specific node
   */
  const getNodeError = useCallback(
    (path: string) => {
      return nodeErrors.get(path);
    },
    [nodeErrors]
  );

  return {
    // Core functionality
    loadNode,
    refreshTree,

    // State
    ...treeState,

    // Individual node operations
    isNodeLoading,
    getNodeError,
    clearNodeError,

    // Mutations
    isNodeLoadingMutation: loadNodeMutation.isPending,
    loadNodeError: loadNodeMutation.error,

    // Cache management
    invalidateTree: () => queryClient.invalidateQueries({ queryKey: rootQueryKey }),
    prefetchNode: (path: string, nodeCredentials?: AuthCredential) => {
      queryClient.prefetchQuery({
        queryKey: ['svn:tree', path, nodeCredentials?.username],
        queryFn: async () => {
          const result = await window.api.svn.list(
            path,
            undefined,
            'immediates',
            nodeCredentials
              ? { username: nodeCredentials.username, password: nodeCredentials.password }
              : undefined
          );
          return {
            path,
            nodes: svnListToLazyTreeNode(result),
            result,
          };
        },
        staleTime: TREE_CACHE_STALE_TIME,
      });
    },
  };
}

export type { LazyTreeNode, LazyTreeLoaderState } from '@shared/types';
