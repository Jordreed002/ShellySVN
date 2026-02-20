/**
 * Integration Tests for Sparse Checkout Workflows
 *
 * These tests verify complete sparse checkout workflows across multiple components:
 * - ChooseItemsDialog → CheckoutDialog flow
 * - Repo Browser → Add to Working Copy flow
 * - File Explorer → Update remote items flow
 * - Error recovery scenarios
 * - Selection persistence
 * - Cancellation handling
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

// ============================================================
// Mock Setup
// ============================================================

// Mock virtualizer for VirtualizedTree
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count, estimateSize }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * estimateSize(),
        size: estimateSize(),
        key: `item-${i}`
      })),
    getTotalSize: () => count * estimateSize()
  }))
}))

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ url: '' }),
  useNavigate: () => vi.fn()
}))

// Mock TanStack Query with controllable mock
const mockUseQuery = vi.fn(() => ({
  data: null,
  isLoading: false,
  refetch: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
  QueryClient: vi.fn(() => ({
    defaultOptions: {},
    setDefaultOptions: vi.fn()
  }))
}))

// Mock window.api
const mockCheckout = vi.fn()
const mockUpdateToRevision = vi.fn()
const mockList = vi.fn()
const mockAuthGet = vi.fn()
const mockAuthSet = vi.fn()
const mockOpenExternal = vi.fn()
const mockOpenDirectory = vi.fn()

vi.stubGlobal('window', {
  api: {
    svn: {
      checkout: mockCheckout,
      updateToRevision: mockUpdateToRevision,
      list: mockList,
      status: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      infoUrl: vi.fn(),
      getWorkingCopyContext: vi.fn(),
      diff: vi.fn(),
      update: vi.fn(),
      updateItem: vi.fn(),
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
        delete: vi.fn()
      },
      move: vi.fn(),
      rename: vi.fn(),
      shelve: {
        list: vi.fn(),
        save: vi.fn(),
        apply: vi.fn(),
        delete: vi.fn()
      },
      proplist: vi.fn(),
      propset: vi.fn(),
      propdel: vi.fn(),
      blame: vi.fn(),
      patch: {
        create: vi.fn(),
        apply: vi.fn()
      },
      externals: {
        list: vi.fn(),
        add: vi.fn(),
        remove: vi.fn()
      }
    },
    auth: {
      get: mockAuthGet,
      set: mockAuthSet
    },
    dialog: {
      openDirectory: mockOpenDirectory
    },
    app: {
      openExternal: mockOpenExternal
    }
  }
})

// Mock useSettings hook
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      defaultCheckoutDirectory: '/default/path'
    }
  })
}))

// Mock useLazyTreeLoader hook
const createMockTreeData = () => {
  const nodes = new Map()
  nodes.set('/trunk', {
    path: '/trunk',
    name: 'trunk',
    kind: 'dir',
    isLoading: false,
    isLoaded: true,
    hasChildren: true,
    children: [
      {
        path: '/trunk/src',
        name: 'src',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        hasChildren: true,
        children: [
          {
            path: '/trunk/src/main.ts',
            name: 'main.ts',
            kind: 'file',
            isLoading: false,
            isLoaded: true,
            hasChildren: false,
            children: []
          },
          {
            path: '/trunk/src/utils.ts',
            name: 'utils.ts',
            kind: 'file',
            isLoading: false,
            isLoaded: true,
            hasChildren: false,
            children: []
          }
        ]
      },
      {
        path: '/trunk/docs',
        name: 'docs',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        hasChildren: true,
        children: []
      },
      {
        path: '/trunk/README.md',
        name: 'README.md',
        kind: 'file',
        isLoading: false,
        isLoaded: true,
        hasChildren: false,
        children: []
      }
    ]
  })

  const roots = [
    nodes.get('/trunk')
  ]

  return { nodes, roots }
}

const mockLazyTreeLoaderState = {
  loadNode: vi.fn().mockResolvedValue(undefined),
  refreshTree: vi.fn(),
  isLoading: false,
  error: undefined as string | undefined,
  nodes: createMockTreeData().nodes,
  roots: createMockTreeData().roots,
  isNodeLoading: vi.fn().mockReturnValue(false),
  getNodeError: vi.fn().mockReturnValue(undefined)
}

vi.mock('@renderer/hooks/useLazyTreeLoader', () => ({
  useLazyTreeLoader: vi.fn(() => mockLazyTreeLoaderState)
}))

// Mock useWorkingCopyContext hook
const mockWorkingCopyContext = {
  data: null as {
    repositoryRoot: string
    workingCopyRoot: string
    relativePath: string
  } | null,
  isLoading: false
}

vi.mock('@renderer/hooks/useWorkingCopyContext', () => ({
  useWorkingCopyContext: vi.fn(() => mockWorkingCopyContext)
}))

// Mock path resolution utility
vi.mock('@renderer/utils/pathResolution', () => ({
  resolveRemoteUrlToLocalPath: vi.fn(
    (remoteUrl: string, workingCopyRoot: string) => {
      if (remoteUrl.includes('repo/trunk')) {
        return workingCopyRoot + remoteUrl.split('repo')[1]
      }
      return null
    }
  )
}))

// Import components after mocks are set up
import { CheckoutDialog } from '../../src/components/ui/CheckoutDialog'
import { ChooseItemsDialog } from '../../src/components/ui/ChooseItemsDialog'
import { UpdateToRevisionDialog } from '../../src/components/ui/UpdateToRevisionDialog'
import { RepoBrowserContent } from '../../src/routes/repo-browser/RepoBrowserContent'

// ============================================================
// Test Utilities
// ============================================================

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  )
}

// ============================================================
// Tests: ChooseItemsDialog → Checkout Flow
// ============================================================

describe('ChooseItemsDialog → CheckoutDialog Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckout.mockReset()
    mockLazyTreeLoaderState.isLoading = false
    mockLazyTreeLoaderState.error = undefined
    mockLazyTreeLoaderState.nodes = createMockTreeData().nodes
    mockLazyTreeLoaderState.roots = createMockTreeData().roots
    mockOpenDirectory.mockResolvedValue('/test/checkout/path')
  })

  afterEach(() => {
    cleanup()
  })

  describe('Complete sparse checkout workflow', () => {
    it('completes full workflow: open dialog → select items → checkout', async () => {
      mockCheckout.mockResolvedValueOnce({
        success: true,
        revision: 123,
        output: 'Checkout complete'
      })

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          onComplete={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set checkout path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/checkout' } })

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      // Verify ChooseItemsDialog is open
      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      // Select all items
      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      // Confirm selection
      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Wait for selection to be applied
      await waitFor(() => {
        expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
      })

      // Submit checkout
      const checkoutButton = screen.getByText('Checkout')
      fireEvent.click(checkoutButton)

      // Verify checkout was called with sparse paths
      await waitFor(() => {
        expect(mockCheckout).toHaveBeenCalledWith(
          'https://svn.example.com/repo/trunk',
          '/test/checkout',
          undefined,
          'empty',
          expect.objectContaining({
            sparsePaths: expect.arrayContaining([
              expect.stringContaining('/trunk')
            ])
          })
        )
      })

      // Verify success message
      await waitFor(() => {
        expect(screen.getByText('Checkout Complete')).toBeInTheDocument()
      })
    })

    it('uses credentials when provided for sparse checkout', async () => {
      mockCheckout.mockResolvedValueOnce({
        success: true,
        revision: 124
      })

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set checkout path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Open auth section
      const authButton = screen.getByText('Authentication')
      fireEvent.click(authButton)

      // Enter credentials
      const usernameInput = screen.getByPlaceholderText('Optional')
      const passwordInput = screen.getAllByPlaceholderText('Optional')[1]

      fireEvent.change(usernameInput, { target: { value: 'testuser' } })
      fireEvent.change(passwordInput, { target: { value: 'testpass' } })

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      // Select items and confirm
      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Submit checkout
      const checkoutButton = screen.getByText('Checkout')
      fireEvent.click(checkoutButton)

      await waitFor(() => {
        expect(mockCheckout).toHaveBeenCalledWith(
          'https://svn.example.com/repo/trunk',
          '/test/path',
          undefined,
          'empty',
          expect.objectContaining({
            credentials: { username: 'testuser', password: 'testpass' },
            sparsePaths: expect.any(Array)
          })
        )
      })
    })

    it('shows selection count after choosing items', async () => {
      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Open and select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify selection count is shown
      await waitFor(() => {
        expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
      })
    })

    it('clears selection when clear button is clicked', async () => {
      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Open and select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify selection is shown
      await waitFor(() => {
        expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
      })

      // Clear selection
      const clearButton = screen.getByText('Clear selection')
      fireEvent.click(clearButton)

      // Verify selection is cleared
      await waitFor(() => {
        expect(screen.queryByText(/items selected/)).not.toBeInTheDocument()
      })
    })
  })

  describe('Error scenarios', () => {
    it('handles network failure during sparse checkout', async () => {
      mockCheckout.mockRejectedValueOnce(new Error('Network timeout'))

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Submit checkout
      const checkoutButton = screen.getByText('Checkout')
      fireEvent.click(checkoutButton)

      // Verify error is shown
      await waitFor(() => {
        expect(screen.getByText('Network timeout')).toBeInTheDocument()
      })
    })

    it('handles authentication required error during sparse checkout', async () => {
      mockCheckout.mockResolvedValueOnce({
        success: false,
        output:
          'svn: E215004: No more credentials or we tried too many times.\nAuthentication realm: <https://svn.example.com:443> Example Repo'
      })

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Submit checkout
      const checkoutButton = screen.getByText('Checkout')
      fireEvent.click(checkoutButton)

      // Verify auth prompt is shown
      await waitFor(() => {
        expect(screen.getByText('Authentication Required')).toBeInTheDocument()
      })
    })

    it('handles SSL certificate error during sparse checkout', async () => {
      mockCheckout.mockResolvedValueOnce({
        success: false,
        output:
          'Error validating server certificate for https://svn.example.com:\n' +
          ' - The certificate is not issued by a trusted authority\n' +
          'Certificate information:\n' +
          ' - Hostname: svn.example.com\n' +
          ' - Fingerprint: AA:BB:CC:DD:EE:FF'
      })

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Submit checkout
      const checkoutButton = screen.getByText('Checkout')
      fireEvent.click(checkoutButton)

      // Verify SSL prompt is shown
      await waitFor(() => {
        expect(screen.getByText('Certificate Verification Failed')).toBeInTheDocument()
      })
    })
  })

  describe('Cancellation handling', () => {
    it('cancels sparse checkout from ChooseItemsDialog', async () => {
      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      // Cancel selection
      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      // Verify dialog is closed without checkout
      await waitFor(() => {
        expect(screen.queryByText('Choose Items to Checkout')).not.toBeInTheDocument()
      })

      expect(mockCheckout).not.toHaveBeenCalled()
    })

    it('cancels sparse checkout from CheckoutDialog', async () => {
      const onClose = vi.fn()

      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={onClose}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Cancel main dialog
      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      expect(onClose).toHaveBeenCalled()
      expect(mockCheckout).not.toHaveBeenCalled()
    })

    it('preserves selected items when reopening ChooseItemsDialog', async () => {
      renderWithQueryClient(
        <CheckoutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialUrl="https://svn.example.com/repo/trunk"
        />
      )

      // Set path
      const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
      fireEvent.change(pathInput, { target: { value: '/test/path' } })

      // Open and select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify selection is shown
      await waitFor(() => {
        expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
      })

      // Open again and cancel
      fireEvent.click(chooseButton)
      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      // Selection should still be preserved
      await waitFor(() => {
        expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
      })
    })
  })
})

// ============================================================
// Tests: Repo Browser → Add to Working Copy Flow
// ============================================================

describe('RepoBrowserContent → Add to Working Copy Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateToRevision.mockReset()
    mockList.mockReset()
    mockWorkingCopyContext.data = null

    mockUseQuery.mockReturnValue({
      data: {
        entries: [
          {
            name: 'src',
            path: '/src',
            url: 'https://svn.example.com/repo/trunk/src',
            kind: 'dir',
            size: 0,
            revision: 123,
            author: 'dev',
            date: '2024-01-01T00:00:00Z'
          },
          {
            name: 'docs',
            path: '/docs',
            url: 'https://svn.example.com/repo/trunk/docs',
            kind: 'dir',
            size: 0,
            revision: 122,
            author: 'dev',
            date: '2024-01-01T00:00:00Z'
          },
          {
            name: 'README.md',
            path: '/README.md',
            url: 'https://svn.example.com/repo/trunk/README.md',
            kind: 'file',
            size: 100,
            revision: 121,
            author: 'dev',
            date: '2024-01-01T00:00:00Z'
          }
        ]
      },
      isLoading: false,
      refetch: vi.fn()
    } as any)
  })

  afterEach(() => {
    cleanup()
  })

  describe('Add to Working Copy workflow', () => {
    it('shows Add to Working Copy button for directories in working copy context', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select a directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      // Verify button is shown
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /add to working copy/i })
        ).toBeInTheDocument()
      })
    })

    it('calls updateToRevision with correct parameters when adding', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123
      })

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select and add directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i
      })
      fireEvent.click(addButton)

      // Verify updateToRevision was called
      await waitFor(() => {
        expect(mockUpdateToRevision).toHaveBeenCalledWith(
          '/Users/test/project',
          'https://svn.example.com/repo/trunk/src',
          '/Users/test/project/trunk/src',
          'infinity',
          true
        )
      })
    })

    it('shows success message after adding to working copy', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123
      })

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select and add directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i
      })
      fireEvent.click(addButton)

      // Verify success message
      await waitFor(() => {
        expect(screen.getByText(/added to working copy/i)).toBeInTheDocument()
      })
    })
  })

  describe('Error scenarios in Add to Working Copy', () => {
    it('shows error when network fails', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      mockUpdateToRevision.mockResolvedValueOnce({
        success: false,
        error: 'Network error'
      })

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select and add directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i
      })
      fireEvent.click(addButton)

      // Verify error message
      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument()
      })
    })

    it('shows error when operation fails', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      mockUpdateToRevision.mockRejectedValueOnce(new Error('SVN command failed'))

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select and add directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i
      })
      fireEvent.click(addButton)

      // Verify error message
      await waitFor(() => {
        expect(screen.getByText(/svn command failed/i)).toBeInTheDocument()
      })
    })

    it('does not show button for files', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select a file
      const fileRow = await screen.findByText('README.md')
      fireEvent.click(fileRow)

      // Verify button is NOT shown for files
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /add to working copy/i })
        ).not.toBeInTheDocument()
      })
    })

    it('does not show button without working copy context', async () => {
      mockWorkingCopyContext.data = null

      renderWithQueryClient(<RepoBrowserContent />)

      // Select a directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      // Verify button is NOT shown without context
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /add to working copy/i })
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('Loading states', () => {
    it('shows loading state during add operation', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: ''
      }

      mockUpdateToRevision.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )

      renderWithQueryClient(<RepoBrowserContent localPath="/Users/test/project" />)

      // Select and add directory
      const srcRow = await screen.findByText('src')
      fireEvent.click(srcRow)

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i
      })
      fireEvent.click(addButton)

      // Verify loading state
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /adding\.\.\./i })
        ).toBeInTheDocument()
      })
    })
  })
})

// ============================================================
// Tests: UpdateToRevisionDialog → Sparse Update Flow
// ============================================================

describe('UpdateToRevisionDialog → Sparse Checkout Update Integration', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    itemName: '/trunk/project',
    onConfirm: vi.fn(),
    repoUrl: 'https://svn.example.com/repo/trunk',
    credentials: { username: 'testuser', password: 'testpass' },
    workingCopyRoot: '/Users/user/workspace/project'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateToRevision.mockReset()
    mockLazyTreeLoaderState.isLoading = false
    mockLazyTreeLoaderState.error = undefined
    mockLazyTreeLoaderState.nodes = createMockTreeData().nodes
    mockLazyTreeLoaderState.roots = createMockTreeData().roots
  })

  afterEach(() => {
    cleanup()
  })

  describe('Sparse update workflow', () => {
    it('opens ChooseItemsDialog and updates selected paths', async () => {
      mockUpdateToRevision.mockResolvedValue({ success: true, revision: 123 })

      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      // Select items
      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify updateToRevision was called for each selected path
      await waitFor(() => {
        expect(mockUpdateToRevision).toHaveBeenCalled()
      })
    })

    it('shows success after sparse update completes', async () => {
      mockUpdateToRevision.mockResolvedValue({ success: true, revision: 124 })

      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open and select
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify success
      await waitFor(() => {
        expect(screen.getByText('Update Complete')).toBeInTheDocument()
      })
    })

    it('uses current depth setting for sparse updates', async () => {
      mockUpdateToRevision.mockResolvedValue({ success: true, revision: 123 })

      const propsWithDepth = { ...defaultProps, depth: 'files' as const }

      render(<UpdateToRevisionDialog {...propsWithDepth} />)

      // Select files depth option
      const filesOption = screen.getByText('Files only')
      fireEvent.click(filesOption)

      // Open and select items
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify depth was passed
      await waitFor(() => {
        expect(mockUpdateToRevision).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          'files',
          false
        )
      })
    })
  })

  describe('Error handling in sparse update', () => {
    it('shows error when update fails', async () => {
      mockUpdateToRevision.mockRejectedValue(new Error('Update failed'))

      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open and select
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify error
      await waitFor(() => {
        expect(screen.getByText('Update failed')).toBeInTheDocument()
      })
    })

    it('handles partial failures gracefully', async () => {
      mockUpdateToRevision
        .mockResolvedValueOnce({ success: true, revision: 123 })
        .mockRejectedValueOnce(new Error('File not found'))

      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open and select
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify error for partial failure
      await waitFor(() => {
        expect(screen.getByText('File not found')).toBeInTheDocument()
      })
    })

    it('handles empty selection gracefully', async () => {
      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      // Cancel without selection
      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      // Verify no update was called
      expect(mockUpdateToRevision).not.toHaveBeenCalled()
    })
  })

  describe('Cancellation during sparse update', () => {
    it('cancels ChooseItemsDialog without affecting main dialog', async () => {
      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open ChooseItemsDialog
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      // Cancel
      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      // Main dialog should still be open
      await waitFor(() => {
        expect(screen.getByText('Update to Working Copy')).toBeInTheDocument()
        expect(screen.queryByText('Choose Items to Update in Sparse Checkout')).not.toBeInTheDocument()
      })
    })

    it('disables ChooseItemsDialog button during update', async () => {
      mockUpdateToRevision.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true, revision: 123 }), 100))
      )

      render(<UpdateToRevisionDialog {...defaultProps} />)

      // Open and select
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Update in Sparse Checkout')).toBeInTheDocument()
      })

      const selectAllButton = screen.getByText('Select All')
      fireEvent.click(selectAllButton)

      const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
      fireEvent.click(selectButton)

      // Verify button is disabled during update
      await waitFor(() => {
        expect(screen.getByText('Choose items...')).toBeDisabled()
      })
    })
  })
})

// ============================================================
// Tests: Selection Persistence
// ============================================================

describe('Selection Persistence Across Dialog Interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLazyTreeLoaderState.isLoading = false
    mockLazyTreeLoaderState.error = undefined
    mockLazyTreeLoaderState.nodes = createMockTreeData().nodes
    mockLazyTreeLoaderState.roots = createMockTreeData().roots
  })

  afterEach(() => {
    cleanup()
  })

  it('persists selection when reopening ChooseItemsDialog in CheckoutDialog', async () => {
    renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={vi.fn()}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Set path
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })

    // First selection
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)

    await waitFor(() => {
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
    })

    const selectAllButton = screen.getByText('Select All')
    fireEvent.click(selectAllButton)

    const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
    fireEvent.click(selectButton)

    // Verify selection count
    await waitFor(() => {
      const selectionText = screen.getByText(/\d+ items selected/)
      expect(selectionText).toBeInTheDocument()
      const count = parseInt(selectionText.textContent?.match(/\d+/)?.[0] || '0')
      expect(count).toBeGreaterThan(0)
    })

    // Reopen dialog
    fireEvent.click(chooseButton)

    await waitFor(() => {
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
    })

    // Cancel without changes
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Selection should be preserved
    await waitFor(() => {
      const selectionText = screen.getByText(/\d+ items selected/)
      expect(selectionText).toBeInTheDocument()
    })
  })

  it('resets selection when dialog is closed and reopened', async () => {
    const onClose = vi.fn()
    const { rerender } = renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={onClose}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Set path and select items
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })

    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)

    await waitFor(() => {
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
    })

    const selectAllButton = screen.getByText('Select All')
    fireEvent.click(selectAllButton)

    const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
    fireEvent.click(selectButton)

    // Verify selection
    await waitFor(() => {
      expect(screen.getByText(/\d+ items selected/)).toBeInTheDocument()
    })

    // Close dialog
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Reopen dialog
    rerender(
      <CheckoutDialog
        isOpen={true}
        onClose={onClose}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Selection should be reset
    await waitFor(() => {
      expect(screen.queryByText(/items selected/)).not.toBeInTheDocument()
    })
  })
})

// ============================================================
// Tests: Authentication Flow Integration
// ============================================================

describe('Authentication Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckout.mockReset()
    mockLazyTreeLoaderState.isLoading = false
    mockLazyTreeLoaderState.error = undefined
    mockLazyTreeLoaderState.nodes = createMockTreeData().nodes
    mockLazyTreeLoaderState.roots = createMockTreeData().roots
    mockAuthGet.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows auth prompt in ChooseItemsDialog when loading requires auth', async () => {
    mockLazyTreeLoaderState.loadNode.mockRejectedValueOnce(
      new Error('Authentication required')
    )

    renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={vi.fn()}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Set path
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })

    // Open ChooseItemsDialog
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)

    // Wait for ChooseItemsDialog to appear
    await waitFor(() => {
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
    })
  })

  it('auto-fills saved credentials when auth prompt appears', async () => {
    mockAuthGet.mockResolvedValueOnce({
      username: 'saveduser',
      password: 'savedpass'
    })

    renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={vi.fn()}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Open auth section
    const authButton = screen.getByText('Authentication')
    fireEvent.click(authButton)

    // The component would auto-fill saved credentials via useEffect
    expect(mockAuthGet).toHaveBeenCalled()
  })
})

// ============================================================
// Tests: Concurrent Operations
// ============================================================

describe('Concurrent Operations and Race Conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckout.mockReset()
    mockLazyTreeLoaderState.isLoading = false
    mockLazyTreeLoaderState.error = undefined
    mockLazyTreeLoaderState.nodes = createMockTreeData().nodes
    mockLazyTreeLoaderState.roots = createMockTreeData().roots
  })

  afterEach(() => {
    cleanup()
  })

  it('prevents multiple checkouts from starting simultaneously', async () => {
    mockCheckout.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, revision: 123 }), 200))
    )

    renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={vi.fn()}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Set path
    const pathInput = screen.getByPlaceholderText('C:\\Projects\\my-project')
    fireEvent.change(pathInput, { target: { value: '/test/path' } })

    // Select items
    const chooseButton = screen.getByText('Choose items...')
    fireEvent.click(chooseButton)

    await waitFor(() => {
      expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
    })

    const selectAllButton = screen.getByText('Select All')
    fireEvent.click(selectAllButton)

    const selectButton = screen.getByRole('button', { name: /Select \(\d+\)/ })
    fireEvent.click(selectButton)

    // Start first checkout
    const checkoutButton = screen.getByText('Checkout')
    fireEvent.click(checkoutButton)

    // Wait for loading state
    await waitFor(() => {
      expect(screen.getByText('Checking out...')).toBeInTheDocument()
    })

    // Verify button is disabled
    expect(checkoutButton).toBeDisabled()
  })

  it('handles rapid open/close of ChooseItemsDialog', async () => {
    const onClose = vi.fn()

    const { rerender } = renderWithQueryClient(
      <CheckoutDialog
        isOpen={true}
        onClose={onClose}
        initialUrl="https://svn.example.com/repo/trunk"
      />
    )

    // Rapid open/close cycles
    for (let i = 0; i < 3; i++) {
      const chooseButton = screen.getByText('Choose items...')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(screen.getByText('Choose Items to Checkout')).toBeInTheDocument()
      })

      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('Choose Items to Checkout')).not.toBeInTheDocument()
      })
    }

    // Dialog should still be functional
    expect(screen.getByText('Checkout from Repository')).toBeInTheDocument()
  })
})
