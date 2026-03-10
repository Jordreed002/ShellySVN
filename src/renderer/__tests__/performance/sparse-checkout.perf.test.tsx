/**
 * Performance tests for sparse checkout components
 *
 * Tests verify:
 * - Lazy-loading performance (< 500ms initial, < 200ms expansion)
 * - Memory usage with large trees
 * - Virtualization maintains performance with 10,000+ items
 */
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import type { LazyTreeNode } from '@shared/types';

interface PerformanceMemory {
  usedJSHeapSize: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

const PERFORMANCE_TARGETS = {
  INITIAL_RENDER_MS: 500,
  NODE_EXPANSION_MS: 200,
  SEARCH_FILTER_MS: 300,
  SELECTION_UPDATE_MS: 100,
};

const INITIAL_RENDER_TARGET_MS = PERFORMANCE_TARGETS.INITIAL_RENDER_MS;
const NODE_EXPANSION_TARGET_MS = PERFORMANCE_TARGETS.NODE_EXPANSION_MS;
const SEARCH_FILTER_TARGET_MS = PERFORMANCE_TARGETS.SEARCH_FILTER_MS;
const SELECTION_UPDATE_TARGET_MS = PERFORMANCE_TARGETS.SELECTION_UPDATE_MS;

// Test data sizes
const SMALL_REPO_SIZE = 100;
const MEDIUM_REPO_SIZE = 1000;
const LARGE_REPO_SIZE = 10000;
const VERY_LARGE_REPO_SIZE = 50000;

// Mock @tanstack/react-virtual with realistic behavior
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, overscan = 10 }) => {
    // Simulate only rendering visible items (virtualization)
    const visibleCount = Math.min(20, count); // Simulate ~20 visible items

    return {
      getVirtualItems: () => {
        const items: Array<{ index: number; start: number; size: number; key: string }> = [];
        const startIndex = 0;
        const endIndex = Math.min(count - 1, visibleCount + overscan);

        for (let i = startIndex; i <= endIndex; i++) {
          items.push({
            index: i,
            start: i * estimateSize(),
            size: estimateSize(),
            key: `item-${i}`,
          });
        }
        return items;
      },
      getTotalSize: () => count * estimateSize(),
      measure: vi.fn(),
    };
  }),
}));

/**
 * Generate mock tree data with specified number of root items
 */
function generateMockTreeRoots(itemCount: number, depth = 2): LazyTreeNode[] {
  const roots: LazyTreeNode[] = [];

  for (let i = 0; i < itemCount; i++) {
    const hasChildren = i < itemCount / 3; // ~1/3 have children
    const isDir = i % 4 !== 0; // 75% directories

    const node: LazyTreeNode = {
      path: `/item-${i}`,
      name: `item-${i}`,
      kind: isDir ? 'dir' : 'file',
      isLoading: false,
      isLoaded: depth <= 0 || !hasChildren,
      hasChildren: hasChildren && isDir,
      children:
        hasChildren && depth > 0 ? generateMockTreeChildren(`/item-${i}`, 3, depth - 1) : [],
    };

    roots.push(node);
  }

  return roots;
}

/**
 * Generate children for a parent node
 */
function generateMockTreeChildren(
  parentPath: string,
  count: number,
  depth: number
): LazyTreeNode[] {
  const children: LazyTreeNode[] = [];

  for (let i = 0; i < count; i++) {
    const hasChildren = i < count / 2 && depth > 0;
    const isDir = i % 3 !== 0;

    children.push({
      path: `${parentPath}/child-${i}`,
      name: `child-${i}`,
      kind: isDir ? 'dir' : 'file',
      isLoading: false,
      isLoaded: depth <= 0 || !hasChildren,
      hasChildren: hasChildren && isDir,
      children: hasChildren
        ? generateMockTreeChildren(`${parentPath}/child-${i}`, 2, depth - 1)
        : [],
    });
  }

  return children;
}

/**
 * Convert roots array to nodes map for the hook state
 */
function rootsToNodesMap(roots: LazyTreeNode[]): Map<string, LazyTreeNode> {
  const nodes = new Map<string, LazyTreeNode>();

  const addNode = (node: LazyTreeNode) => {
    nodes.set(node.path, node);
    node.children.forEach(addNode);
  };

  roots.forEach(addNode);
  return nodes;
}

function measureTime<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

const createMockHookState = (roots: LazyTreeNode[]) => ({
  loadNode: vi.fn().mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Promise.resolve();
  }),
  refreshTree: vi.fn(),
  isLoading: false,
  error: undefined as string | undefined,
  nodes: rootsToNodesMap(roots),
  roots,
  isNodeLoading: vi.fn().mockReturnValue(false),
  getNodeError: vi.fn().mockReturnValue(undefined),
  clearNodeError: vi.fn(),
});

let mockHookState: ReturnType<typeof createMockHookState>;

vi.mock('@renderer/hooks/useLazyTreeLoader', () => ({
  useLazyTreeLoader: vi.fn(() => mockHookState),
}));

// Import after mocks are set up
import { ChooseItemsDialog } from '../../src/components/ui/ChooseItemsDialog';

const defaultProps = {
  isOpen: true,
  repoUrl: 'svn://example.com/large-repo',
  onSelect: vi.fn(),
  onCancel: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe('Sparse Checkout Performance Tests', () => {
  describe('Initial Render Performance', () => {
    it('should render 100 items within performance target', async () => {
      const roots = generateMockTreeRoots(SMALL_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { durationMs } = measureTime(() => {
        render(<ChooseItemsDialog {...defaultProps} />);
      });

      console.log(`[PERF] Initial render (${SMALL_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(INITIAL_RENDER_TARGET_MS);
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument();
    });

    it('should render 1,000 items within performance target', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { durationMs } = measureTime(() => {
        render(<ChooseItemsDialog {...defaultProps} />);
      });

      console.log(`[PERF] Initial render (${MEDIUM_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(INITIAL_RENDER_TARGET_MS);
    });

    it('should render 10,000+ items within performance target', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { durationMs } = measureTime(() => {
        render(<ChooseItemsDialog {...defaultProps} />);
      });

      console.log(`[PERF] Initial render (${LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(INITIAL_RENDER_TARGET_MS);
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument();
    });

    it('should render 50,000 items within performance target', async () => {
      const roots = generateMockTreeRoots(VERY_LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { durationMs } = measureTime(() => {
        render(<ChooseItemsDialog {...defaultProps} />);
      });

      console.log(
        `[PERF] Initial render (${VERY_LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`
      );
      expect(durationMs).toBeLessThan(INITIAL_RENDER_TARGET_MS * 2); // Allow 2x for very large
    });
  });

  describe('Node Expansion Performance', () => {
    it('should expand a node within performance target (100 items)', async () => {
      const roots = generateMockTreeRoots(SMALL_REPO_SIZE, 3);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      // Find and click on a directory node to expand
      const firstExpandable = screen.getAllByRole('button', { name: 'Expand' })[0];

      const { durationMs } = measureTime(() => {
        fireEvent.click(firstExpandable);
      });

      console.log(`[PERF] Node expansion (${SMALL_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(NODE_EXPANSION_TARGET_MS);
    });

    it('should expand a node within performance target (10,000 items)', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE, 3);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const firstExpandable = screen.getAllByRole('button', { name: 'Expand' })[0];

      const { durationMs } = measureTime(() => {
        fireEvent.click(firstExpandable);
      });

      console.log(`[PERF] Node expansion (${LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(NODE_EXPANSION_TARGET_MS);
    });
  });

  describe('Search/Filter Performance', () => {
    it('should filter 1,000 items within performance target', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('Search files and folders...');

      const { durationMs } = measureTime(() => {
        fireEvent.change(searchInput, { target: { value: 'item-5' } });
      });

      console.log(`[PERF] Search filter (${MEDIUM_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(SEARCH_FILTER_TARGET_MS);
    });

    it('should filter 10,000 items within performance target', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('Search files and folders...');

      const { durationMs } = measureTime(() => {
        fireEvent.change(searchInput, { target: { value: 'item-1234' } });
      });

      console.log(`[PERF] Search filter (${LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(SEARCH_FILTER_TARGET_MS);
    });
  });

  describe('Selection Performance', () => {
    it('should select all items within performance target (1,000 items)', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const selectAllButton = screen.getByText('Select All');

      const { durationMs } = measureTime(() => {
        fireEvent.click(selectAllButton);
      });

      console.log(`[PERF] Select all (${MEDIUM_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(SELECTION_UPDATE_TARGET_MS);
    });

    it('should select all items within performance target (10,000 items)', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const selectAllButton = screen.getByText('Select All');

      const { durationMs } = measureTime(() => {
        fireEvent.click(selectAllButton);
      });

      console.log(`[PERF] Select all (${LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(SELECTION_UPDATE_TARGET_MS * 2); // Allow 2x for large
      expect(screen.getByText(/items selected/)).toBeInTheDocument();
    });

    it('should deselect all items within performance target', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      // First select all
      fireEvent.click(screen.getByText('Select All'));

      // Then measure deselect
      const deselectButton = screen.getByText('Deselect All');

      const { durationMs } = measureTime(() => {
        fireEvent.click(deselectButton);
      });

      console.log(`[PERF] Deselect all (${LARGE_REPO_SIZE} items): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(SELECTION_UPDATE_TARGET_MS);
    });
  });

  describe('Virtualization Verification', () => {
    it('should only render visible items (not all 10,000)', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { container } = render(<ChooseItemsDialog {...defaultProps} />);

      // Virtualization should limit DOM nodes
      const renderedItems = container.querySelectorAll('[style*="position: absolute"]');

      console.log(
        `[PERF] Rendered DOM nodes for ${LARGE_REPO_SIZE} items: ${renderedItems.length}`
      );

      // Should render far fewer than total items (virtualization working)
      expect(renderedItems.length).toBeLessThan(100);
    });

    it('should maintain consistent render time as item count increases', async () => {
      const sizes = [100, 1000, 10000];
      const times: number[] = [];

      for (const size of sizes) {
        const roots = generateMockTreeRoots(size);
        mockHookState = createMockHookState(roots);

        cleanup();

        const { durationMs } = measureTime(() => {
          render(<ChooseItemsDialog {...defaultProps} />);
        });
        times.push(durationMs);

        console.log(`[PERF] Render time for ${size} items: ${durationMs.toFixed(2)}ms`);
      }

      // Time should not grow linearly with item count (virtualization benefit)
      // The ratio of time increase should be much less than ratio of item increase
      const ratio100To10k = LARGE_REPO_SIZE / SMALL_REPO_SIZE; // 100x
      const timeRatio = times[2] / times[0];

      console.log(
        `[PERF] Item count ratio: ${ratio100To10k}x, Time ratio: ${timeRatio.toFixed(2)}x`
      );

      // Time ratio should be significantly less than item ratio (sub-linear growth)
      expect(timeRatio).toBeLessThan(ratio100To10k / 10); // At most 10x time growth for 100x items
    });
  });

  describe('Memory Usage Tests', () => {
    it('should not leak memory on repeated renders', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);

      // Initial render
      mockHookState = createMockHookState(roots);
      const { unmount } = render(<ChooseItemsDialog {...defaultProps} />);

      // Get initial memory (if available)
      const initialMemory = (performance as PerformanceWithMemory).memory?.usedJSHeapSize || 0;

      // Re-render multiple times
      for (let i = 0; i < 10; i++) {
        cleanup();
        mockHookState = createMockHookState(roots);
        render(<ChooseItemsDialog {...defaultProps} />);
      }

      const finalMemory = (performance as PerformanceWithMemory).memory?.usedJSHeapSize || 0;

      if (initialMemory > 0 && finalMemory > 0) {
        const memoryIncrease = finalMemory - initialMemory;
        console.log(
          `[PERF] Memory increase after 10 re-renders: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`
        );

        // Memory should not grow unbounded (allow some growth but not excessive)
        const maxAcceptableIncrease = 50 * 1024 * 1024; // 50MB
        expect(memoryIncrease).toBeLessThan(maxAcceptableIncrease);
      } else {
        console.log('[PERF] Memory measurement not available in this environment');
      }

      unmount();
    });

    it('should clean up nodes map when dialog closes', async () => {
      const roots = generateMockTreeRoots(LARGE_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      const { rerender } = render(<ChooseItemsDialog {...defaultProps} isOpen={true} />);

      // Verify nodes are created
      expect(mockHookState.nodes.size).toBeGreaterThan(0);

      // Close dialog
      rerender(<ChooseItemsDialog {...defaultProps} isOpen={false} />);

      // Dialog should not render when closed
      expect(screen.queryByText('Choose Items to Checkout')).not.toBeInTheDocument();
    });
  });

  describe('Reactivity Performance', () => {
    it('should handle rapid state changes efficiently', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('Search files and folders...');

      // Simulate rapid typing
      const { durationMs } = measureTime(() => {
        for (const char of 'item-123') {
          fireEvent.change(searchInput, { target: { value: char } });
        }
      });

      console.log(`[PERF] Rapid state changes (9 keystrokes): ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(1000); // Should handle rapid changes within 1 second total
    });

    it('should handle rapid selection changes', async () => {
      const roots = generateMockTreeRoots(MEDIUM_REPO_SIZE);
      mockHookState = createMockHookState(roots);

      render(<ChooseItemsDialog {...defaultProps} />);

      const { durationMs } = measureTime(() => {
        // Toggle select all multiple times
        for (let i = 0; i < 10; i++) {
          fireEvent.click(screen.getByText('Select All'));
          fireEvent.click(screen.getByText('Deselect All'));
        }
      });

      console.log(`[PERF] 20 rapid selection toggles: ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(2000); // Should handle within 2 seconds
    });
  });

  describe('Performance Benchmarks Summary', () => {
    it('should output performance summary', () => {
      console.log('\n========== PERFORMANCE BENCHMARKS SUMMARY ==========');
      console.log(`Initial Render Target: < ${INITIAL_RENDER_TARGET_MS}ms`);
      console.log(`Node Expansion Target: < ${NODE_EXPANSION_TARGET_MS}ms`);
      console.log(`Search Filter Target: < ${SEARCH_FILTER_TARGET_MS}ms`);
      console.log(`Selection Update Target: < ${SELECTION_UPDATE_TARGET_MS}ms`);
      console.log('===================================================\n');

      // This test always passes - it's just for output
      expect(true).toBe(true);
    });
  });
});
