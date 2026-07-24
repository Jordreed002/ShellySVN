import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MergeWizard, parseMergeRevisionInput } from '../src/components/ui/MergeWizard';

const svnApi = {
  merge: vi.fn(),
  mergeWithProgress: vi.fn(),
  cancelOperation: vi.fn(),
  mergeInfo: vi.fn(),
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
      return { success: true, output: 'C src/conflict.txt\nU src/app.ts' };
    });
    svnApi.cancelOperation.mockResolvedValue({ success: true });
    svnApi.mergeInfo.mockResolvedValue({
      revisions: [101, 105],
      properties: [
        {
          value: '/trunk:1-100',
          inherited: true,
          inheritedFrom: 'https://svn.example.com/repo',
        },
      ],
      rawOutput: 'r101\nr105\n',
    });

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
    expect(parseMergeRevisionInput('200:150,-42')).toEqual({
      revisions: ['-42'],
      ranges: [{ start: 200, end: 150 }],
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

  it('loads eligible mergeinfo revisions into the revision field', async () => {
    render(<MergeWizard isOpen={true} onClose={vi.fn()} targetPath="C:/repo" />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/from url/i), {
      target: { value: 'https://svn.example.com/repo/branches/feature' },
    });
    fireEvent.click(screen.getByRole('button', { name: /load eligible revisions/i }));

    await waitFor(() => {
      expect(svnApi.mergeInfo).toHaveBeenCalledWith(
        'https://svn.example.com/repo/branches/feature',
        'C:/repo',
        'eligible'
      );
    });
    expect(screen.getByLabelText(/revision range/i)).toHaveValue('101,105');
    expect(screen.getByText(/2 eligible revisions loaded/i)).toBeInTheDocument();
    expect(
      screen.getByText(/inherited mergeinfo from https:\/\/svn\.example\.com\/repo/i)
    ).toBeInTheDocument();
  });

  it('runs merge with progress, reports conflicts, and completes for post-merge refresh', async () => {
    const onComplete = vi.fn();
    render(<MergeWizard isOpen={true} onClose={vi.fn()} targetPath="C:/repo" onComplete={onComplete} />);

    advanceToOptionsPage();
    fireEvent.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => {
      expect(svnApi.mergeWithProgress).toHaveBeenCalled();
    });
    expect(await screen.findByText('Merge Complete')).toBeInTheDocument();
    expect(screen.getByText('Conflicts detected (1)')).toBeInTheDocument();
    expect(screen.getByText('src/conflict.txt')).toBeInTheDocument();
    expect(screen.getByText(/U src\/app.ts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    expect(onComplete).toHaveBeenCalled();
  });

  it('wires the two-tree merge form with both source URLs', async () => {
    render(<MergeWizard isOpen={true} onClose={vi.fn()} targetPath="C:/repo" />);
    fireEvent.click(screen.getByRole('button', { name: /merge two different trees/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/from url/i), {
      target: { value: 'https://svn.example.com/repo/vendor/old' },
    });
    fireEvent.change(screen.getByLabelText(/to url/i), {
      target: { value: 'https://svn.example.com/repo/vendor/new' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /dry-run preview/i }));

    await waitFor(() => {
      expect(svnApi.merge).toHaveBeenCalledWith(
        'https://svn.example.com/repo/vendor/old',
        'C:/repo',
        undefined,
        undefined,
        expect.objectContaining({
          dryRun: true,
          secondSource: 'https://svn.example.com/repo/vendor/new',
        })
      );
    });
  });
});
