import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileExplorerActions } from '../src/hooks/useSvnActions';
import { getTextConflictPathsFromSvnOutput } from '../src/utils/conflictDetection';
import { ConflictResolutionWizard } from '../src/components/ui/ConflictResolutionWizard';
import { ResolveDialog } from '../src/components/ui/ResolveDialog';

const mockUseSettings = vi.hoisted(() => vi.fn());
const mockConfirmAppAction = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

vi.mock('../src/utils/dialogs', () => ({
  confirmAppAction: (options: unknown) => mockConfirmAppAction(options),
  promptAppInput: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('conflict resolution workflows', () => {
  const resolve = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirmAppAction.mockResolvedValue(true);
    mockUseSettings.mockReturnValue({
      settings: {
        confirmDestructiveOps: false,
        diffMerge: {
          externalDiffTool: '',
          externalMergeTool: '',
          externalToolOverrides: [],
        },
        integration: {
          shellExtensionEnabled: false,
          iconOverlaysEnabled: false,
        },
      },
    });
    resolve.mockResolvedValue({ success: true });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: {
          resolve,
        },
        shell: {
          updateOverlay: vi.fn(),
        },
        notification: {
          show: vi.fn(),
        },
      },
    });
  });

  it('routes file explorer selected conflicts through SVN resolve and refreshes status', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () =>
        useFileExplorerActions(
          'C:/wc',
          {
            path: 'C:/wc/src/conflict.ts',
            name: 'conflict.ts',
            status: 'C',
            isDirectory: false,
          },
          onRefresh
        ),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.handleResolveSelected('mine-full');
    });

    expect(resolve).toHaveBeenCalledWith('C:/wc/src/conflict.ts', 'mine-full');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('opens conflicts detected from update or merge output in the wizard and resolves them', async () => {
    const conflictPaths = getTextConflictPathsFromSvnOutput(
      ['U    src/app.ts', 'C    src/conflict.ts', 'G    src/merged.ts'].join('\n')
    );

    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={conflictPaths}
        workingCopyPath="C:/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));
    fireEvent.click(screen.getByRole('button', { name: /^Use Mine/i }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('src/conflict.ts', 'mine-full');
    });
    expect(await screen.findByText(/successfully resolved all conflicts/i)).toBeInTheDocument();
  });

  it('resolves direct conflict-dialog selections with the selected strategy', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <ResolveDialog
        isOpen
        filePath="C:/wc/src/conflict.ts"
        status="C"
        onClose={vi.fn()}
        onResolve={onResolve}
      />
    );

    fireEvent.click(screen.getByText('Resolve conflicts using theirs'));
    fireEvent.click(screen.getByRole('button', { name: /^Resolve$/i }));

    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('theirs-conflict');
    });
    expect(await screen.findByText('Conflict Resolved')).toBeInTheDocument();
  });
});
