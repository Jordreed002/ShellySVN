import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

import {
  VirtualizedTree,
  type TreeNode,
  type CheckboxSelectionProps,
} from '../src/components/ui/VirtualizedList';

const createTestTree = (): TreeNode[] => [
  {
    id: 'root',
    name: 'root',
    path: '/root',
    isDirectory: true,
    children: [
      {
        id: 'src',
        name: 'src',
        path: '/root/src',
        isDirectory: true,
        children: [
          { id: 'file1', name: 'file1.ts', path: '/root/src/file1.ts', isDirectory: false },
          { id: 'file2', name: 'file2.ts', path: '/root/src/file2.ts', isDirectory: false },
        ],
      },
      {
        id: 'lib',
        name: 'lib',
        path: '/root/lib',
        isDirectory: true,
        children: [
          { id: 'file3', name: 'file3.ts', path: '/root/lib/file3.ts', isDirectory: false },
        ],
      },
      { id: 'readme', name: 'README.md', path: '/root/README.md', isDirectory: false },
    ],
  },
];

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

const renderTreeWithCheckboxes = (
  selectedKeys: Set<string>,
  onSelectionChange: (keys: Set<string>) => void,
  expandedPaths?: Set<string>
) => {
  const checkboxSelection: CheckboxSelectionProps = {
    selectedKeys,
    onSelectionChange,
  };

  return render(
    <div style={{ height: '400px', width: '600px' }}>
      <VirtualizedTree
        nodes={createTestTree()}
        expandedPaths={expandedPaths ?? new Set(['/root', '/root/src', '/root/lib'])}
        checkboxSelection={checkboxSelection}
      />
    </div>
  );
};

describe('VirtualizedTree Checkbox Selection', () => {
  describe('basic selection', () => {
    it('selecting a leaf node updates selectedKeys', () => {
      const onSelectionChange = vi.fn();
      const selectedKeys = new Set<string>();

      renderTreeWithCheckboxes(selectedKeys, onSelectionChange);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      expect(onSelectionChange).toHaveBeenCalled();
      const newSelection = onSelectionChange.mock.calls[0][0];
      expect(newSelection.size).toBeGreaterThan(0);
    });

    it('deselecting a node removes it from selectedKeys', () => {
      const onSelectionChange = vi.fn();
      const allPaths = [
        '/root',
        '/root/src',
        '/root/lib',
        '/root/src/file1.ts',
        '/root/src/file2.ts',
        '/root/lib/file3.ts',
        '/root/README.md',
      ];
      const selectedKeys = new Set(allPaths);

      renderTreeWithCheckboxes(selectedKeys, onSelectionChange);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      expect(onSelectionChange).toHaveBeenCalled();
      const newSelection = onSelectionChange.mock.calls[0][0];
      expect(newSelection.size).toBe(0);
    });
  });

  describe('parent-child selection', () => {
    it('selecting parent directory selects all children', () => {
      const onSelectionChange = vi.fn();
      const selectedKeys = new Set<string>();
      const allExpanded = new Set(['/root', '/root/src']);

      renderTreeWithCheckboxes(selectedKeys, onSelectionChange, allExpanded);

      const checkboxes = screen.getAllByRole('checkbox');
      const srcCheckbox =
        checkboxes.find((cb) => cb.closest('div')?.textContent?.includes('src')) ?? checkboxes[1];

      fireEvent.click(srcCheckbox);

      expect(onSelectionChange).toHaveBeenCalled();
      const newSelection = onSelectionChange.mock.calls[0][0];

      expect(newSelection.has('/root/src')).toBe(true);
      expect(newSelection.has('/root/src/file1.ts')).toBe(true);
      expect(newSelection.has('/root/src/file2.ts')).toBe(true);
    });

    it('selecting root selects entire tree', () => {
      const onSelectionChange = vi.fn();
      const selectedKeys = new Set<string>();
      const allExpanded = new Set(['/root', '/root/src', '/root/lib']);

      renderTreeWithCheckboxes(selectedKeys, onSelectionChange, allExpanded);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      expect(onSelectionChange).toHaveBeenCalled();
      const newSelection = onSelectionChange.mock.calls[0][0];

      expect(newSelection.has('/root')).toBe(true);
      expect(newSelection.has('/root/src')).toBe(true);
      expect(newSelection.has('/root/lib')).toBe(true);
      expect(newSelection.has('/root/src/file1.ts')).toBe(true);
      expect(newSelection.has('/root/src/file2.ts')).toBe(true);
      expect(newSelection.has('/root/lib/file3.ts')).toBe(true);
      expect(newSelection.has('/root/README.md')).toBe(true);
      expect(newSelection.size).toBe(7);
    });
  });

  describe('indeterminate state', () => {
    it('parent shows indeterminate when some children selected', () => {
      const selectedKeys = new Set(['/root/src/file1.ts']);
      const allExpanded = new Set(['/root', '/root/src', '/root/lib']);

      renderTreeWithCheckboxes(selectedKeys, vi.fn(), allExpanded);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const srcCheckbox = checkboxes.find((cb) =>
        cb.closest('div')?.textContent?.includes('src')
      ) as HTMLInputElement;

      expect(srcCheckbox?.indeterminate).toBe(true);
    });

    it('parent shows checked when all children selected', () => {
      const selectedKeys = new Set(['/root/src/file1.ts', '/root/src/file2.ts']);
      const allExpanded = new Set(['/root', '/root/src']);

      renderTreeWithCheckboxes(selectedKeys, vi.fn(), allExpanded);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const srcCheckbox = checkboxes.find((cb) =>
        cb.closest('div')?.textContent?.includes('src')
      ) as HTMLInputElement;

      expect(srcCheckbox?.checked).toBe(true);
      expect(srcCheckbox?.indeterminate).toBe(false);
    });

    it('parent shows unchecked when no children selected', () => {
      const selectedKeys = new Set<string>();
      const allExpanded = new Set(['/root', '/root/src']);

      renderTreeWithCheckboxes(selectedKeys, vi.fn(), allExpanded);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const srcCheckbox = checkboxes.find((cb) =>
        cb.closest('div')?.textContent?.includes('src')
      ) as HTMLInputElement;

      expect(srcCheckbox?.checked).toBe(false);
      expect(srcCheckbox?.indeterminate).toBe(false);
    });

    it('clicking indeterminate parent deselects all children', () => {
      const onSelectionChange = vi.fn();
      const selectedKeys = new Set(['/root/src/file1.ts']);
      const allExpanded = new Set(['/root', '/root/src']);

      renderTreeWithCheckboxes(selectedKeys, onSelectionChange, allExpanded);

      const checkboxes = screen.getAllByRole('checkbox');
      const srcCheckbox =
        checkboxes.find((cb) => cb.closest('div')?.textContent?.includes('src')) ?? checkboxes[1];

      fireEvent.click(srcCheckbox);

      expect(onSelectionChange).toHaveBeenCalled();
      const newSelection = onSelectionChange.mock.calls[0][0];
      expect(newSelection.size).toBe(0);
    });
  });

  describe('custom checkbox renderer', () => {
    it('uses custom renderCheckbox when provided', () => {
      const customRenderer = vi.fn(({ checked, onChange, node }) => (
        <button
          type="button"
          data-testid={`custom-${node.path}`}
          data-checked={String(checked)}
          onClick={onChange}
        >
          {checked === 'true' ? '☑' : checked === 'indeterminate' ? '⊡' : '☐'}
        </button>
      ));

      const selectedKeys = new Set<string>();

      render(
        <div style={{ height: '400px', width: '600px' }}>
          <VirtualizedTree
            nodes={createTestTree()}
            expandedPaths={new Set(['/root'])}
            checkboxSelection={{
              selectedKeys,
              onSelectionChange: vi.fn(),
              renderCheckbox: customRenderer,
            }}
          />
        </div>
      );

      expect(customRenderer).toHaveBeenCalled();
      expect(screen.getByTestId('custom-/root')).toBeInTheDocument();
    });
  });

  describe('without checkboxSelection prop', () => {
    it('renders without checkboxes when checkboxSelection not provided', () => {
      render(
        <div style={{ height: '400px', width: '600px' }}>
          <VirtualizedTree nodes={createTestTree()} expandedPaths={new Set(['/root'])} />
        </div>
      );

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });
});
