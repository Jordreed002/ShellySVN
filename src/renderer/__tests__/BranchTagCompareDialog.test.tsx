import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BranchTagCompareDialog,
  suggestComparisonUrl,
} from '../src/components/ui/BranchTagCompareDialog';

const compareBranches = vi.fn();

describe('BranchTagCompareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareBranches.mockResolvedValue({
      diff: { files: [], hasChanges: false, rawDiff: '' },
      summary: {
        leftUrl: 'https://svn.example.com/repo/trunk',
        rightUrl: 'https://svn.example.com/repo/branches/feature',
        hasDifferences: false,
        changedFiles: [],
        leftOnlyRevisions: [],
        rightOnlyRevisions: [],
        impactGroups: [],
        truncated: false,
      },
    });
    window.api = {
      svn: {
        compareBranches,
      },
    } as unknown as Window['api'];
  });

  it('suggests common trunk, branch, and tag comparison URLs', () => {
    expect(suggestComparisonUrl('https://svn.example.com/repo/trunk')).toBe(
      'https://svn.example.com/repo/branches/'
    );
    expect(suggestComparisonUrl('https://svn.example.com/repo/branches/feature')).toBe(
      'https://svn.example.com/repo/trunk'
    );
    expect(suggestComparisonUrl('https://svn.example.com/repo/tags/v1.0')).toBe(
      'https://svn.example.com/repo/trunk'
    );
  });

  it('compares the entered repository URLs', async () => {
    render(
      <BranchTagCompareDialog
        isOpen={true}
        onClose={vi.fn()}
        sourceUrl="https://svn.example.com/repo/trunk"
      />
    );

    expect(screen.getByDisplayValue('https://svn.example.com/repo/trunk')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Compare URL'), {
      target: { value: 'https://svn.example.com/repo/branches/feature' },
    });
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    await waitFor(() => {
      expect(compareBranches).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk',
        'https://svn.example.com/repo/branches/feature'
      );
    });
    expect(await screen.findByText('No differences found')).toBeInTheDocument();
  });
});
