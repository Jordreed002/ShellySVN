import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResolveDialog } from '../src/components/ui/ResolveDialog';

const mockUseSettings = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

describe('external merge tool launch', () => {
  const listDirectory = vi.fn();
  const openMergeTool = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSettings.mockReturnValue({
      settings: {
        diffMerge: {
          externalDiffTool: '',
          externalMergeTool: 'global-merge-tool',
          externalToolOverrides: [
            { extension: 'ts', diffTool: '', mergeTool: 'typescript-merge-tool' },
          ],
        },
      },
    });
    listDirectory.mockResolvedValue([
      { name: 'app.ts.mine', path: 'C:/wc/src/app.ts.mine', isDirectory: false },
      { name: 'app.ts.r10', path: 'C:/wc/src/app.ts.r10', isDirectory: false },
      { name: 'app.ts.r14', path: 'C:/wc/src/app.ts.r14', isDirectory: false },
    ]);
    openMergeTool.mockResolvedValue({ success: true });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          listDirectory,
        },
        external: {
          openMergeTool,
        },
      },
    });
  });

  it('launches the configured per-extension merge tool with discovered conflict files', async () => {
    render(
      <ResolveDialog
        isOpen
        filePath="C:/wc/src/app.ts"
        status="C"
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    expect(screen.getByText(/Launch typescript-merge-tool/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit conflicts/i }));

    await waitFor(() => {
      expect(openMergeTool).toHaveBeenCalledWith(
        'typescript-merge-tool',
        'C:/wc/src/app.ts.r10',
        'C:/wc/src/app.ts.mine',
        'C:/wc/src/app.ts.r14',
        'C:/wc/src/app.ts'
      );
    });
    expect(await screen.findByText(/External tool launched/)).toBeInTheDocument();
  });

  it('surfaces missing or invalid external merge tool errors', async () => {
    openMergeTool.mockResolvedValueOnce({
      success: false,
      error: "Unknown merge tool 'missing-tool' and custom path invalid: file does not exist",
    });
    mockUseSettings.mockReturnValue({
      settings: {
        diffMerge: {
          externalDiffTool: '',
          externalMergeTool: 'missing-tool',
          externalToolOverrides: [],
        },
      },
    });

    render(
      <ResolveDialog
        isOpen
        filePath="C:/wc/src/app.md"
        status="C"
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit conflicts/i }));

    expect(await screen.findByText(/Unknown merge tool 'missing-tool'/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as resolved/i })).toBeDisabled();
  });
});
