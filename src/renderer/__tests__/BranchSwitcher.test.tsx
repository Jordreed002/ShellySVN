import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidate = vi.fn();
const switchTo = vi.hoisted(() => vi.fn());

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

// Switching routes through the shared action (cache resets live there); mock
// it so the component test stays a component test.
vi.mock('../src/hooks/useSvnActions', () => ({
  useSvnActions: () => ({ switchTo }),
}));

import { BranchSwitcher } from '../src/features/branches/BranchSwitcher';

describe('BranchSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a structured switch failure without reporting success', async () => {
    const onSwitched = vi.fn();
    switchTo.mockRejectedValue(new Error('Working copy is conflicted'));

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
    switchTo.mockResolvedValue({ success: false });

    render(<BranchSwitcher url="https://svn.example.com/repo/trunk/src" localPath="C:\\wc\\src" />);

    fireEvent.click(screen.getByTitle('Switch branch'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'SVN could not switch this working copy.'
      )
    );
  });
});
