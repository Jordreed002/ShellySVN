import { renderHook, act } from '@testing-library/react';
import { useLazyTreeLoader } from '../src/hooks/useLazyTreeLoader';
import type { SvnListResult } from '../../shared/types';

const mockSvnList = vi.fn();
const mockQueryClient = {
  invalidateQueries: vi.fn(),
  prefetchQuery: vi.fn(),
  setQueryData: vi.fn(),
};

beforeEach(() => {
  global.document = {
    createElement: vi.fn(),
    getElementById: vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    head: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  } as any;

  global.window = {
    api: {
      svn: {
        list: mockSvnList,
      },
    },
  } as any;

  global.navigator = {
    userAgent: 'test',
  } as any;

  global.MutationObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));
});

// Mock TanStack Query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options) => {
    const { queryKey, _queryFn } = options;

    if (queryKey[0] === 'svn:tree' && queryKey[1] === 'test-url') {
      // Mock successful root load
      const mockResult: SvnListResult = {
        path: 'test-url',
        entries: [
          {
            name: 'folder1',
            path: 'test-url/folder1',
            url: 'test-url/folder1',
            kind: 'dir',
            revision: 1,
            author: 'test',
            date: '2023-01-01',
          },
          {
            name: 'file1.txt',
            path: 'test-url/file1.txt',
            url: 'test-url/file1.txt',
            kind: 'file',
            size: 100,
            revision: 1,
            author: 'test',
            date: '2023-01-01',
          },
        ],
      };

      return {
        data: {
          path: 'test-url',
          nodes: [
            {
              path: 'test-url/folder1',
              name: 'folder1',
              kind: 'dir',
              isLoading: false,
              isLoaded: true,
              children: [],
              hasChildren: true,
              status: undefined,
            },
            {
              path: 'test-url/file1.txt',
              name: 'file1.txt',
              kind: 'file',
              isLoading: false,
              isLoaded: true,
              children: [],
              hasChildren: false,
              status: undefined,
            },
          ],
          result: mockResult,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    return {
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  }),

  useQueryClient: () => mockQueryClient,

  useMutation: vi.fn((options) => ({
    mutateAsync: options.mutationFn,
    isPending: false,
    error: null,
  })),
}));

describe('useLazyTreeLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.nodes).toBeInstanceOf(Map);
    expect(result.current.roots).toEqual([]);
    expect(result.current.selection).toEqual({
      selectedPaths: new Set(),
      expandedPaths: new Set(),
    });
  });

  it('should load root tree successfully', () => {
    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    expect(result.current.roots).toHaveLength(2);
    expect(result.current.nodes.size).toBe(2);

    const folderNode = result.current.nodes.get('test-url/folder1');
    expect(folderNode?.name).toBe('folder1');
    expect(folderNode?.kind).toBe('dir');
    expect(folderNode?.hasChildren).toBe(true);

    const fileNode = result.current.nodes.get('test-url/file1.txt');
    expect(fileNode?.name).toBe('file1.txt');
    expect(fileNode?.kind).toBe('file');
    expect(fileNode?.hasChildren).toBe(false);
  });

  it('should handle loading errors gracefully', async () => {
    mockSvnList.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    await act(async () => {
      await result.current.loadNode('non-existent-path');
    });

    expect(result.current.getNodeError('non-existent-path')).toBe('Network error');
  });

  it('should refresh tree correctly', () => {
    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    act(() => {
      result.current.refreshTree();
    });

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['svn:tree', 'test-url', undefined],
    });
  });

  it('should clear node errors', () => {
    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    act(() => {
      result.current.clearNodeError('test-path');
    });

    expect(result.current.getNodeError('test-path')).toBeUndefined();
  });

  it('should check if node is loading', () => {
    const { result } = renderHook(() => useLazyTreeLoader('test-url'));

    expect(result.current.isNodeLoading('test-path')).toBe(false);
  });

  it('should handle empty repository', () => {
    mockSvnList.mockResolvedValueOnce({
      path: 'empty-url',
      entries: [],
    });

    const { result } = renderHook(() => useLazyTreeLoader('empty-url'));

    expect(result.current.roots).toEqual([]);
    expect(result.current.nodes.size).toBe(0);
  });
});
