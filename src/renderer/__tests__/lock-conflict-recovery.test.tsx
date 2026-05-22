import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSvnStatusXml } from '@shared/svn-parsers';
import { LockManagementDialog } from '../src/components/ui/LockManagementDialog';
import { getCommitWarnings } from '../src/utils/commitWarnings';

const lockedPath = 'C:/wc/src/locked.txt';
const lockInfo = {
  path: lockedPath,
  owner: 'alice',
  comment: 'Editing release notes',
  date: '2024-01-15T10:30:00.000000Z',
  token: 'opaquelocktoken:123',
};

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('lock conflict detection and recovery', () => {
  const lockList = vi.fn();
  const lockInfoApi = vi.fn();
  const lockForce = vi.fn();
  const unlockForce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    lockList.mockResolvedValue([lockInfo]);
    lockInfoApi.mockResolvedValue(lockInfo);
    lockForce.mockResolvedValue({ success: true, lock: { ...lockInfo, owner: 'current-user' } });
    unlockForce.mockResolvedValue({ success: true });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: {
          lockList,
          lockInfo: lockInfoApi,
          lockForce,
          unlockForce,
        },
      },
    });
  });

  it('preserves lock metadata from status XML and warns before committing locked paths', () => {
    const status = parseSvnStatusXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:/wc">
    <entry path="src/locked.txt">
      <wc-status item="modified">
        <lock>
          <owner>alice</owner>
          <comment>Editing release notes</comment>
          <creationdate>2024-01-15T10:30:00.000000Z</creationdate>
        </lock>
      </wc-status>
    </entry>
  </target>
</status>`,
      'C:/wc'
    );

    expect(status.entries[0]).toMatchObject({
      path: 'src/locked.txt',
      lock: {
        owner: 'alice',
        comment: 'Editing release notes',
        date: '2024-01-15T10:30:00.000000Z',
      },
    });

    const warnings = getCommitWarnings([
      {
        path: 'src/locked.txt',
        status: 'M',
        selected: true,
        lock: status.entries[0].lock,
      },
    ]);

    expect(warnings).toContainEqual(
      expect.objectContaining({
        id: 'locks',
        severity: 'warning',
        paths: ['src/locked.txt'],
      })
    );
  });

  it('recovers from another user lock by breaking or stealing the lock', async () => {
    const onRefresh = vi.fn();

    renderWithQueryClient(
      <LockManagementDialog
        isOpen
        workingCopyPath="C:/wc"
        selectedPath={lockedPath}
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />
    );

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Editing release notes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /break lock/i }));
    const breakDialog = screen.getByRole('dialog', { name: /confirm break lock/i });
    fireEvent.click(within(breakDialog).getByRole('button', { name: /break lock/i }));

    await waitFor(() => {
      expect(unlockForce).toHaveBeenCalledWith(lockedPath);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Lock broken for alice')).toBeInTheDocument();

    fireEvent.click(screen.getByText('locked.txt'));
    fireEvent.click(screen.getByRole('button', { name: /steal lock/i }));
    const stealDialog = screen.getByRole('dialog', { name: /confirm steal lock/i });
    fireEvent.click(within(stealDialog).getByRole('button', { name: /steal lock/i }));

    await waitFor(() => {
      expect(lockForce).toHaveBeenCalledWith(lockedPath, 'Lock stolen via ShellySVN');
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Lock stolen from alice')).toBeInTheDocument();
  });
});
