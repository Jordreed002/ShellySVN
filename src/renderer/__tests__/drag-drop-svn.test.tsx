import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraggableFileRow, performSvnOperation } from '../src/hooks/useDragDrop';

function createDataTransfer() {
  const data = new Map<string, string>();

  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    files: [] as File[],
    get types() {
      return Array.from(data.keys());
    },
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
    getData: vi.fn((type: string) => data.get(type) || ''),
    setDragImage: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      svn: {
        move: vi.fn().mockResolvedValue({ success: true }),
        copy: vi.fn().mockResolvedValue({ success: true }),
        externals: {
          add: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    },
  });
});

describe('SVN drag/drop move and copy workflows', () => {
  it('performs SVN move and copy operations with target child paths', async () => {
    await expect(performSvnOperation(['/repo/src/file.txt'], '/repo/dest', 'move')).resolves.toBe(
      true
    );
    await expect(performSvnOperation(['/repo/src/other.txt'], '/repo/dest', 'copy')).resolves.toBe(
      true
    );

    expect(window.api.svn.move).toHaveBeenCalledWith('/repo/src/file.txt', '/repo/dest/file.txt');
    expect(window.api.svn.copy).toHaveBeenCalledWith(
      '/repo/src/other.txt',
      '/repo/dest/other.txt',
      'Copy from /repo/src/other.txt'
    );
  });

  it('drops selected versioned files onto a directory as copy when the copy modifier is held', () => {
    const onDrop = vi.fn();
    const dataTransfer = createDataTransfer();

    render(
      <div>
        <DraggableFileRow
          path="/repo/src/file-a.ts"
          selectedPaths={new Set(['/repo/src/file-a.ts', '/repo/src/file-b.ts'])}
          onDrop={onDrop}
        >
          <span>file-a.ts</span>
        </DraggableFileRow>
        <DraggableFileRow path="/repo/dest" isDirectory onDrop={onDrop}>
          <span>dest</span>
        </DraggableFileRow>
      </div>
    );

    fireEvent.dragStart(screen.getByText('file-a.ts').parentElement!, { dataTransfer });
    fireEvent.dragOver(screen.getByText('dest').parentElement!, { dataTransfer, ctrlKey: true });
    dataTransfer.dropEffect = 'copy';
    fireEvent.drop(screen.getByText('dest').parentElement!, { dataTransfer, ctrlKey: true });

    expect(onDrop).toHaveBeenCalledWith(
      ['/repo/src/file-a.ts', '/repo/src/file-b.ts'],
      '/repo/dest',
      'copy'
    );
  });
});
