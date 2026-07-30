import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { UpdateToRevisionDialog } from '../src/components/ui/UpdateToRevisionDialog';
import { ChooseItemsDialog } from '../src/components/ui/ChooseItemsDialog';
import type { AuthCredential } from '@shared/types';

// Mock the ChooseItemsDialog component
vi.mock('../src/components/ui/ChooseItemsDialog', () => ({
  ChooseItemsDialog: vi.fn(({ isOpen, repoUrl, credentials, onSelect, onCancel, title }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="choose-items-dialog">
        <h3>{title}</h3>
        <div>Repository: {repoUrl}</div>
        <div>Credentials: {credentials ? 'Present' : 'None'}</div>
        <button onClick={() => onSelect(['/trunk/src/file1.ts', '/trunk/src/file2.ts'])}>
          Select Files
        </button>
        <button onClick={() => onSelect([])}>Empty Selection</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  }),
}));

// The tree hands back repository URLs, which only the caller can map onto local
// paths — the dialog delegates the fetch instead of calling IPC with a URL where
// a working-copy path belongs.
const mockUpdateToRevision = vi.fn();
window.api = {
  svn: {
    updateToRevision: mockUpdateToRevision,
  },
};

const mockOnConfirm = vi
  .fn()
  .mockResolvedValueOnce({ success: true, revision: 123 })
  .mockResolvedValueOnce({ success: false, revision: 0, error: 'Update failed' });
const mockOnConfirmUrls = vi.fn();

describe('UpdateToRevisionDialog - ChooseItemsDialog Integration', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    itemName: '/trunk/project',
    onConfirm: mockOnConfirm,
    onConfirmUrls: mockOnConfirmUrls,
    repoUrl: 'https://svn.example.com/repo/trunk',
    credentials: { username: 'testuser', password: 'testpass' } as AuthCredential,
    workingCopyRoot: '/Users/user/workspace/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateToRevision.mockReset();
    mockUpdateToRevision.mockResolvedValue({ success: true, revision: 123 });
    mockOnConfirm.mockClear();
    mockOnConfirmUrls.mockReset();
    mockOnConfirmUrls.mockResolvedValue({ success: true, revision: 123 });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders normally with basic props', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    expect(screen.getByText('Update to Working Copy')).toBeInTheDocument();
    expect(screen.getByText('Update depth for:')).toBeInTheDocument();
    expect(screen.getByText('/trunk/project')).toBeInTheDocument();
    expect(screen.getByText('Fully recursive')).toBeInTheDocument();
    expect(screen.getByText('Choose items…')).toBeInTheDocument();
  });

  it('does not render "Choose items…" button when repoUrl or workingCopyRoot is missing', () => {
    const propsWithoutRepo = { ...defaultProps, repoUrl: undefined };
    const propsWithoutWcRoot = { ...defaultProps, workingCopyRoot: undefined };

    const { rerender } = render(<UpdateToRevisionDialog {...propsWithoutRepo} />);
    expect(screen.queryByText('Choose items…')).not.toBeInTheDocument();

    rerender(<UpdateToRevisionDialog {...propsWithoutWcRoot} />);
    expect(screen.queryByText('Choose items…')).not.toBeInTheDocument();
  });

  it('opens ChooseItemsDialog when "Choose items…" button is clicked', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    expect(screen.getByTestId('choose-items-dialog')).toBeInTheDocument();
    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        repoUrl: 'https://svn.example.com/repo/trunk',
        credentials: { username: 'testuser', password: 'testpass' },
        title: 'Choose Items to Update in Sparse Checkout',
      }),
      {}
    );
  });

  it('hands the chosen repository URLs to the caller, never to IPC as local paths', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    // Select files and confirm
    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(mockOnConfirmUrls).toHaveBeenCalledWith(
        ['/trunk/src/file1.ts', '/trunk/src/file2.ts'],
        'infinity',
        false
      );
    });
    // A repository path as `localPath` resolves outside the working copy, so the
    // dialog must not make that call itself.
    expect(mockUpdateToRevision).not.toHaveBeenCalled();
  });

  it('reports that choosing items is unavailable when the caller cannot map URLs', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} onConfirmUrls={undefined} />);

    fireEvent.click(screen.getByText('Choose items…'));
    fireEvent.click(screen.getByText('Select Files'));

    await waitFor(() => {
      expect(
        screen.getByText('Choosing items is not available for this working copy.')
      ).toBeInTheDocument();
    });
    expect(mockUpdateToRevision).not.toHaveBeenCalled();
  });

  it('handles multiple sparse checkout updates with success', async () => {
    mockOnConfirmUrls.mockResolvedValue({ success: true, revision: 124 });

    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('Update Complete')).toBeInTheDocument();
      expect(screen.getByText('Updated to revision 124')).toBeInTheDocument();
    });
  });

  it('handles multiple sparse checkout updates with failure', async () => {
    mockOnConfirmUrls.mockRejectedValue(new Error('Network error'));

    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('handles sparse checkout update with partial failures', async () => {
    mockOnConfirmUrls.mockResolvedValue({
      success: false,
      revision: null,
      error: 'File not found',
    });

    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });
  });

  it('preserves existing depth and sticky settings for sparse checkout', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Files only update depth'));
    fireEvent.click(screen.getByLabelText('Make depth sticky'));

    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(mockOnConfirmUrls).toHaveBeenCalledWith(
        ['/trunk/src/file1.ts', '/trunk/src/file2.ts'],
        'files',
        true
      );
    });
  });

  it('handles ChooseItemsDialog cancellation gracefully', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    // Cancel ChooseItemsDialog
    const chooser = await screen.findByTestId('choose-items-dialog');
    const cancelButton = within(chooser).getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(screen.queryByTestId('choose-items-dialog')).not.toBeInTheDocument();
  });

  it('disables ChooseItemsDialog button when updating', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    // Simulate ongoing update
    mockOnConfirmUrls.mockImplementation(() => new Promise(() => {}));

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    // Choose items button should be disabled during update
    expect(screen.getByText('Choose items…')).toBeDisabled();
  });

  it('integrates with existing depth selection functionality', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Test that depth selection still works normally
    const depthOption = screen.getByText('Files only');
    fireEvent.click(depthOption);

    expect(screen.getByText('Update')).toBeInTheDocument();
    expect(screen.getByText('Choose items…')).toBeInTheDocument();
  });
});

describe('UpdateToRevisionDialog - Sparse Checkout Error Scenarios', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    itemName: '/trunk/project',
    onConfirm: vi.fn(),
    onConfirmUrls: mockOnConfirmUrls,
    repoUrl: 'https://svn.example.com/repo/trunk',
    credentials: { username: 'testuser', password: 'testpass' } as AuthCredential,
    workingCopyRoot: '/Users/user/workspace/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateToRevision.mockReset();
    mockUpdateToRevision.mockResolvedValue({ success: true, revision: 123 });
    mockOnConfirmUrls.mockReset();
    mockOnConfirmUrls.mockResolvedValue({ success: true, revision: 123 });
  });

  it('handles API errors gracefully during sparse checkout', async () => {
    mockOnConfirmUrls.mockRejectedValue(new Error('SVN command failed'));

    render(<UpdateToRevisionDialog {...defaultProps} />);

    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    const selectButton = screen.getByText('Select Files');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('SVN command failed')).toBeInTheDocument();
    });
  });

  it('handles missing credentials in ChooseItemsDialog', () => {
    const propsWithoutCredentials = { ...defaultProps, credentials: undefined };

    render(<UpdateToRevisionDialog {...propsWithoutCredentials} />);

    const chooseButton = screen.getByText('Choose items…');
    fireEvent.click(chooseButton);

    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: undefined,
      }),
      {}
    );
  });

  it('handles empty selected paths gracefully', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Choose items…'));
    fireEvent.click(await screen.findByText('Empty Selection'));

    expect(mockUpdateToRevision).not.toHaveBeenCalled();
    expect(screen.queryByTestId('choose-items-dialog')).not.toBeInTheDocument();
  });
});
