import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { VirtualizedTree, VirtualizedFileList, type TreeNode } from '../VirtualizedList';
import type { SvnStatusChar, SvnStatusEntry } from '@shared/types';

/**
 * Scroll-stability tests for the virtualized tree/list (backlog #39).
 *
 * These run against the real @tanstack/react-virtual (no mock). jsdom has no
 * layout engine, so:
 *  - the scroll container's `offsetHeight` is stubbed to a fixed viewport
 *    height (TanStack reads it via getRect on mount);
 *  - `scrollTop` never clamps and never fires `scroll` events, so tests set
 *    it explicitly and dispatch the event manually, mirroring what a real
 *    browser does automatically.
 */

const VIEWPORT_HEIGHT = 400;
const TREE_ROW_HEIGHT = 28;
const LIST_ROW_HEIGHT = 32;
const EXPANDED_ROOT = new Set(['/root']);

let offsetHeightSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      // Both virtualized components use `overflow-auto` on their scroll
      // container; everything else reports no layout box.
      return this.className.includes('overflow-auto') ? VIEWPORT_HEIGHT : 0;
    });
});

afterEach(() => {
  offsetHeightSpy.mockRestore();
});

function getScrollContainer(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.overflow-auto');
  if (!el) {
    throw new Error('Scroll container not found');
  }
  return el;
}

function parseTranslateY(row: HTMLElement): number {
  const match = /translateY\(([\d.]+)px\)/.exec(row.style.transform);
  return match ? Number(match[1]) : 0;
}

/** First row whose box crosses the top of the viewport (overscan rows excluded). */
function getRowAtViewportTop(scrollEl: HTMLElement): HTMLElement {
  const inner = scrollEl.firstElementChild;
  if (!inner) {
    throw new Error('Virtualized inner container not found');
  }
  const rows = Array.from(inner.children) as HTMLElement[];
  const scrollTop = scrollEl.scrollTop;
  return (
    rows.find((row) => {
      const size = parseFloat(row.style.height) || TREE_ROW_HEIGHT;
      return parseTranslateY(row) + size > scrollTop;
    }) ?? rows[0]
  );
}

function scrollToOffset(scrollEl: HTMLElement, offset: number) {
  act(() => {
    scrollEl.scrollTop = offset;
    fireEvent.scroll(scrollEl);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface TreeFileSpec {
  name: string;
  status?: SvnStatusChar;
}

function makeTreeNodes(files: TreeFileSpec[]): TreeNode[] {
  return [
    {
      id: '/root',
      name: 'root',
      path: '/root',
      isDirectory: true,
      children: files.map((file) => ({
        id: `/root/${file.name}`,
        name: file.name,
        path: `/root/${file.name}`,
        isDirectory: false,
        status: file.status,
      })),
    },
  ];
}

function treeFiles(count: number): TreeFileSpec[] {
  return Array.from({ length: count }, (_, index) => ({ name: `file-${index}.ts` }));
}

function TreeScene({ nodes }: { nodes: TreeNode[] }) {
  return (
    <div style={{ height: VIEWPORT_HEIGHT, width: 600 }}>
      <VirtualizedTree
        nodes={nodes}
        expandedPaths={EXPANDED_ROOT}
        estimatedRowHeight={TREE_ROW_HEIGHT}
      />
    </div>
  );
}

function makeEntry(index: number, status: SvnStatusChar = ' '): SvnStatusEntry {
  return {
    path: `/repo/file-${index}.ts`,
    status,
    revision: 1000 + index,
    author: `author-${index % 5}`,
    date: '2026-04-30T10:00:00.000Z',
    isDirectory: false,
  };
}

function makeEntries(count: number): SvnStatusEntry[] {
  return Array.from({ length: count }, (_, index) => makeEntry(index));
}

function FileListScene({ files }: { files: SvnStatusEntry[] }) {
  return (
    <div style={{ height: VIEWPORT_HEIGHT, width: 600 }}>
      <VirtualizedFileList files={files} estimatedRowHeight={LIST_ROW_HEIGHT} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VirtualizedTree
// ---------------------------------------------------------------------------

describe('VirtualizedTree scroll stability across data refreshes', () => {
  it('keeps scroll offset and visible rows when statuses refresh with new object identities', () => {
    // 1 root + 200 files => 201 rows * 28px = 5628px total.
    const initial = makeTreeNodes(treeFiles(200));
    const { rerender } = render(<TreeScene nodes={initial} />);

    const scrollEl = getScrollContainer();
    scrollToOffset(scrollEl, 710);

    // Row 25 (file-24.ts) starts at 700 => anchored with a 10px sub-row offset.
    const topRowBefore = getRowAtViewportTop(scrollEl);
    expect(topRowBefore.textContent).toContain('file-24.ts');
    expect(scrollEl.scrollTop).toBe(710);

    // Status refresh: same paths/order, brand-new objects, changed statuses.
    const refreshed = makeTreeNodes(
      treeFiles(200).map((file, index) =>
        index === 24 ? { ...file, status: 'M' as const } : { ...file }
      )
    );
    rerender(<TreeScene nodes={refreshed} />);
    // jsdom does not dispatch scroll events for programmatic scrollTop changes.
    fireEvent.scroll(scrollEl);

    expect(scrollEl.scrollTop).toBe(710);
    const topRowAfter = getRowAtViewportTop(scrollEl);
    expect(topRowAfter.textContent).toContain('file-24.ts');
    expect(topRowAfter.textContent).toContain('M');
  });

  it('compensates for rows removed above the viewport', () => {
    const initial = makeTreeNodes(treeFiles(200));
    const { rerender } = render(<TreeScene nodes={initial} />);

    const scrollEl = getScrollContainer();
    scrollToOffset(scrollEl, 710);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-24.ts');

    // 10 rows above the viewport disappear (fresh identities for the rest).
    const afterRemoval = makeTreeNodes(treeFiles(200).slice(10));
    rerender(<TreeScene nodes={afterRemoval} />);
    fireEvent.scroll(scrollEl);

    // Anchor (file-24.ts, previously starting at 700) now starts at 420.
    // scrollTop follows by 10 * 28 so the same row stays under the user.
    expect(scrollEl.scrollTop).toBe(710 - 10 * TREE_ROW_HEIGHT);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-24.ts');
  });

  it('compensates for rows inserted above the viewport', () => {
    const initial = makeTreeNodes(treeFiles(200));
    const { rerender } = render(<TreeScene nodes={initial} />);

    const scrollEl = getScrollContainer();
    scrollToOffset(scrollEl, 710);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-24.ts');

    const inserted: TreeFileSpec[] = Array.from({ length: 10 }, (_, i) => ({
      name: `new-${i}.ts`,
    }));
    const afterInsertion = makeTreeNodes([...inserted, ...treeFiles(200)]);
    rerender(<TreeScene nodes={afterInsertion} />);
    fireEvent.scroll(scrollEl);

    expect(scrollEl.scrollTop).toBe(710 + 10 * TREE_ROW_HEIGHT);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-24.ts');
  });

  it('pins a surviving row when a refresh collapses the list while scrolled near the bottom', () => {
    const initial = makeTreeNodes(treeFiles(200));
    const { rerender } = render(<TreeScene nodes={initial} />);

    const scrollEl = getScrollContainer();
    // Max scroll offset for 201 rows: 201*28 - 400 = 5228.
    scrollToOffset(scrollEl, 5228);
    // Row 186 (file-185.ts) starts at 5208 => anchored with a 20px offset.
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-185.ts');

    // A root refresh drops lazily loaded children: 100 rows above vanish.
    const collapsed = makeTreeNodes(treeFiles(200).slice(100));
    rerender(<TreeScene nodes={collapsed} />);
    fireEvent.scroll(scrollEl);

    // file-185.ts now starts at 2408; 2408 + 20 = 2428 which is exactly the
    // new max scroll offset (101*28 - 400), so a real browser ends up here
    // without clamping and the anchored row stays visible.
    expect(scrollEl.scrollTop).toBe(2428);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-185.ts');
  });
});

// ---------------------------------------------------------------------------
// VirtualizedFileList
// ---------------------------------------------------------------------------

describe('VirtualizedFileList scroll stability across status refreshes', () => {
  it('keeps scroll offset and renders refreshed statuses for the same paths', () => {
    const initial = makeEntries(300);
    const { rerender } = render(<FileListScene files={initial} />);

    const scrollEl = getScrollContainer();
    // 644 / 32 => row 20 (file-20.ts) starts at 640, anchored 4px in.
    scrollToOffset(scrollEl, 644);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-20.ts');

    const refreshed = initial.map((entry, index) =>
      index === 20 ? { ...entry, status: 'M' as SvnStatusChar, revision: 424242 } : { ...entry }
    );
    rerender(<FileListScene files={refreshed} />);
    fireEvent.scroll(scrollEl);

    expect(scrollEl.scrollTop).toBe(644);
    const topRow = getRowAtViewportTop(scrollEl);
    expect(topRow.textContent).toContain('file-20.ts');
    expect(topRow.textContent).toContain('M');
  });

  it('compensates for entries removed above the viewport', () => {
    const initial = makeEntries(300);
    const { rerender } = render(<FileListScene files={initial} />);

    const scrollEl = getScrollContainer();
    scrollToOffset(scrollEl, 644);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-20.ts');

    const afterRemoval = initial.slice(5).map((entry) => ({ ...entry }));
    rerender(<FileListScene files={afterRemoval} />);
    fireEvent.scroll(scrollEl);

    expect(scrollEl.scrollTop).toBe(644 - 5 * LIST_ROW_HEIGHT);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-20.ts');
  });

  it('compensates for entries inserted above the viewport', () => {
    const initial = makeEntries(300);
    const { rerender } = render(<FileListScene files={initial} />);

    const scrollEl = getScrollContainer();
    scrollToOffset(scrollEl, 644);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-20.ts');

    const inserted = Array.from({ length: 5 }, (_, i) => makeEntry(1000 + i));
    const afterInsertion = [...inserted, ...initial.map((entry) => ({ ...entry }))];
    rerender(<FileListScene files={afterInsertion} />);
    fireEvent.scroll(scrollEl);

    expect(scrollEl.scrollTop).toBe(644 + 5 * LIST_ROW_HEIGHT);
    expect(getRowAtViewportTop(scrollEl).textContent).toContain('file-20.ts');
  });
});
