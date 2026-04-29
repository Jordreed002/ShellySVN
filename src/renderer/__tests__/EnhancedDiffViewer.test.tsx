import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnDiffResult } from '@shared/types';

import { EnhancedDiffViewer } from '../src/components/ui/EnhancedDiffViewer';

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { theme: 'light' },
  }),
}));

describe('EnhancedDiffViewer unified rendering', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: { writeText: vi.fn() },
    });
  });

  it('renders added, deleted, modified, renamed, copied, property-only, and binary diff entries', () => {
    const diff: SvnDiffResult = {
      hasChanges: true,
      files: [
        {
          oldPath: '',
          newPath: 'added.txt',
          hunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [{ type: 'added', content: 'new file line', newLineNumber: 1 }],
            },
          ],
        },
        {
          oldPath: 'deleted.txt',
          newPath: '',
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 0,
              newLines: 0,
              lines: [{ type: 'removed', content: 'removed file line', oldLineNumber: 1 }],
            },
          ],
        },
        {
          oldPath: 'modified.txt',
          newPath: 'modified.txt',
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [
                {
                  type: 'context',
                  content: 'unchanged line',
                  oldLineNumber: 1,
                  newLineNumber: 1,
                },
                { type: 'removed', content: 'old line', oldLineNumber: 2 },
                { type: 'added', content: 'new line', newLineNumber: 2 },
              ],
            },
          ],
        },
        {
          oldPath: 'old-name.txt',
          newPath: 'new-name.txt',
          hunks: [],
        },
        {
          oldPath: 'source.txt',
          newPath: 'copy.txt',
          hunks: [],
        },
        {
          oldPath: 'props.txt',
          newPath: 'props.txt',
          hunks: [],
        },
        {
          oldPath: 'image.png',
          newPath: 'image.png',
          isBinary: true,
          hunks: [],
        },
      ],
    };

    const { container } = render(
      <EnhancedDiffViewer diff={diff} filePath="modified.txt" mode="unified" />
    );

    expect(screen.getByText('added.txt')).toBeInTheDocument();
    expect(screen.getByText('deleted.txt')).toBeInTheDocument();
    expect(screen.getByText('modified.txt')).toBeInTheDocument();
    expect(screen.getByText('new-name.txt')).toBeInTheDocument();
    expect(screen.getByText('renamed from old-name.txt')).toBeInTheDocument();
    expect(screen.getByText('copy.txt')).toBeInTheDocument();
    expect(screen.getByText('renamed from source.txt')).toBeInTheDocument();
    expect(screen.getByText('props.txt')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('new file line')).toBeInTheDocument();
    expect(screen.getByText('removed file line')).toBeInTheDocument();
    expect(screen.getByText('unchanged line')).toBeInTheDocument();
    expect(container.querySelectorAll('.diff-line-added')).toHaveLength(2);
    expect(container.querySelectorAll('.diff-line-removed')).toHaveLength(2);
  });
});
