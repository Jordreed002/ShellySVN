import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitStackPanel } from '../CommitStackPanel';

const actions = {
  reorder: vi.fn(),
  updateMessage: vi.fn(),
  movePath: vi.fn(),
  createChangelist: vi.fn(),
  commitGroup: vi.fn(),
  clear: vi.fn(),
};

vi.mock('../useCommitStack', () => ({
  useCommitStack: () => ({
    stack: {
      version: 1,
      workingCopyPath: '/wc',
      planChecksum: 'plan',
      allPaths: ['/wc/app.ts', '/wc/app.test.ts'],
      updatedAt: '2026-01-01T00:00:00.000Z',
      groups: [
        {
          id: 'app',
          order: 0,
          title: 'App',
          description: '',
          paths: ['/wc/app.ts'],
          draftMessage: 'feat: app',
          status: 'ready',
        },
        {
          id: 'tests',
          order: 1,
          title: 'Tests',
          description: '',
          paths: ['/wc/app.test.ts'],
          draftMessage: '',
          status: 'planned',
        },
      ],
    },
    diagnostics: { duplicates: new Map(), unassigned: [] },
    isLoading: false,
    busyGroupId: null,
    error: null,
    ...actions,
  }),
}));

describe('CommitStackPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers accessible ordering and commits only ready groups', () => {
    render(<CommitStackPanel workingCopyPath="/wc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Tests earlier' }));
    expect(actions.reorder).toHaveBeenCalledWith('tests', -1);

    const commitButtons = screen.getAllByRole('button', { name: 'Commit this group' });
    expect((commitButtons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((commitButtons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(commitButtons[0]);
    expect(actions.commitGroup).toHaveBeenCalledWith('app');
  });

  it('moves paths between groups and updates the recovered draft', () => {
    render(<CommitStackPanel workingCopyPath="/wc" />);
    fireEvent.change(screen.getByLabelText('Commit message for App'), {
      target: { value: 'fix: safer app' },
    });
    expect(actions.updateMessage).toHaveBeenCalledWith('app', 'fix: safer app');

    fireEvent.change(screen.getByLabelText('Move /wc/app.ts to group'), {
      target: { value: 'tests' },
    });
    expect(actions.movePath).toHaveBeenCalledWith('/wc/app.ts', 'tests');
  });
});
