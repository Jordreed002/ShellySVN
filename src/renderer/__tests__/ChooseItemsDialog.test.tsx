import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

afterEach(() => {
  cleanup();
});

import type { LazyTreeNode } from '@shared/types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count, estimateSize }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * estimateSize(),
        size: estimateSize(),
        key: `item-${i}`,
      })),
    getTotalSize: () => count * estimateSize(),
  })),
}));

const createMockRoots = (): LazyTreeNode[] => [
  {
    path: '/trunk',
    name: 'trunk',
    kind: 'dir',
    isLoading: false,
    isLoaded: true,
    hasChildren: true,
    children: [
      {
        path: '/trunk/src',
        name: 'src',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        hasChildren: true,
        children: [
          {
            path: '/trunk/src/index.ts',
            name: 'index.ts',
            kind: 'file',
            isLoading: false,
            isLoaded: true,
            hasChildren: false,
            children: [],
          },
          {
            path: '/trunk/src/utils.ts',
            name: 'utils.ts',
            kind: 'file',
            isLoading: false,
            isLoaded: true,
            hasChildren: false,
            children: [],
          },
        ],
      },
      {
        path: '/trunk/README.md',
        name: 'README.md',
        kind: 'file',
        isLoading: false,
        isLoaded: true,
        hasChildren: false,
        children: [],
      },
    ],
  },
];

const createMockNodes = (): Map<string, LazyTreeNode> => {
  const nodes = new Map<string, LazyTreeNode>();
  const roots = createMockRoots();
  roots.forEach((root) => {
    nodes.set(root.path, root);
    if (root.children) {
      root.children.forEach((child) => {
        nodes.set(child.path, child);
        if (child.children) {
          child.children.forEach((grandchild) => {
            nodes.set(grandchild.path, grandchild);
          });
        }
      });
    }
  });
  return nodes;
};

const mockHookState: {
  loadNode: ReturnType<typeof vi.fn>;
  refreshTree: ReturnType<typeof vi.fn>;
  isLoading: boolean;
  error: string | undefined;
  nodes: Map<string, LazyTreeNode>;
  roots: LazyTreeNode[];
  isNodeLoading: ReturnType<typeof vi.fn>;
  getNodeError: ReturnType<typeof vi.fn>;
} = {
  loadNode: vi.fn(),
  refreshTree: vi.fn(),
  isLoading: false,
  error: undefined,
  nodes: createMockNodes(),
  roots: createMockRoots(),
  isNodeLoading: vi.fn().mockReturnValue(false),
  getNodeError: vi.fn().mockReturnValue(undefined),
};

vi.mock('@renderer/hooks/useLazyTreeLoader', () => ({
  useLazyTreeLoader: vi.fn(() => mockHookState),
}));

import { ChooseItemsDialog } from '../src/components/ui/ChooseItemsDialog';

const defaultProps = {
  isOpen: true,
  repoUrl: 'svn://example.com/repo/trunk',
  onSelect: vi.fn(),
  onCancel: vi.fn(),
};

describe('ChooseItemsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookState.isLoading = false;
    mockHookState.error = undefined;
    mockHookState.nodes = createMockNodes();
    mockHookState.roots = createMockRoots();
  });

  describe('rendering', () => {
    it('renders when isOpen is true', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      render(<ChooseItemsDialog {...defaultProps} isOpen={false} />);
      expect(screen.queryByText('Choose Items to Checkout')).not.toBeInTheDocument();
    });

    it('displays repository URL', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText(/svn:\/\/example.com\/repo\/trunk/)).toBeInTheDocument();
    });

    it('renders search input', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByPlaceholderText('Search files and folders...')).toBeInTheDocument();
    });

    it('renders Select All and Deselect All buttons', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Select All')).toBeInTheDocument();
      expect(screen.getByText('Deselect All')).toBeInTheDocument();
    });

    it('renders Cancel and Select buttons in footer', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('uses custom title when provided', () => {
      render(<ChooseItemsDialog {...defaultProps} title="Custom Title" />);
      expect(screen.getByText('Custom Title')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('Select All button selects all items', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('Select All'));
      expect(screen.getByText(/5 items selected/)).toBeInTheDocument();
    });

    it('Deselect All button clears selection', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('Select All'));
      expect(screen.getByText(/5 items selected/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Deselect All'));
      expect(screen.queryByText(/items selected/)).not.toBeInTheDocument();
    });

    it('Select button is disabled when no items selected', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      const selectButton = screen.getByRole('button', { name: /Select \(0\)/ });
      expect(selectButton).toBeDisabled();
    });

    it('Select button is enabled when items are selected', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('Select All'));
      const selectButton = screen.getByRole('button', { name: /Select \(5\)/ });
      expect(selectButton).not.toBeDisabled();
    });

    it('calls onSelect with selected paths when confirmed', () => {
      const onSelect = vi.fn();
      render(<ChooseItemsDialog {...defaultProps} onSelect={onSelect} />);
      fireEvent.click(screen.getByText('Select All'));
      const selectButton = screen.getByRole('button', { name: /Select \(5\)/ });
      fireEvent.click(selectButton);
      expect(onSelect).toHaveBeenCalled();
      const selectedPaths = onSelect.mock.calls[0][0];
      expect(selectedPaths.length).toBe(5);
      expect(selectedPaths).toContain('/trunk');
    });
  });

  describe('search', () => {
    it('filters tree nodes based on search query', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      const searchInput = screen.getByPlaceholderText('Search files and folders...');
      fireEvent.change(searchInput, { target: { value: 'README' } });
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    it('shows empty message when no matches found', () => {
      render(<ChooseItemsDialog {...defaultProps} />);
      const searchInput = screen.getByPlaceholderText('Search files and folders...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent-file-xyz' } });
      expect(screen.getByText('No matching files or folders')).toBeInTheDocument();
    });
  });

  describe('cancel behavior', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ChooseItemsDialog {...defaultProps} onCancel={onCancel} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalled();
    });

    it('calls onCancel when clicking overlay', () => {
      const onCancel = vi.fn();
      render(<ChooseItemsDialog {...defaultProps} onCancel={onCancel} />);
      const overlay = document.querySelector('.modal-overlay');
      if (overlay) {
        fireEvent.click(overlay);
      }
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('shows loading state when isLoading is true and roots are empty', () => {
      mockHookState.isLoading = true;
      mockHookState.roots = [];
      mockHookState.nodes = new Map();
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Loading repository structure...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error message and Retry button when error is present', () => {
      mockHookState.error = 'Failed to load repository';
      mockHookState.roots = [];
      mockHookState.nodes = new Map();
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('calls refreshTree when Retry is clicked', () => {
      mockHookState.error = 'Failed to load repository';
      mockHookState.roots = [];
      mockHookState.nodes = new Map();
      render(<ChooseItemsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(mockHookState.refreshTree).toHaveBeenCalled();
    });
  });

  describe('empty repository', () => {
    it('shows empty message when repository has no items', () => {
      mockHookState.roots = [];
      mockHookState.nodes = new Map();
      render(<ChooseItemsDialog {...defaultProps} />);
      expect(screen.getByText('Repository is empty')).toBeInTheDocument();
    });
  });
});
