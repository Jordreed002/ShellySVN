import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

import { UpdateToRevisionDialog } from '../src/components/ui/UpdateToRevisionDialog'
import { ChooseItemsDialog } from '../src/components/ui/ChooseItemsDialog'
import type { AuthCredential } from '@shared/types'

// Mock the ChooseItemsDialog component
vi.mock('../src/components/ui/ChooseItemsDialog', () => ({
  ChooseItemsDialog: vi.fn(({ isOpen, repoUrl, credentials, onSelect, onCancel, title }) => {
    if (!isOpen) return null
    return (
      <div data-testid="choose-items-dialog">
        <h3>{title}</h3>
        <div>Repository: {repoUrl}</div>
        <div>Credentials: {credentials ? 'Present' : 'None'}</div>
        <button onClick={() => onSelect(['/trunk/src/file1.ts', '/trunk/src/file2.ts'])}>
          Select Files
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    )
  })
}))

// Mock window.api.svn.updateToRevision
const mockUpdateToRevision = vi.fn()
window.api = {
  svn: {
    updateToRevision: mockUpdateToRevision
  }
}

const mockOnConfirm = vi.fn()
  .mockResolvedValueOnce({ success: true, revision: 123 })
  .mockResolvedValueOnce({ success: false, revision: 0, error: 'Update failed' })

describe('UpdateToRevisionDialog - ChooseItemsDialog Integration', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    itemName: '/trunk/project',
    onConfirm: mockOnConfirm,
    repoUrl: 'https://svn.example.com/repo/trunk',
    credentials: { username: 'testuser', password: 'testpass' } as AuthCredential,
    workingCopyRoot: '/Users/user/workspace/project'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateToRevision.mockClear()
    mockOnConfirm.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders normally with basic props', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    expect(screen.getByText('Update to Working Copy')).toBeInTheDocument()
    expect(screen.getByText('Update depth for:')).toBeInTheDocument()
    expect(screen.getByText('/trunk/project')).toBeInTheDocument()
    expect(screen.getByText('Fully recursive')).toBeInTheDocument()
    expect(screen.getByText('Choose items...')).toBeInTheDocument()
  })

  it('does not render "Choose items..." button when repoUrl or workingCopyRoot is missing', () => {
    const propsWithoutRepo = { ...defaultProps, repoUrl: undefined }
    const propsWithoutWcRoot = { ...defaultProps, workingCopyRoot: undefined }
    
    const { rerender } = render(<UpdateToRevisionDialog {...propsWithoutRepo} />)
    expect(screen.queryByText('Choose items...')).not.toBeInTheDocument()
    
    rerender(<UpdateToRevisionDialog {...propsWithoutWcRoot} />)
    expect(screen.queryByText('Choose items...')).not.toBeInTheDocument()
  })

  it('opens ChooseItemsDialog when "Choose items..." button is clicked', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    expect(screen.getByTestId('choose-items-dialog')).toBeInTheDocument()
    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        repoUrl: 'https://svn.example.com/repo/trunk',
        credentials: { username: 'testuser', password: 'testpass' },
        title: 'Choose Items to Update in Sparse Checkout'
      }),
      {}
    )
  })

  it('calls updateToRevision for selected paths when ChooseItemsDialog confirms', async () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Select files and confirm
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(mockUpdateToRevision).toHaveBeenCalledWith(
        '/Users/user/workspace/project',
        'https://svn.example.com/repo/trunk',
        '/trunk/src/file1.ts',
        'infinity',
        false
      )
      expect(mockUpdateToRevision).toHaveBeenCalledWith(
        '/Users/user/workspace/project',
        'https://svn.example.com/repo/trunk',
        '/trunk/src/file2.ts',
        'infinity',
        false
      )
    })
  })

  it('handles multiple sparse checkout updates with success', async () => {
    mockUpdateToRevision.mockResolvedValue({ success: true, revision: 124 })
    
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('Update Complete')).toBeInTheDocument()
      expect(screen.getByText('Updated to revision 124')).toBeInTheDocument()
    })
  })

  it('handles multiple sparse checkout updates with failure', async () => {
    mockUpdateToRevision.mockRejectedValue(new Error('Network error'))
    
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('handles sparse checkout update with partial failures', async () => {
    mockUpdateToRevision
      .mockResolvedValueOnce({ success: true, revision: 123 })
      .mockRejectedValueOnce(new Error('File not found'))
    
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument()
    })
  })

  it('preserves existing depth and sticky settings for sparse checkout', async () => {
    const propsWithDepth = { ...defaultProps, depth: 'files' as const }
    
    render(<UpdateToRevisionDialog {...propsWithDepth} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(mockUpdateToRevision).toHaveBeenCalledWith(
        '/Users/user/workspace/project',
        'https://svn.example.com/repo/trunk',
        '/trunk/src/file1.ts',
        'files',
        false
      )
    })
  })

  it('handles ChooseItemsDialog cancellation gracefully', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Cancel ChooseItemsDialog
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)
    
    expect(screen.queryByTestId('choose-items-dialog')).not.toBeInTheDocument()
  })

  it('disables ChooseItemsDialog button when updating', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Simulate ongoing update
    mockUpdateToRevision.mockImplementation(() => new Promise(() => {}))
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Choose items button should be disabled during update
    expect(screen.getByText('Choose items...')).toBeDisabled()
  })

  it('integrates with existing depth selection functionality', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Test that depth selection still works normally
    const depthOption = screen.getByText('Files only')
    fireEvent.click(depthOption)
    
    expect(screen.getByText('Update')).toBeInTheDocument()
    expect(screen.getByText('Choose items...')).toBeInTheDocument()
  })
})

describe('UpdateToRevisionDialog - Sparse Checkout Error Scenarios', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    itemName: '/trunk/project',
    onConfirm: vi.fn(),
    repoUrl: 'https://svn.example.com/repo/trunk',
    credentials: { username: 'testuser', password: 'testpass' } as AuthCredential,
    workingCopyRoot: '/Users/user/workspace/project'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateToRevision.mockClear()
  })

  it('handles API errors gracefully during sparse checkout', async () => {
    mockUpdateToRevision.mockRejectedValue(new Error('SVN command failed'))
    
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('SVN command failed')).toBeInTheDocument()
    })
  })

  it('handles missing credentials in ChooseItemsDialog', () => {
    const propsWithoutCredentials = { ...defaultProps, credentials: undefined }
    
    render(<UpdateToRevisionDialog {...propsWithoutCredentials} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: undefined
      }),
      {}
    )
  })

  it('handles empty selected paths gracefully', () => {
    render(<UpdateToRevisionDialog {...defaultProps} />)
    
    // Mock ChooseItemsDialog to return empty array
    const ChooseItemsDialogMock = vi.requireMock('../src/components/ui/ChooseItemsDialog')
      .ChooseItemsDialog
    
    ChooseItemsDialogMock.mockImplementation(({ onSelect, ...props }) => {
      return (
        <div data-testid="choose-items-dialog">
          <button onClick={() => onSelect([])}>Empty Selection</button>
          <button onClick={() => onSelect(['/trunk/file.txt'])}>Valid Selection</button>
        </div>
      )
    })
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const emptyButton = screen.getByText('Empty Selection')
    fireEvent.click(emptyButton)
    
    // Should not call updateToRevision for empty selection
    expect(mockUpdateToRevision).not.toHaveBeenCalled()
  })
})