import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SvnStatusEntry } from '@shared/types';
import { FileRow } from '../src/components/ui/FileRow';
import { VirtualizedFileList } from '../src/components/ui/VirtualizedList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, overscan = 10 }) => {
    const renderedCount = Math.min(count, 20 + overscan);

    return {
      getVirtualItems: () =>
        Array.from({ length: renderedCount }, (_, index) => ({
          index,
          start: index * estimateSize(),
          size: estimateSize(),
          key: `item-${index}`,
        })),
      getTotalSize: () => count * estimateSize(),
    };
  }),
}));

function makeEntry(index: number, overrides: Partial<SvnStatusEntry> = {}): SvnStatusEntry {
  return {
    path: `/repo/file-${index}.ts`,
    status: index % 3 === 0 ? 'M' : ' ',
    revision: 1000 + index,
    author: `author-${index % 5}`,
    date: '2026-04-30T10:00:00.000Z',
    isDirectory: false,
    ...overrides,
  };
}

function makeEntries(count: number): SvnStatusEntry[] {
  return Array.from({ length: count }, (_, index) => makeEntry(index));
}

function VirtualizedFileRowWindow({
  entries,
  onCopyPath,
}: {
  entries: SvnStatusEntry[];
  onCopyPath: (entry: SvnStatusEntry) => void;
}) {
  return (
    <div>
      {entries.slice(0, 30).map((entry, index) => (
        <FileRow
          key={entry.path}
          entry={entry}
          isSelected={false}
          onSelect={vi.fn()}
          actions={{ onCopyPath }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: 32,
            transform: `translateY(${index * 32}px)`,
          }}
        />
      ))}
    </div>
  );
}

describe('virtualized list stability', () => {
  it('keeps selection stable across filtering and refreshed entry objects', () => {
    const selectedPaths = new Set(['/repo/file-10.ts']);
    const onSelectionChange = vi.fn();
    const entries = makeEntries(10000);

    const { container, rerender } = render(
      <div style={{ height: 400 }}>
        <VirtualizedFileList
          files={entries}
          selectedPaths={selectedPaths}
          onSelectionChange={onSelectionChange}
        />
      </div>
    );

    expect(screen.getByText('file-10.ts')).toBeInTheDocument();
    expect((screen.getAllByRole('checkbox')[10] as HTMLInputElement).checked).toBe(true);
    expect(container.querySelectorAll('[style*="position: absolute"]').length).toBeLessThanOrEqual(
      30
    );

    const filteredEntries = entries.filter((entry) => entry.path.includes('file-10'));
    rerender(
      <div style={{ height: 400 }}>
        <VirtualizedFileList
          files={filteredEntries}
          selectedPaths={selectedPaths}
          onSelectionChange={onSelectionChange}
        />
      </div>
    );

    expect(screen.getByText('file-10.ts')).toBeInTheDocument();
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);

    const refreshedEntries = filteredEntries.map((entry) =>
      entry.path === '/repo/file-10.ts'
        ? { ...entry, status: 'M' as const, revision: 424242, author: 'refresh-bot' }
        : { ...entry }
    );
    rerender(
      <div style={{ height: 400 }}>
        <VirtualizedFileList
          files={refreshedEntries}
          selectedPaths={selectedPaths}
          onSelectionChange={onSelectionChange}
        />
      </div>
    );

    expect(screen.getByText('file-10.ts')).toBeInTheDocument();
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByTitle('Modified').length).toBeGreaterThan(0);
  });

  it('keeps context menu actions attached to virtualized row paths after refresh', () => {
    const onCopyPath = vi.fn();
    const entries = makeEntries(1000);

    const { rerender } = render(
      <VirtualizedFileRowWindow entries={entries} onCopyPath={onCopyPath} />
    );

    const row = screen.getByText('file-10.ts').closest('[data-path]');
    expect(row).toHaveAttribute('data-path', '/repo/file-10.ts');

    fireEvent.contextMenu(row!, { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByRole('button', { name: /Copy Path/ }));

    expect(onCopyPath).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo/file-10.ts' }));

    const refreshedEntries = entries.map((entry) => ({
      ...entry,
      revision: entry.revision ? entry.revision + 1 : 1,
    }));
    rerender(<VirtualizedFileRowWindow entries={refreshedEntries} onCopyPath={onCopyPath} />);

    const refreshedRow = screen.getByText('file-10.ts').closest('[data-path]');
    expect(refreshedRow).toHaveAttribute('data-path', '/repo/file-10.ts');

    fireEvent.contextMenu(refreshedRow!, { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByRole('button', { name: /Copy Path/ }));

    expect(onCopyPath).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: '/repo/file-10.ts', revision: 1011 })
    );
  });
});
