import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidate = vi.fn();

vi.mock('../src/features/branches/useBranches', () => ({
  useBranchList: () => ({
    data: {
      trunkUrl: 'https://svn.example.com/repo/trunk',
      branches: [{ name: 'feature', url: 'https://svn.example.com/repo/branches/feature' }],
      tags: [],
    },
    isFetching: false,
  }),
  useInvalidateBranches: () => invalidate,
}));

import { BranchSwitcher } from '../src/features/branches/BranchSwitcher';

describe('BranchSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a structured switch failure without reporting success', async () => {
    const onSwitched = vi.fn();
    window.api = {
      svn: {
        switch: vi.fn().mockRejectedValue(new Error('Working copy is conflicted')),
      },
    } as unknown as Window['api'];

    render(
      <BranchSwitcher
        url="https://svn.example.com/repo/trunk/src"
        localPath="C:\\wc\\src"
        onSwitched={onSwitched}
      />
    );

    fireEvent.click(screen.getByTitle('Switch branch'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Working copy is conflicted')
    );
    expect(onSwitched).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('shows a fallback error when switching returns an unsuccessful result', async () => {
    window.api = {
      svn: {
        switch: vi.fn().mockResolvedValue({ success: false, revision: null }),
      },
    } as unknown as Window['api'];

    render(
      <BranchSwitcher
        url="https://svn.example.com/repo/trunk/src"
        localPath="C:\\wc\\src"
      />
    );

    fireEvent.click(screen.getByTitle('Switch branch'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'SVN could not switch this working copy.'
      )
    );
  });
});
