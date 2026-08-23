import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuthSession, LazyTreeLoaderState, LazyTreeNode, SvnListResult } from '@shared/types';
import { assertSuccessfulSvnRead } from '../utils/svnReadResult';
import { svnTree } from '../lib/queryKeys';
import { withIpcTimeout } from '../lib/queryTimeout';

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

function getTreeQueryKey(rootUrl: string, credentials?: AuthSession) {
  return svnTree(rootUrl, credentials?.id);
}

function svnListToLazyTreeNode(result: SvnListResult): LazyTreeNode[] {
  assertSuccessfulSvnRead(result);
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
      isLoaded: !isDirectory,
      children: [],
      hasChildren,
      status: undefined,
    };

    nodes.push(node);
  }

  return nodes;
}

function updateNodeInTree(
  nodes: LazyTreeNode[],
  path: string,
  update: (node: LazyTreeNode) => LazyTreeNode
): LazyTreeNode[] {
  let changed = false;

  const updatedNodes = nodes.map((node) => {
    if (node.path === path) {
      changed = true;
      return update(node);
    }

    if (node.children.length > 0) {
      const updatedChildren = updateNodeInTree(node.children, path, update);
      if (updatedChildren !== node.children) {
        changed = true;
        return {
          ...node,
          children: updatedChildren,
        };
      }
    }

    return node;
  });

  return changed ? updatedNodes : nodes;
}

export function useLazyTreeLoader(rootUrl: string, credentials?: AuthSession) {
  const queryClient = useQueryClient();

  // State for individual node loading
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());

  // State for individual node errors
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());

  // Query key for the root tree
  const rootQueryKey = getTreeQueryKey(rootUrl, credentials);

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
        // The timeout turns a wedged `svn list` into an error the tree can
        // render, instead of a root that spins forever.
        const result = await withIpcTimeout(
          () =>
            window.api.svn.list(
              rootUrl,
              undefined, // revision
              'immediates', // depth: get immediate children only
              credentials?.id
            ),
          undefined,
          'svn:tree'
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
    mutationFn: async ({
      path,
      credentials: nodeCredentials,
    }: {
      path: string;
      credentials?: AuthSession;
    }) => {
      setLoadingNodes((prev) => new Set(prev).add(path));

      try {
        const result = await withIpcTimeout(
          () =>
            window.api.svn.list(
              path,
              undefined, // revision
              'immediates', // depth: immediate children only
              nodeCredentials?.id
            ),
          undefined,
          'svn:tree'
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
      queryClient.setQueryData<SvnTreeCacheData | undefined>(rootQueryKey, (oldData) => {
        if (!oldData) return oldData;

        const updatedNodes = updateNodeInTree(oldData.nodes, data.path, (node) => ({
          ...node,
          children: data.nodes,
          isLoaded: true,
          isLoading: false,
        }));

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
      queryClient.setQueryData<SvnTreeCacheData | undefined>(rootQueryKey, (oldData) => {
        if (!oldData) return oldData;

        const updatedNodes = updateNodeInTree(oldData.nodes, variables.path, (node) => ({
          ...node,
          isLoading: false,
        }));

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
    treeState.roots = rootData.nodes;
  }

  /**
   * Load children for a specific node (on-demand)
   */
  const loadNode = useCallback(
    async (path: string, nodeCredentials?: AuthSession) => {
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
    prefetchNode: (path: string, nodeCredentials?: AuthSession) => {
      queryClient.prefetchQuery({
        queryKey: getTreeQueryKey(path, nodeCredentials),
        queryFn: async () => {
          const result = await withIpcTimeout(
            () => window.api.svn.list(path, undefined, 'immediates', nodeCredentials?.id),
            undefined,
            'svn:tree'
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
