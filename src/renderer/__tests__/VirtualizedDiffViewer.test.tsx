import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import type { SvnDiffResult } from '@shared/types';

import { VirtualizedDiffViewer } from '../src/components/ui/VirtualizedDiffViewer';

function createLargeDiff(lineCount: number): SvnDiffResult {
  return {
    hasChanges: true,
    files: [
      {
        oldPath: 'large.txt',
        newPath: 'large.txt',
        hunks: [
          {
            oldStart: 1,
            oldLines: lineCount,
            newStart: 1,
            newLines: lineCount,
            lines: Array.from({ length: lineCount }, (_, index) => ({
              type: index % 10 === 0 ? 'added' : index % 15 === 0 ? 'removed' : 'context',
              content: `line ${index}`,
              oldLineNumber: index + 1,
              newLineNumber: index + 1,
            })),
          },
        ],
      },
    ],
  };
}

describe('VirtualizedDiffViewer large diffs', () => {
  it('renders a large diff through the virtualized path within the renderer budget', () => {
    const diff = createLargeDiff(10_000);
    const startedAt = performance.now();

    const { container } = render(
      <div style={{ height: 600 }}>
        <VirtualizedDiffViewer diff={diff} />
      </div>
    );

    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThan(1000);
    expect(screen.getByText('10,002 lines')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(500);
  });
});
