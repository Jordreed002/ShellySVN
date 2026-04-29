import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MergeWizard, parseMergeRevisionInput } from '../src/components/ui/MergeWizard';

const svnApi = {
  merge: vi.fn(),
  mergeWithProgress: vi.fn(),
  cancelOperation: vi.fn(),
};

function advanceToOptionsPage() {
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  fireEvent.change(screen.getByLabelText(/from url/i), {
    target: { value: 'https://svn.example.com/repo/branches/feature' },
  });
  fireEvent.change(screen.getByLabelText(/revision range/i), {
    target: { value: '100-150,155' },
  });
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

describe('MergeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svnApi.merge.mockResolvedValue({ success: true, output: 'C src/conflict.txt\nU src/app.ts' });
    svnApi.mergeWithProgress.mockImplementation(async (_source, _target, onProgress) => {
      onProgress({
        operationId: 'merge-1',
        operation: 'merge',
        status: 'running',
        filesProcessed: 1,
        percentage: 50,
      });
      return { success: true, output: 'U src/app.ts' };
    });
    svnApi.cancelOperation.mockResolvedValue({ success: true });

    window.api = {
      svn: svnApi,
    } as unknown as Window['api'];
  });

  it('parses revision ranges and individual revisions', () => {
    expect(parseMergeRevisionInput('100-150, 155, 160:170')).toEqual({
      revisions: ['155'],
      ranges: [
        { start: 100, end: 150 },
        { start: 160, end: 170 },
      ],
    });
  });

  it('runs dry-run preview and shows merge output with conflict summary', async () => {
    render(<MergeWizard isOpen={true} onClose={vi.fn()} targetPath="C:/repo" />);

    advanceToOptionsPage();
    fireEvent.click(screen.getByRole('button', { name: /dry-run preview/i }));

    await waitFor(() => {
      expect(svnApi.merge).toHaveBeenCalledWith(
        'https://svn.example.com/repo/branches/feature',
        'C:/repo',
        ['155'],
        [{ start: 100, end: 150 }],
        expect.objectContaining({ dryRun: true, depth: 'infinity' })
      );
    });
    expect(await screen.findByText('Conflicts detected (1)')).toBeInTheDocument();
    expect(screen.getByText('src/conflict.txt')).toBeInTheDocument();
    expect(screen.getByText(/U src\/app.ts/)).toBeInTheDocument();
  });

  it('runs merge with progress and completes with output', async () => {
    const onComplete = vi.fn();
    render(<MergeWizard isOpen={true} onClose={vi.fn()} targetPath="C:/repo" onComplete={onComplete} />);

    advanceToOptionsPage();
    fireEvent.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => {
      expect(svnApi.mergeWithProgress).toHaveBeenCalled();
    });
    expect(await screen.findByText('Merge Complete')).toBeInTheDocument();
    expect(screen.getByText(/U src\/app.ts/)).toBeInTheDocument();
  });
});
