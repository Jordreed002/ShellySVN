import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnDiffResult } from '@shared/types';
import { RevisionDiffDialog } from '../RevisionDiffDialog';

const diffResult: SvnDiffResult = {
  hasChanges: true,
  files: [
    {
      oldPath: '/trunk/src/app.tsx',
      newPath: '/trunk/src/app.tsx',
      hunks: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          lines: [
            { type: 'context', content: 'context line' },
            { type: 'removed', content: 'old line', oldLineNumber: 10 },
            { type: 'added', content: 'new line', newLineNumber: 11 },
          ],
        },
      ],
    },
  ],
};

describe('RevisionDiffDialog (#72)', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.diff = vi.fn().mockResolvedValue(diffResult);
  });
  afterEach(cleanup);

  it('runs the revision-vs-predecessor diff on open and shows the summary', async () => {
    render(
      <RevisionDiffDialog isOpen onClose={vi.fn()} path="/wc/repo" revision={121} />
    );

    expect(window.api.svn.diff).toHaveBeenCalledWith('/wc/repo', '121');

    await waitFor(() => {
      expect(screen.getAllByText(/1 file changed/).length).toBeGreaterThan(0);
      expect(screen.getByText('+1')).toBeTruthy();
      expect(screen.getByText('-1')).toBeTruthy();
      expect(screen.getByText(/r120 → r121/)).toBeTruthy();
    });
  });

  it('does nothing while closed', () => {
    render(<RevisionDiffDialog isOpen={false} onClose={vi.fn()} path="/wc/repo" revision={121} />);
    expect(window.api.svn.diff).not.toHaveBeenCalled();
  });

  it('shows the error with a working retry when the diff fails', async () => {
    const diff = vi
      .fn<() => Promise<SvnDiffResult>>()
      .mockRejectedValueOnce(new Error('svn went away'))
      .mockResolvedValue(diffResult);
    window.api.svn.diff = diff;
    render(<RevisionDiffDialog isOpen onClose={vi.fn()} path="/wc/repo" revision={9} />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('svn went away');
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/1 file changed/).length).toBeGreaterThan(0);
    });
    expect(diff).toHaveBeenCalledTimes(2);
  });

  it('offers the diff wizard hand-off for revisions >= 2 only', async () => {
    const { rerender } = render(
      <RevisionDiffDialog isOpen onClose={vi.fn()} path="/wc/repo" revision={1} />
    );
    await waitFor(() => expect(window.api.svn.diff).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /diff wizard/i })).toBeNull();

    rerender(<RevisionDiffDialog isOpen onClose={vi.fn()} path="/wc/repo" revision={50} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /diff wizard/i })).toBeTruthy();
    });
  });
});
