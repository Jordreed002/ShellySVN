import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockSvnList = vi.fn()
const mockSvnInfo = vi.fn()
const mockFsListDirectory = vi.fn()
const mockFsIsVersioned = vi.fn()
const mockFsGetStatus = vi.fn()
const mockFsGetDeepStatus = vi.fn()
const mockFsGetParent = vi.fn()
const mockAuthGet = vi.fn()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0
    }
  }
})

window.api = {
  svn: {
    list: mockSvnList,
    info: mockSvnInfo,
    getWorkingCopyContext: vi.fn().mockResolvedValue(null),
    updateToRevision: vi.fn().mockResolvedValue({ success: true, revision: 123 })
  },
  fs: {
    listDirectory: mockFsListDirectory,
    isVersioned: mockFsIsVersioned,
    getStatus: mockFsGetStatus,
    getDeepStatus: mockFsGetDeepStatus,
    getParent: mockFsGetParent
  },
  auth: {
    get: mockAuthGet
  },
  app: {
    openExternal: vi.fn()
  }
}

const mockNavigate = vi.fn()
const mockUseSearch = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockUseSearch(),
  useNavigate: () => mockNavigate
}))

const mockSettings = {
  showFolderSizes: false,
  compactFileRows: false,
  showThumbnails: false,
  globalIgnorePatterns: [],
  bookmarks: [],
  fileListHeight: 'fill' as const,
  addRecentPath: vi.fn()
}

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings, addRecentPath: vi.fn(), addBookmark: vi.fn(), removeBookmark: vi.fn() })
}))

vi.mock('../src/hooks/useFolderSizes', () => ({
  useFolderSizes: () => ({ folderSizes: {} })
}))

vi.mock('../src/hooks/useSvnActions', () => ({
  useFileExplorerActions: () => ({
    handleUpdate: vi.fn(),
    handleCommit: vi.fn(),
    handleCommitSelected: vi.fn(),
    handleRevertSelected: vi.fn(),
    handleAddSelected: vi.fn(),
    handleDeleteSelected: vi.fn(),
    commitDialogOpen: false,
    closeCommitDialog: vi.fn(),
    handleSubmitCommit: vi.fn(),
    isUpdating: false
  })
}))

vi.mock('../src/components/ui/DualPaneView', () => ({
  useDualPane: () => ({ isDualPane: false, toggleDualPane: vi.fn() })
}))

const FileExplorer = React.lazy(() => import('../src/components/FileExplorer').then(m => ({ default: m.FileExplorer })))

const renderWithQueryClient = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )
}

describe('FileExplorer - Remote Items Display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    
    mockUseSearch.mockReturnValue({ path: '/Users/test/project' })
    
    mockFsListDirectory.mockResolvedValue([
      { name: 'existing-file.txt', path: '/Users/test/project/existing-file.txt', isDirectory: false, size: 100, modifiedTime: '2024-01-01' },
      { name: 'src', path: '/Users/test/project/src', isDirectory: true, size: 0, modifiedTime: '2024-01-01' }
    ])
    
    mockFsIsVersioned.mockResolvedValue(true)
    mockFsGetStatus.mockResolvedValue({ directStatus: {}, allEntries: [] })
    mockFsGetDeepStatus.mockResolvedValue({ directStatus: {}, allEntries: [] })
    mockFsGetParent.mockResolvedValue('/Users/test')
    
    mockSvnInfo.mockResolvedValue({
      path: '/Users/test/project',
      url: 'https://svn.example.com/repo/trunk',
      repositoryRoot: 'https://svn.example.com/repo',
      repositoryUuid: 'uuid-123',
      revision: 100,
      nodeKind: 'dir',
      lastChangedAuthor: 'user',
      lastChangedRevision: 99,
      lastChangedDate: '2024-01-01',
      workingCopyRoot: '/Users/test/project'
    })
    
    mockSvnList.mockResolvedValue({
      path: '/repo/trunk',
      entries: [
        { name: 'existing-file.txt', path: '/repo/trunk/existing-file.txt', url: 'https://svn.example.com/repo/trunk/existing-file.txt', kind: 'file', size: 100, revision: 50, author: 'user', date: '2024-01-01' },
        { name: 'remote-only-file.txt', path: '/repo/trunk/remote-only-file.txt', url: 'https://svn.example.com/repo/trunk/remote-only-file.txt', kind: 'file', size: 200, revision: 60, author: 'user', date: '2024-01-02' },
        { name: 'remote-folder', path: '/repo/trunk/remote-folder', url: 'https://svn.example.com/repo/trunk/remote-folder', kind: 'dir', revision: 70, author: 'user', date: '2024-01-03' }
      ]
    })
    
    mockAuthGet.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  describe('Show Remote Items Toggle', () => {
    it('shows the remote items toggle button in local mode when versioned', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
    })

    it('does not show remote items by default', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByText('existing-file.txt')).toBeInTheDocument()
      })
      
      expect(screen.queryByText('remote-only-file.txt')).not.toBeInTheDocument()
    })

    it('fetches remote items when toggle is enabled', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(mockSvnList).toHaveBeenCalledWith(
          'https://svn.example.com/repo/trunk',
          'HEAD',
          'immediates',
          undefined
        )
      })
    })

    it('displays remote-only items with O status when toggle is enabled', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('remote-only-file.txt')).toBeInTheDocument()
        expect(screen.getByText('remote-folder')).toBeInTheDocument()
      })
    })

    it('applies distinct styling to remote-only items', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('remote-only-file.txt')).toBeInTheDocument()
      })
      
      const remoteFileRow = screen.getByText('remote-only-file.txt').closest('.file-row')
      expect(remoteFileRow).toHaveClass('opacity-70')
      expect(remoteFileRow).toHaveClass('italic')
    })

    it('hides remote items when toggle is disabled', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('remote-only-file.txt')).toBeInTheDocument()
      })
      
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.queryByText('remote-only-file.txt')).not.toBeInTheDocument()
      })
    })
  })

  describe('Remote Items Context Menu', () => {
    it('shows Update to Working Copy action for remote items', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('remote-only-file.txt')).toBeInTheDocument()
      })
      
      const remoteFileRow = screen.getByText('remote-only-file.txt').closest('.file-row')
      if (remoteFileRow) {
        fireEvent.contextMenu(remoteFileRow)
      }
      
      await waitFor(() => {
        expect(screen.getByText('Update to Working Copy')).toBeInTheDocument()
      })
    })
  })

  describe('Sparse Checkout Support', () => {
    it('does not duplicate existing local files', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        const existingFiles = screen.getAllByText('existing-file.txt')
        expect(existingFiles.length).toBe(1)
      })
    })

    it('preserves existing local item functionality', async () => {
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('existing-file.txt')).toBeInTheDocument()
        expect(screen.getByText('src')).toBeInTheDocument()
      })
    })
  })

  describe('Loading States', () => {
    it('shows loading indicator while fetching remote items', async () => {
      mockSvnList.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ path: '', entries: [] }), 100)))
      
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin')
        expect(spinner).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('handles svn list errors gracefully', async () => {
      mockSvnList.mockRejectedValue(new Error('Network error'))
      
      renderWithQueryClient(<React.Suspense fallback={<div>Loading...</div>}><FileExplorer /></React.Suspense>)
      
      await waitFor(() => {
        expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
      })
      
      const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
      fireEvent.click(toggleButton)
      
      await waitFor(() => {
        expect(screen.getByText('existing-file.txt')).toBeInTheDocument()
      })
      
      expect(screen.queryByText('remote-only-file.txt')).not.toBeInTheDocument()
    })
  })
})
