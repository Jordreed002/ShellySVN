/**
 * Tests for useLazyTreeLoader hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useLazyTreeLoader } from '../src/hooks/useLazyTreeLoader';
import type { SvnListResult, ElectronAPI } from '../../shared/types';

// Mock window.api
const mockSvnList = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  // Set up window.api mock
  (globalThis as any).window = {
    api: {
      svn: {
        list: mockSvnList,
      },
    } as Partial<ElectronAPI>,
  };
});

// Create a wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

// Helper to create mock SVN list result
function createMockListResult(path: string, entries: Array<{ name: string; kind: 'file' | 'dir' }>): SvnListResult {
  return {
    path,
    entries: entries.map((e) => ({
      name: e.name,
      path: `${path}/${e.name}`,
      url: `${path}/${e.name}`,
      kind: e.kind,
      revision: 1,
      author: 'testuser',
      date: '2024-01-01T12:00:00Z',
      ...(e.kind === 'file' ? { size: 100 } : {}),
    })),
  };
}

describe('useLazyTreeLoader', () => {
  describe('initialization', () => {
    it('should initialize with loading state when fetching', async () => {
      // Create a promise that we can resolve manually
      let resolvePromise: (value: SvnListResult) => void;
      const pendingPromise = new Promise<SvnListResult>((resolve) => {
        resolvePromise = resolve;
      });
      mockSvnList.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useLazyTreeLoader('https://svn.example.com/repo/trunk'), {
        wrapper: createWrapper(),
      });

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.nodes).toBeInstanceOf(Map);
      expect(result.current.roots).toEqual([]);

      // Resolve the promise
      resolvePromise!(createMockListResult('https://svn.example.com/repo/trunk', []));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should initialize with empty state when no URL provided', async () => {
      const { result } = renderHook(() => useLazyTreeLoader(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeUndefined();
      expect(result.current.nodes).toBeInstanceOf(Map);
      expect(result.current.roots).toEqual([]);
    });
  });

  describe('loading tree data', () => {
    it('should load root tree successfully', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/trunk', [
          { name: 'src', kind: 'dir' },
          { name: 'README.md', kind: 'file' },
        ])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.roots).toHaveLength(2);
      expect(result.current.nodes.size).toBe(2);

      const srcNode = result.current.nodes.get('https://svn.example.com/repo/trunk/src');
      expect(srcNode?.name).toBe('src');
      expect(srcNode?.kind).toBe('dir');
      expect(srcNode?.hasChildren).toBe(true);

      const readmeNode = result.current.nodes.get('https://svn.example.com/repo/trunk/README.md');
      expect(readmeNode?.name).toBe('README.md');
      expect(readmeNode?.kind).toBe('file');
      expect(readmeNode?.hasChildren).toBe(false);
    });

    it('should handle empty repository', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/empty', [])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/empty'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.roots).toEqual([]);
      expect(result.current.nodes.size).toBe(0);
    });

    it('should handle loading errors', async () => {
      mockSvnList.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('Failed to load root tree');
    });
  });

  describe('refreshTree', () => {
    it('should refresh tree correctly', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/trunk', [
          { name: 'file.txt', kind: 'file' },
        ])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockSvnList).toHaveBeenCalledTimes(1);

      // Refresh
      act(() => {
        result.current.refreshTree();
      });

      await waitFor(() => {
        expect(mockSvnList).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('node error handling', () => {
    it('should clear node errors', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/trunk', [])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear a node error (even if there isn't one)
      act(() => {
        result.current.clearNodeError('test-path');
      });

      expect(result.current.getNodeError('test-path')).toBeUndefined();
    });

    it('should check if node is loading', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/trunk', [])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isNodeLoading('test-path')).toBe(false);
    });
  });

  describe('selection state', () => {
    it('should initialize with empty selection', async () => {
      mockSvnList.mockResolvedValue(
        createMockListResult('https://svn.example.com/repo/trunk', [])
      );

      const { result } = renderHook(
        () => useLazyTreeLoader('https://svn.example.com/repo/trunk'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.selection).toEqual({
        selectedPaths: new Set(),
        expandedPaths: new Set(),
      });
    });
  });
});
