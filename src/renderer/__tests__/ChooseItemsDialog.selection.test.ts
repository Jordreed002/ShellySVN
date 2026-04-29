import { describe, expect, it } from 'vitest';
import type { LazyTreeNode } from '@shared/types';

import { countSelectedFiles } from '../src/components/ui/ChooseItemsDialog';

const fileNode = (path: string): LazyTreeNode => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'file',
  isLoading: false,
  isLoaded: true,
  children: [],
  hasChildren: false,
});

const dirNode = (path: string, children: LazyTreeNode[]): LazyTreeNode => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'dir',
  isLoading: false,
  isLoaded: true,
  children,
  hasChildren: children.length > 0,
});

describe('countSelectedFiles', () => {
  it('counts nested selected files from roots without double-counting map entries', () => {
    const tree = [
      dirNode('/root', [
        dirNode('/root/src', [fileNode('/root/src/a.ts'), fileNode('/root/src/b.ts')]),
        fileNode('/root/README.md'),
      ]),
    ];

    expect(countSelectedFiles(tree, new Set(['/root/src']))).toBe(2);
    expect(countSelectedFiles(tree, new Set(['/root']))).toBe(3);
    expect(countSelectedFiles(tree, new Set(['/root/src', '/root/src/a.ts']))).toBe(2);
  });
});
