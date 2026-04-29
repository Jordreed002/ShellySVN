import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BranchTagCompareDialog,
  suggestComparisonUrl,
} from '../src/components/ui/BranchTagCompareDialog';

const diffUrls = vi.fn();

describe('BranchTagCompareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diffUrls.mockResolvedValue({ files: [], hasChanges: false, rawDiff: '' });
    window.api = {
      svn: {
        diffUrls,
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
      expect(diffUrls).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk',
        'https://svn.example.com/repo/branches/feature'
      );
    });
    expect(await screen.findByText('No differences found')).toBeInTheDocument();
  });
});
