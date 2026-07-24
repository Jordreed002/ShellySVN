import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

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

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ url: '' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { defaultCheckoutDirectory: '/default/path' } }),
}));

vi.mock('@renderer/hooks/useWorkingCopyContext', () => ({
  useWorkingCopyContext: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('@renderer/utils/pathResolution', () => ({
  resolveRemoteUrlToLocalPath: vi.fn(),
}));

const createMockNodes = (): Map<string, LazyTreeNode> => {
  const nodes = new Map<string, LazyTreeNode>();
  nodes.set('/trunk', {
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
            path: '/trunk/src/main.ts',
            name: 'main.ts',
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
  });
  return nodes;
};

// Shared mutable mock state - this allows beforeEach to modify it
const mockHookState: {
  loadNode: ReturnType<typeof vi.fn>;
  refreshTree: ReturnType<typeof vi.fn>;
  clearNodeError: ReturnType<typeof vi.fn>;
  isLoading: boolean;
  error: string | undefined;
  nodes: Map<string, LazyTreeNode>;
  roots: LazyTreeNode[];
  isNodeLoading: ReturnType<typeof vi.fn>;
} = {
  loadNode: vi.fn().mockResolvedValue(undefined),
  refreshTree: vi.fn(),
  clearNodeError: vi.fn(),
  isLoading: false,
  error: undefined,
  nodes: createMockNodes(),
  roots: [createMockNodes().get('/trunk')] as LazyTreeNode[],
  isNodeLoading: vi.fn().mockReturnValue(false),
};

vi.mock('@renderer/hooks/useLazyTreeLoader', () => ({
  useLazyTreeLoader: vi.fn(() => mockHookState),
}));

import { ChooseItemsDialog } from '../../src/components/ui/ChooseItemsDialog';

afterEach(cleanup);

describe('ChooseItemsDialog Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookState.isLoading = false;
    mockHookState.error = undefined;
    mockHookState.nodes = createMockNodes();
    mockHookState.roots = [createMockNodes().get('/trunk')] as LazyTreeNode[];
  });

  it('renders and allows selection', () => {
    const onSelect = vi.fn();
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/items selected/)).toBeInTheDocument();

    const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ });
    fireEvent.click(selectButton);

    expect(onSelect).toHaveBeenCalled();
  });

  it('cancels selection', () => {
    const onCancel = vi.fn();
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('deselects all items', () => {
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/items selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Deselect All'));
    expect(screen.queryByText(/items selected/)).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockHookState.isLoading = true;
    mockHookState.roots = [];
    mockHookState.nodes = new Map();

    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Loading repository structure...')).toBeInTheDocument();
  });

  it('shows error state with Try Again button', () => {
    mockHookState.error = 'Failed to load';
    mockHookState.roots = [];
    mockHookState.nodes = new Map();

    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // The component shows "Try Again" button (not "Retry")
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try Again'));
    // Note: refreshTree is called via setTimeout in the component
  });

  it('filters items by search query', () => {
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search files and folders...');
    fireEvent.change(searchInput, { target: { value: 'README' } });
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('shows no matches message for empty search', () => {
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search files and folders...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No matching files or folders')).toBeInTheDocument();
  });

  it('uses custom title', () => {
    render(
      <ChooseItemsDialog
        isOpen={true}
        repoUrl="https://svn.example.com/repo/trunk"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        title="Custom Title"
      />
    );

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });
});
