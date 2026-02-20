import { 
  TreeSelectionState, 
  LazyTreeNode, 
  SparseCheckoutResult, 
  LazyTreeLoaderState,
  SvnStatusChar
} from '../types'

describe('Sparse Checkout Types', () => {
  describe('TreeSelectionState', () => {
    it('should create a valid TreeSelectionState', () => {
      const selection: TreeSelectionState = {
        selectedPaths: new Set(['/path/to/file1.txt', '/path/to/file2.txt']),
        expandedPaths: new Set(['/path/to/', '/path/to/subdir/'])
      }

      expect(selection.selectedPaths.has('/path/to/file1.txt')).toBe(true)
      expect(selection.expandedPaths.has('/path/to/subdir/')).toBe(true)
    })

    it('should allow adding and removing paths', () => {
      const selection: TreeSelectionState = {
        selectedPaths: new Set(),
        expandedPaths: new Set()
      }

      selection.selectedPaths.add('/new/file.txt')
      selection.expandedPaths.add('/new/')
      
      expect(selection.selectedPaths.has('/new/file.txt')).toBe(true)
      expect(selection.expandedPaths.has('/new/')).toBe(true)

      selection.selectedPaths.delete('/new/file.txt')
      expect(selection.selectedPaths.has('/new/file.txt')).toBe(false)
    })
  })

  describe('LazyTreeNode', () => {
    it('should create a valid LazyTreeNode for file', () => {
      const node: LazyTreeNode = {
        path: '/path/to/file.txt',
        name: 'file.txt',
        kind: 'file',
        isLoading: false,
        isLoaded: true,
        children: [],
        hasChildren: false,
        status: {
          path: '/path/to/file.txt',
          status: 'M' as SvnStatusChar,
          isDirectory: false
        }
      }

      expect(node.path).toBe('/path/to/file.txt')
      expect(node.kind).toBe('file')
      expect(node.hasChildren).toBe(false)
      expect(node.children).toEqual([])
      expect(node.status?.status).toBe('M')
    })

    it('should create a valid LazyTreeNode for directory', () => {
      const node: LazyTreeNode = {
        path: '/path/to/directory',
        name: 'directory',
        kind: 'dir',
        isLoading: false,
        isLoaded: false,
        children: [],
        hasChildren: true
      }

      expect(node.path).toBe('/path/to/directory')
      expect(node.kind).toBe('dir')
      expect(node.hasChildren).toBe(true)
      expect(node.isLoaded).toBe(false)
      expect(node.children).toEqual([])
    })

    it('should handle loading states', () => {
      const loadingNode: LazyTreeNode = {
        path: '/path/to/loading',
        name: 'loading',
        kind: 'dir',
        isLoading: true,
        isLoaded: false,
        children: [],
        hasChildren: false
      }

      expect(loadingNode.isLoading).toBe(true)
      expect(loadingNode.isLoaded).toBe(false)

      const loadedNode: LazyTreeNode = {
        path: '/path/to/loaded',
        name: 'loaded',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        children: [
          {
            path: '/path/to/loaded/file.txt',
            name: 'file.txt',
            kind: 'file',
            isLoading: false,
            isLoaded: true,
            children: [],
            hasChildren: false
          }
        ],
        hasChildren: true
      }

      expect(loadedNode.isLoaded).toBe(true)
      expect(loadedNode.children.length).toBe(1)
      expect(loadedNode.children[0].isLoaded).toBe(true)
    })
  })

  describe('SparseCheckoutResult', () => {
    it('should create a successful SparseCheckoutResult', () => {
      const result: SparseCheckoutResult = {
        success: true,
        revision: 12345,
        pathsCheckedOut: ['/project/src/', '/project/docs/'],
        count: 10
      }

      expect(result.success).toBe(true)
      expect(result.revision).toBe(12345)
      expect(result.pathsCheckedOut).toHaveLength(2)
      expect(result.count).toBe(10)
    })

    it('should create a failed SparseCheckoutResult', () => {
      const result: SparseCheckoutResult = {
        success: false,
        error: 'Invalid URL or authentication failed'
      }

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid URL or authentication failed')
      expect(result.revision).toBeUndefined()
    })

    it('should handle minimal successful result', () => {
      const result: SparseCheckoutResult = {
        success: true,
        revision: 12345
      }

      expect(result.success).toBe(true)
      expect(result.revision).toBe(12345)
    })
  })

  describe('LazyTreeLoaderState', () => {
    it('should create a valid LazyTreeLoaderState', () => {
      const rootNode: LazyTreeNode = {
        path: '/project',
        name: 'project',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        children: [
          {
            path: '/project/src',
            name: 'src',
            kind: 'dir',
            isLoading: false,
            isLoaded: false,
            children: [],
            hasChildren: true
          }
        ],
        hasChildren: true
      }

      const loaderState: LazyTreeLoaderState = {
        isLoading: false,
        nodes: new Map([
          ['/project', rootNode],
          ['/project/src', rootNode.children[0]]
        ]),
        roots: [rootNode],
        selection: {
          selectedPaths: new Set(['/project/src']),
          expandedPaths: new Set(['/project/', '/project/src/'])
        }
      }

      expect(loaderState.isLoading).toBe(false)
      expect(loaderState.nodes.size).toBe(2)
      expect(loaderState.roots).toHaveLength(1)
      expect(loaderState.selection.selectedPaths.has('/project/src')).toBe(true)
    })

    it('should handle error state', () => {
      const loaderState: LazyTreeLoaderState = {
        isLoading: false,
        error: 'Network error while fetching directory contents',
        nodes: new Map(),
        roots: [],
        selection: {
          selectedPaths: new Set(),
          expandedPaths: new Set()
        }
      }

      expect(loaderState.isLoading).toBe(false)
      expect(loaderState.error).toBe('Network error while fetching directory contents')
      expect(loaderState.nodes.size).toBe(0)
    })

    it('should handle loading state', () => {
      const loaderState: LazyTreeLoaderState = {
        isLoading: true,
        nodes: new Map(),
        roots: [],
        selection: {
          selectedPaths: new Set(),
          expandedPaths: new Set()
        }
      }

      expect(loaderState.isLoading).toBe(true)
      expect(loaderState.error).toBeUndefined()
    })
  })

  describe('Integration Tests', () => {
    it('should create a complete tree structure', () => {
      const fileNode: LazyTreeNode = {
        path: '/project/src/App.tsx',
        name: 'App.tsx',
        kind: 'file',
        isLoading: false,
        isLoaded: true,
        children: [],
        hasChildren: false,
        status: {
          path: '/project/src/App.tsx',
          status: 'M' as SvnStatusChar,
          isDirectory: false
        }
      }

      const srcNode: LazyTreeNode = {
        path: '/project/src',
        name: 'src',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        children: [fileNode],
        hasChildren: true
      }

      const rootNode: LazyTreeNode = {
        path: '/project',
        name: 'project',
        kind: 'dir',
        isLoading: false,
        isLoaded: true,
        children: [srcNode],
        hasChildren: true,
        status: {
          path: '/project',
          status: ' ' as SvnStatusChar,
          isDirectory: true
        }
      }

      const loaderState: LazyTreeLoaderState = {
        isLoading: false,
        nodes: new Map([
          ['/project', rootNode],
          ['/project/src', srcNode],
          ['/project/src/App.tsx', fileNode]
        ]),
        roots: [rootNode],
        selection: {
          selectedPaths: new Set(['/project/src/App.tsx']),
          expandedPaths: new Set(['/project/', '/project/src/'])
        }
      }


      expect(loaderState.nodes.size).toBe(3)
      expect(loaderState.roots[0].children[0].path).toBe('/project/src')
      expect(loaderState.roots[0].children[0].children[0].path).toBe('/project/src/App.tsx')
      expect(loaderState.selection.selectedPaths.has('/project/src/App.tsx')).toBe(true)
    })

    it('should handle sparse checkout result with error recovery', () => {
      const failedCheckout: SparseCheckoutResult = {
        success: false,
        error: 'Repository URL not found'
      }


      const successfulCheckout: SparseCheckoutResult = {
        success: true,
        revision: 12346,
        pathsCheckedOut: ['/project/trunk/', '/project/branches/'],
        count: 15
      }

      expect(failedCheckout.success).toBe(false)
      expect(failedCheckout.error).toBe('Repository URL not found')
      
      expect(successfulCheckout.success).toBe(true)
      expect(successfulCheckout.revision).toBe(12346)
      expect(successfulCheckout.count).toBe(15)
    })
  })
})