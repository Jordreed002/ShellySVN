import { join } from 'path'

/**
 * Get the path to a bundled binary
 * In development, assumes binaries are in the project root
 * In production, assumes binaries are alongside the executable
 */
export function getBinaryPath(name: string): string {
  const platform = process.platform
  const isDev = !process.env.ELECTRON_RUN_AS_NODE
  
  // In development, check multiple possible locations
  if (isDev) {
    const devPaths = [
      join(process.cwd(), 'binaries', `${platform}-${process.arch}`, name),
      join(process.cwd(), 'binaries', `${platform}-${process.arch}`, 'svn', name),
      join(process.cwd(), 'binaries', name),
      // Also check if SVN is installed on the system
      name // Will use PATH
    ]
    
    // Return first existing path, or default to system PATH
    return name // For now, use system SVN in dev
  }
  
  // In production, binary is in resources/binaries/
  const resourcesPath = process.resourcesPath || join(__dirname, '..', '..', 'resources')
  const binaryName = platform === 'win32' ? `${name}.exe` : name
  
  return join(resourcesPath, 'binaries', binaryName)
}

/**
 * Get the resources directory path
 */
export function getResourcesPath(): string {
  return process.resourcesPath || join(__dirname, '..', '..', 'resources')
}
