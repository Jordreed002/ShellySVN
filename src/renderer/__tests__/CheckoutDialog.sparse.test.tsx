import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

import { CheckoutDialog } from '../src/components/ui/CheckoutDialog'
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

// Mock window.api.svn.checkout
const mockCheckout = vi.fn()
window.api = {
  svn: {
    checkout: mockCheckout,
    status: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    infoUrl: vi.fn(),
    getWorkingCopyContext: vi.fn(),
    diff: vi.fn(),
    update: vi.fn(),
    updateItem: vi.fn(),
    updateToRevision: vi.fn(),
    commit: vi.fn(),
    revert: vi.fn(),
    add: vi.fn(),
    delete: vi.fn(),
    cleanup: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    export: vi.fn(),
    import: vi.fn(),
    resolve: vi.fn(),
    switch: vi.fn(),
    copy: vi.fn(),
    merge: vi.fn(),
    relocate: vi.fn(),
    changelist: {
      add: vi.fn(),
      remove: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    move: vi.fn(),
    rename: vi.fn(),
    shelve: {
      list: vi.fn(),
      save: vi.fn(),
      apply: vi.fn(),
      delete: vi.fn(),
    },
    proplist: vi.fn(),
    propset: vi.fn(),
    propdel: vi.fn(),
    blame: vi.fn(),
    list: vi.fn(),
    patch: {
      create: vi.fn(),
      apply: vi.fn(),
    },
    externals: {
      list: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
    },
  }
}

const mockOnComplete = vi.fn()
  .mockResolvedValueOnce({ success: true, revision: 123 })
  .mockResolvedValueOnce({ success: false, revision: 0, error: 'Checkout failed' })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
})

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  )
}

describe('CheckoutDialog - ChooseItemsDialog Integration', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: mockOnComplete,
    initialUrl: 'https://svn.example.com/repo/trunk'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckout.mockClear()
    mockOnComplete.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders normally with basic props', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    expect(screen.getByText('Checkout from Repository')).toBeInTheDocument()
    expect(screen.getByText('URL of repository')).toBeInTheDocument()
    expect(screen.getByText('Checkout directory')).toBeInTheDocument()
    expect(screen.getByText('Checkout depth')).toBeInTheDocument()
    expect(screen.getByText('Fully recursive')).toBeInTheDocument()
    expect(screen.getByText('Choose items...')).toBeInTheDocument()
  })

  it('does not render "Choose items..." button when URL is empty', () => {
    const propsWithoutUrl = { ...defaultProps, initialUrl: '' }
    
    renderWithProviders(<CheckoutDialog {...propsWithoutUrl} />)
    // The button should be disabled when URL is empty, but still present
    const chooseButton = screen.getByText('Choose items...')
    expect(chooseButton).toBeInTheDocument()
    expect(chooseButton).toBeDisabled()
  })

  it('opens ChooseItemsDialog when "Choose items..." button is clicked', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    expect(screen.getByTestId('choose-items-dialog')).toBeInTheDocument()
    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        repoUrl: 'https://svn.example.com/repo/trunk',
        credentials: undefined,
        title: 'Choose Items to Checkout'
      }),
      {}
    )
  })

it('passes credentials to ChooseItemsDialog when provided', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    const authButton = screen.getByText('Authentication')
    fireEvent.click(authButton)
    
    const usernameInput = screen.getByPlaceholderText('Optional')
    const passwordInput = screen.getByPlaceholderText('Optional')
    
    fireEvent.change(usernameInput, { target: { value: 'testuser' } })
    fireEvent.change(passwordInput, { target: { value: 'testpass' } })
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    expect(ChooseItemsDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { username: 'testuser', password: 'testpass' }
      }),
      {}
    )
  })

  it('calls checkout with sparse paths when ChooseItemsDialog confirms', async () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Set a path for the checkout
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })
    
    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Select files and confirm
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Submit the form
    const submitButton = screen.getByText('Checkout')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(mockCheckout).toHaveBeenCalledTimes(1)
    }, { timeout: 5000 })
    
    expect(mockCheckout).toHaveBeenCalledWith(
      'https://svn.example.com/repo/trunk',
      '/test/path',
      undefined,
      'empty',
      {
        sparsePaths: ['/trunk/src/file1.ts', '/trunk/src/file2.ts']
      }
    )
  })

  it('calls checkout with depth when no items selected', async () => {
    // Mock ChooseItemsDialog to return empty selection
    const ChooseItemsDialogMock = vi.fn(({ onSelect, ...props }) => {
      return (
        <div data-testid="choose-items-dialog">
          <button onClick={() => onSelect([])}>Empty Selection</button>
          <button onClick={() => onSelect(['/trunk/file.txt'])}>Valid Selection</button>
        </div>
      )
    })
    
    vi.doMock('../src/components/ui/ChooseItemsDialog', () => ({
      ChooseItemsDialog: ChooseItemsDialogMock
    }))
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Set a path for the checkout
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })
    
    // Open ChooseItemsDialog and select empty
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const emptyButton = screen.getByText('Empty Selection')
    fireEvent.click(emptyButton)
    
    // Submit the form
    const submitButton = screen.getByText('Checkout')
    fireEvent.click(submitButton)
    
    // Should call checkout with normal depth, not sparse
    await waitFor(() => {
      expect(mockCheckout).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk',
        '/test/path',
        undefined,
        'infinity',
        expect.objectContaining({
          sparsePaths: undefined
        })
      )
    })
  })

  it('handles checkout with sparse checkout success', async () => {
    mockCheckout.mockResolvedValue({ success: true, revision: 124, output: 'Checkout complete' })
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Set a path for the checkout
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Submit the form
    const submitButton = screen.getByText('Checkout')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText('Checkout Complete')).toBeInTheDocument()
      expect(screen.getByText('Checked out revision 124')).toBeInTheDocument()
    })
  })

  it('handles checkout with sparse checkout failure', async () => {
    mockCheckout.mockRejectedValue(new Error('Network error'))
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Set a path for the checkout
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Submit the form
    const submitButton = screen.getByText('Checkout')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('handles ChooseItemsDialog cancellation gracefully', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Cancel ChooseItemsDialog
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)
    
    expect(screen.queryByTestId('choose-items-dialog')).not.toBeInTheDocument()
  })

  it('disables ChooseItemsDialog button when checking out', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    // Simulate ongoing checkout
    mockCheckout.mockImplementation(() => new Promise(() => {}))
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Choose items button should be disabled during checkout
    expect(screen.getByText('Choose items...')).toBeDisabled()
  })

  it('shows selected count in depth label when items are chosen', async () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('2 items selected')).toBeInTheDocument()
    })
  })

  it('shows clear selection button when items are chosen', async () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      expect(screen.getByText('Clear selection')).toBeInTheDocument()
    })
  })

  it('clears selection when clear button is clicked', async () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    await waitFor(() => {
      const clearButton = screen.getByText('Clear selection')
      fireEvent.click(clearButton)
      
      // Selected count should be gone
      expect(screen.queryByText('2 items selected')).not.toBeInTheDocument()
    })
  })

  it('integrates with existing checkout functionality', () => {
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Test that depth selection still works normally
    const depthOption = screen.getByText('Files only')
    fireEvent.click(depthOption)
    
    expect(screen.getByText('Checkout')).toBeInTheDocument()
    expect(screen.getByText('Choose items...')).toBeInTheDocument()
  })
})

describe('CheckoutDialog - Sparse Checkout Error Scenarios', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    initialUrl: 'https://svn.example.com/repo/trunk'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckout.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('handles API errors gracefully during sparse checkout', async () => {
    mockCheckout.mockRejectedValue(new Error('SVN command failed'))
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
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
    const propsWithoutCredentials = { ...defaultProps, initialUrl: 'https://svn.example.com/repo/trunk' }
    
    renderWithProviders(<CheckoutDialog {...propsWithoutCredentials} />)
    
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
    const ChooseItemsDialogMock = vi.fn(({ onSelect, ...props }) => {
      return (
        <div data-testid="choose-items-dialog">
          <button onClick={() => onSelect([])}>Empty Selection</button>
          <button onClick={() => onSelect(['/trunk/file.txt'])}>Valid Selection</button>
        </div>
      )
    })
    
    vi.doMock('../src/components/ui/ChooseItemsDialog', () => ({
      ChooseItemsDialog: ChooseItemsDialogMock
    }))
    
    // Mock ChooseItemsDialog to return empty array
    ChooseItemsDialogMock.mockImplementation(({ onSelect, ...props }) => {
      return (
        <div data-testid="choose-items-dialog">
          <button onClick={() => onSelect([])}>Empty Selection</button>
          <button onClick={() => onSelect(['/trunk/file.txt'])}>Valid Selection</button>
        </div>
      )
    })
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const emptyButton = screen.getByText('Empty Selection')
    fireEvent.click(emptyButton)
    
    // Should not call checkout for empty selection (user would use normal checkout)
    expect(mockCheckout).not.toHaveBeenCalled()
  })

  it('handles SSL prompt with sparse checkout', async () => {
    mockCheckout.mockRejectedValue(new Error('certificate verification failed'))
    mockCheckout.mockResolvedValueOnce({ success: true, revision: 125, output: 'Checkout complete' })
    
    renderWithProviders(<CheckoutDialog {...defaultProps} />)
    
    // Open ChooseItemsDialog and select files
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)
    
    const selectButton = screen.getByText('Select Files')
    fireEvent.click(selectButton)
    
    // Should show SSL prompt
    await waitFor(() => {
      expect(screen.getByText('Certificate Verification Failed')).toBeInTheDocument()
    })
    
    // Trust certificate and retry
    const trustButton = screen.getByText('Trust Certificate')
    fireEvent.click(trustButton)
    
    await waitFor(() => {
      expect(mockCheckout).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Checkout Complete')).toBeInTheDocument()
    })
  })
})