import { describe, it, expect } from 'vitest'
import { getRelativePath, resolveRemoteUrlToLocalPath, isUrlInRepository } from '../src/utils/pathResolution'

describe('getRelativePath', () => {
  describe('basic functionality', () => {
    it('returns relative path for nested paths', () => {
      expect(getRelativePath('/repo/trunk/src/file.ts', '/repo/trunk')).toBe('src/file.ts')
    })

    it('returns relative path for deeply nested paths', () => {
      expect(getRelativePath('/a/b/c/d/e/file.ts', '/a/b')).toBe('c/d/e/file.ts')
    })

    it('returns empty string when paths are equal', () => {
      expect(getRelativePath('/repo/trunk', '/repo/trunk')).toBe('')
    })

    it('handles trailing slash on base path', () => {
      expect(getRelativePath('/repo/trunk/src/file.ts', '/repo/trunk/')).toBe('src/file.ts')
    })

    it('handles trailing slash on full path', () => {
      expect(getRelativePath('/repo/trunk/src/', '/repo/trunk')).toBe('src')
    })
  })

  describe('Windows paths', () => {
    it('handles Windows paths with backslashes', () => {
      expect(getRelativePath('C:\\Project\\src\\file.ts', 'C:\\Project')).toBe('src/file.ts')
    })

    it('handles mixed separators', () => {
      expect(getRelativePath('C:/Project\\src/file.ts', 'C:\\Project')).toBe('src/file.ts')
    })

    it('handles UNC paths', () => {
      expect(getRelativePath('\\\\server\\share\\folder\\file.ts', '\\\\server\\share')).toBe('folder/file.ts')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for empty inputs', () => {
      expect(getRelativePath('', '/repo')).toBe('')
      expect(getRelativePath('/repo', '')).toBe('')
      expect(getRelativePath('', '')).toBe('')
    })

    it('returns empty string when full path does not start with base path', () => {
      expect(getRelativePath('/other/repo/file.ts', '/repo/trunk')).toBe('')
    })

    it('handles single character paths', () => {
      expect(getRelativePath('/a/b', '/a')).toBe('b')
    })

    it('handles paths with spaces', () => {
      expect(getRelativePath('/repo/my project/src/file.ts', '/repo/my project')).toBe('src/file.ts')
    })
  })
})

describe('resolveRemoteUrlToLocalPath', () => {
  const workingCopyRoot = '/Users/user/project'
  const repositoryRoot = 'https://svn.example.com/repo'

  describe('standard path resolution', () => {
    it('resolves URL to local path', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/trunk/src/file.ts',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBe('/Users/user/project/trunk/src/file.ts')
    })

    it('resolves root URL to working copy root', () => {
      const result = resolveRemoteUrlToLocalPath(
        repositoryRoot,
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBe(workingCopyRoot)
    })

    it('resolves nested directory URL', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/branches/feature/src/components/Button.tsx',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBe('/Users/user/project/branches/feature/src/components/Button.tsx')
    })
  })

  describe('external URLs', () => {
    it('returns null for external repository URL', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://other-svn.example.com/repo/file.ts',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBeNull()
    })

    it('returns null for URL from different subdomain', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn2.example.com/repo/file.ts',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBeNull()
    })

    it('returns null for similar but different repository path', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo2/file.ts',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('returns null for empty inputs', () => {
      expect(resolveRemoteUrlToLocalPath('', workingCopyRoot, repositoryRoot)).toBeNull()
      expect(resolveRemoteUrlToLocalPath('https://svn.example.com/repo/file.ts', '', repositoryRoot)).toBeNull()
      expect(resolveRemoteUrlToLocalPath('https://svn.example.com/repo/file.ts', workingCopyRoot, '')).toBeNull()
    })

    it('handles repository root with trailing slash', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/trunk/file.ts',
        workingCopyRoot,
        'https://svn.example.com/repo/'
      )
      expect(result).toBe('/Users/user/project/trunk/file.ts')
    })

    it('handles working copy root with trailing slash', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/trunk/file.ts',
        '/Users/user/project/',
        repositoryRoot
      )
      expect(result).toBe('/Users/user/project/trunk/file.ts')
    })

    it('handles file at root of repository', () => {
      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/readme.md',
        workingCopyRoot,
        repositoryRoot
      )
      expect(result).toBe('/Users/user/project/readme.md')
    })
  })

  describe('Windows working copy paths', () => {
    const windowsWorkingCopy = 'C:\\Users\\user\\project'

    it('resolves to Windows path on Windows platform', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })

      const result = resolveRemoteUrlToLocalPath(
        'https://svn.example.com/repo/trunk/file.ts',
        windowsWorkingCopy,
        repositoryRoot
      )
      expect(result).toBe('C:\\Users\\user\\project\\trunk\\file.ts')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })
})

describe('isUrlInRepository', () => {
  const repositoryRoot = 'https://svn.example.com/repo'

  it('returns true for URL in repository', () => {
    expect(isUrlInRepository('https://svn.example.com/repo/trunk/file.ts', repositoryRoot)).toBe(true)
  })

  it('returns true for repository root URL', () => {
    expect(isUrlInRepository(repositoryRoot, repositoryRoot)).toBe(true)
  })

  it('returns false for external URL', () => {
    expect(isUrlInRepository('https://other.example.com/repo/file.ts', repositoryRoot)).toBe(false)
  })

  it('handles repository root with trailing slash', () => {
    expect(isUrlInRepository('https://svn.example.com/repo/trunk/file.ts', 'https://svn.example.com/repo/')).toBe(true)
  })

  it('returns false for empty inputs', () => {
    expect(isUrlInRepository('', repositoryRoot)).toBe(false)
    expect(isUrlInRepository('https://svn.example.com/repo/file.ts', '')).toBe(false)
  })

  it('returns false for similar but different repository', () => {
    expect(isUrlInRepository('https://svn.example.com/repo2/file.ts', repositoryRoot)).toBe(false)
  })
})
