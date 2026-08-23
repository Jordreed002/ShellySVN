/**
 * Drag-and-drop and multi-select for the repository browser (#68), exercised
 * against the real components with jsdom drag events.
 *
 * jsdom has no drag-and-drop implementation — no `DragEvent` constructor, no
 * clipboard — so a Map-backed `dataTransfer` stub rides along on every fired
 * event, exactly the surface `lib/repoDragDrop` reads and writes.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { RepoEntry, RepoSort } from '../types';
import { RepoContents } from '../components/RepoContents';
import { RepoTree } from '../components/RepoTree';
import {
  endRepoDrag,
  getDraggingRepoPaths,
  REPO_DRAG_MIME,
  writeRepoDragData,
} from '../lib/repoDragDrop';

function makeDataTransfer(): {
  types: string[];
  effectAllowed: string;
  dropEffect: string;
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
} {
  const data = new Map<string, string>();
  return {
    types: [],
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      data.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return data.get(type) ?? '';
    },
  };
}

function entry(path: string, kind: 'file' | 'dir' = 'file'): RepoEntry {
  const name = path.split('/').pop() ?? path;
  return {
    name,
    path,
    url: `https://svn.example.com/repo/${path}`,
    kind,
    revision: 1,
    author: 'dev',
    date: '2026-08-01T00:00:00Z',
  };
}

const SORT: RepoSort = { key: 'name', direction: 'asc' };

/** The listing under test: files b/c/d, a valid drop folder, a folder beneath it. */
const ENTRIES: RepoEntry[] = [
  entry('b.txt'),
  entry('c.txt'),
  entry('d.txt'),
  entry('sub', 'dir'),
  entry('sub/inner', 'dir'),
];

function rowOf(path: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (!row) throw new Error(`row ${path} not rendered`);
  return row;
}

beforeEach(() => {
  endRepoDrag();
});

afterEach(() => {
  endRepoDrag();
});

describe('RepoContents drag-and-drop', () => {
  it('drags a row into the module payload and drops it on a folder as a move', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        onDropEntries={onDropEntries}
        repoRootUrl="https://svn.example.com/repo"
      />
    );

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rowOf('b.txt'), { dataTransfer });
    expect(getDraggingRepoPaths()).toEqual(['b.txt']);
    expect(dataTransfer.types).toContain(REPO_DRAG_MIME);

    fireEvent.dragOver(rowOf('sub'), { dataTransfer });
    fireEvent.drop(rowOf('sub'), { dataTransfer });

    expect(onDropEntries).toHaveBeenCalledWith(['b.txt'], ENTRIES[3], 'move');
    // The in-flight drag is cleared by the drop.
    expect(getDraggingRepoPaths()).toBeNull();
  });

  it('ctrl held at drop time turns the same gesture into a copy', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rowOf('b.txt'), { dataTransfer });
    // jsdom drag events carry no modifier keys; the DOM contract that *does*
    // survive is `dropEffect`, which the accepting `dragover` sets from them.
    dataTransfer.dropEffect = 'copy';
    fireEvent.dragOver(rowOf('sub'), { dataTransfer });
    fireEvent.drop(rowOf('sub'), { dataTransfer });

    expect(onDropEntries).toHaveBeenCalledWith(['b.txt'], ENTRIES[3], 'copy');
  });

  it('a real ctrl-clicked mouse drop event is also read as a copy', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rowOf('b.txt'), { dataTransfer });
    // A MouseEvent constructor exists in jsdom and keeps its modifier init —
    // but only `fireEvent(node, event)` dispatches it as-is; `fireEvent.drop`
    // treats its argument as init and rebuilds a modifier-less Event.
    fireEvent(
      rowOf('sub'),
      new MouseEvent('drop', { bubbles: true, cancelable: true, ctrlKey: true })
    );

    expect(onDropEntries).toHaveBeenCalledWith(['b.txt'], ENTRIES[3], 'copy');
  });

  it('carries the whole checkbox selection when the dragged row is part of it', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        selectedPaths={['b.txt', 'c.txt']}
        onSelectionChange={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rowOf('c.txt'), { dataTransfer });
    fireEvent.dragOver(rowOf('sub'), { dataTransfer });
    fireEvent.drop(rowOf('sub'), { dataTransfer });

    expect(onDropEntries).toHaveBeenCalledWith(
      ['b.txt', 'c.txt'],
      ENTRIES[3],
      'move'
    );
  });

  it('refuses a drop into the item own parent and a drop onto a file row', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path="sub"
        sort={SORT}
        onSortChange={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    // `sub/inner` already lives in `sub` — the destination would collide.
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rowOf('sub/inner'), { dataTransfer });
    fireEvent.dragOver(rowOf('sub'), { dataTransfer });
    fireEvent.drop(rowOf('sub'), { dataTransfer });
    expect(onDropEntries).not.toHaveBeenCalled();

    // Files are never drop targets.
    fireEvent.dragOver(rowOf('b.txt'), { dataTransfer });
    fireEvent.drop(rowOf('b.txt'), { dataTransfer });
    expect(onDropEntries).not.toHaveBeenCalled();
  });

  it('drops on empty list space mean "into the directory on screen"', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path="sub"
        sort={SORT}
        onSortChange={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    const dataTransfer = makeDataTransfer();
    writeRepoDragData(dataTransfer, {
      paths: ['other.txt'],
      rootUrl: 'https://svn.example.com/repo',
    });

    // The second rowgroup is the list body; the first is the header.
    const rowgroup = screen.getAllByRole('rowgroup')[1];
    if (!rowgroup) throw new Error('list body rowgroup not rendered');
    fireEvent.dragOver(rowgroup, { dataTransfer });
    fireEvent.drop(rowgroup, { dataTransfer });

    expect(onDropEntries).toHaveBeenCalledWith(['other.txt'], null, 'move');
  });
});

describe('RepoContents multi-select', () => {
  function setup() {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        selectedPaths={[]}
        onSelectionChange={onSelectionChange}
        onActivate={onActivate}
      />
    );
    return { onSelectionChange, onActivate };
  }

  it('plain click activates without touching the selection', () => {
    const { onSelectionChange, onActivate } = setup();
    fireEvent.click(rowOf('b.txt'));
    expect(onActivate).toHaveBeenCalledWith(ENTRIES[0]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('cmd-click toggles one path into the selection, and back out', () => {
    const onSelectionChange = vi.fn();
    const view = render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        selectedPaths={[]}
        onSelectionChange={onSelectionChange}
        onActivate={() => undefined}
      />
    );
    fireEvent.click(rowOf('b.txt'), { metaKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith(['b.txt']);

    // Controlled selection: feed the new selection back, then toggle out.
    view.rerender(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        selectedPaths={['b.txt']}
        onSelectionChange={onSelectionChange}
        onActivate={() => undefined}
      />
    );
    fireEvent.click(rowOf('b.txt'), { metaKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('shift-click selects the range between the anchor and the clicked row', () => {
    const { onSelectionChange } = setup();
    // Anchor on b.txt (plain click), extend to d.txt.
    fireEvent.click(rowOf('b.txt'));
    fireEvent.click(rowOf('d.txt'), { shiftKey: true });
    // Sorted order is b, c, d (directories first, then files by name).
    expect(onSelectionChange).toHaveBeenCalledWith(['b.txt', 'c.txt', 'd.txt']);
  });

  it('shift-click backwards selects the same range', () => {
    const { onSelectionChange } = setup();
    fireEvent.click(rowOf('d.txt'));
    fireEvent.click(rowOf('b.txt'), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith(['b.txt', 'c.txt', 'd.txt']);
  });

  it('exposes batch operations from the selection bar', () => {
    const onBatchDelete = vi.fn();
    const onBatchMove = vi.fn();
    const onBatchCopy = vi.fn();
    render(
      <RepoContents
        entries={ENTRIES}
        scope="repository"
        path=""
        sort={SORT}
        onSortChange={() => undefined}
        selectedPaths={['b.txt', 'c.txt']}
        onSelectionChange={() => undefined}
        onBatchDelete={onBatchDelete}
        onBatchMove={onBatchMove}
        onBatchCopy={onBatchCopy}
      />
    );

    const bar = screen.getByRole('region', { name: 'Selection actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete…' }));
    expect(onBatchDelete).toHaveBeenCalledWith([ENTRIES[0], ENTRIES[1]]);

    fireEvent.click(within(bar).getByRole('button', { name: 'Move to…' }));
    expect(onBatchMove).toHaveBeenCalled();

    fireEvent.click(within(bar).getByRole('button', { name: 'Copy to…' }));
    expect(onBatchCopy).toHaveBeenCalled();
  });

  it('a pointer press on empty space arms the marquee without crashing, and pointer-up clears it', () => {
    const { onSelectionChange } = setup();
    // The second rowgroup is the list body; the first is the header.
    const rowgroup = screen.getAllByRole('rowgroup')[1];
    if (!rowgroup) throw new Error('list body rowgroup not rendered');
    fireEvent.pointerDown(rowgroup, { button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 60 });
    fireEvent.pointerUp(window);
    // No rows intersected a zero-size jsdom rectangle: nothing selected, no crash.
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});

describe('RepoTree drag-and-drop', () => {
  const ROOT: RepoEntry = {
    name: 'repo',
    path: '',
    url: 'https://svn.example.com/repo',
    kind: 'dir',
    revision: 1,
    author: 'dev',
    date: '2026-08-01T00:00:00Z',
  };

  it('drags a node onto a folder and reports the move', () => {
    const onDropEntries = vi.fn();
    render(
      <RepoTree
        roots={[ROOT]}
        expandedPaths={new Set(['', 'trunk'])}
        childrenByPath={{
          '': [entry('trunk', 'dir'), entry('branches', 'dir')],
          trunk: [entry('trunk/src', 'dir')],
        }}
        onToggleExpand={() => undefined}
        onDropEntries={onDropEntries}
      />
    );

    const srcNode = document.querySelector<HTMLElement>('[data-tree-row-id="trunk/src"]');
    const dstNode = document.querySelector<HTMLElement>('[data-tree-row-id="branches"]');
    if (!srcNode || !dstNode) throw new Error('tree nodes not rendered');

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(srcNode, { dataTransfer });
    expect(getDraggingRepoPaths()).toEqual(['trunk/src']);

    fireEvent.dragOver(dstNode, { dataTransfer });
    fireEvent.drop(dstNode, { dataTransfer });

    expect(onDropEntries).toHaveBeenCalledWith(
      ['trunk/src'],
      expect.objectContaining({ path: 'branches' }),
      'move'
    );
  });
});
