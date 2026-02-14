import { $ } from 'bun'
import { parseSvnStatusXml, parseSvnLogXml, parseSvnInfoXml } from './parser'
import type { SvnStatusResult, SvnLogResult, SvnInfoResult, SvnDiffResult, SvnBlameResult, SvnListResult } from './types'

export class SvnClient {
  constructor(private svnPath: string) {}
  
  /**
   * Execute an SVN command and return the output
   */
  private async execute(args: string[], cwd?: string): Promise<string> {
    const fullArgs = [this.svnPath, ...args]
    const proc = Bun.spawn(fullArgs, {
      cwd: cwd || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    
    if (exitCode !== 0) {
      throw new Error(stderr || `SVN command failed with exit code ${exitCode}`)
    }
    
    return stdout
  }
  
  /**
   * Get SVN status of a working copy
   */
  async status(path: string): Promise<SvnStatusResult> {
    const xml = await this.execute(['status', '--xml', path])
    return parseSvnStatusXml(xml, path)
  }
  
  /**
   * Get commit history
   */
  async log(
    path: string, 
    limit = 100, 
    startRevision?: number, 
    endRevision?: number
  ): Promise<SvnLogResult> {
    const args = ['log', '--xml', '--verbose', '-l', String(limit)]
    
    if (startRevision !== undefined && endRevision !== undefined) {
      args.push('-r', `${startRevision}:${endRevision}`)
    } else if (startRevision !== undefined) {
      args.push('-r', `${startRevision}:HEAD`)
    }
    
    args.push(path)
    const xml = await this.execute(args)
    return parseSvnLogXml(xml)
  }
  
  /**
   * Get working copy information
   */
  async info(path: string): Promise<SvnInfoResult> {
    const xml = await this.execute(['info', '--xml', path])
    return parseSvnInfoXml(xml)
  }
  
  /**
   * Get diff for a file
   */
  async diff(path: string, revision?: string): Promise<SvnDiffResult> {
    const args = ['diff']
    if (revision) {
      args.push('-c', revision)
    }
    args.push(path)
    
    const output = await this.execute(args)
    
    // Check for binary
    if (output.includes('Cannot display: file marked as a binary type')) {
      return { files: [], hasChanges: true, isBinary: true, rawDiff: output }
    }
    
    // Parse diff (simplified - full parsing would be more complex)
    const hasChanges = output.trim().length > 0
    return { files: [], hasChanges, rawDiff: output }
  }
  
  /**
   * Update working copy
   */
  async update(path: string): Promise<{ success: boolean; revision: number }> {
    const output = await this.execute(['update', path])
    const match = output.match(/Updated to revision (\d+)\./)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision }
  }
  
  /**
   * Commit changes
   */
  async commit(paths: string[], message: string): Promise<{ success: boolean; revision: number }> {
    const args = ['commit', '-m', message, ...paths]
    const output = await this.execute(args)
    const match = output.match(/Committed revision (\d+)\./)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision }
  }
  
  /**
   * Revert local changes
   */
  async revert(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['revert', ...paths])
    return { success: true }
  }
  
  /**
   * Add files to version control
   */
  async add(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['add', ...paths])
    return { success: true }
  }
  
  /**
   * Delete files from version control
   */
  async delete(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['delete', ...paths])
    return { success: true }
  }
  
  /**
   * Cleanup working copy
   */
  async cleanup(path: string): Promise<{ success: boolean }> {
    await this.execute(['cleanup', path])
    return { success: true }
  }
  
  /**
   * Lock a file
   */
  async lock(path: string, message?: string): Promise<{ success: boolean; output?: string }> {
    const args = ['lock']
    if (message) args.push('-m', message)
    args.push(path)
    const output = await this.execute(args)
    return { success: true, output }
  }
  
  /**
   * Unlock a file
   */
  async unlock(path: string, force = false): Promise<{ success: boolean; output?: string }> {
    const args = ['unlock']
    if (force) args.push('--force')
    args.push(path)
    const output = await this.execute(args)
    return { success: true, output }
  }
  
  /**
   * Checkout a repository
   */
  async checkout(
    url: string, 
    path: string, 
    revision?: string, 
    depth?: 'empty' | 'files' | 'immediates' | 'infinity'
  ): Promise<{ success: boolean; revision: number; output?: string }> {
    const args = ['checkout', '--non-interactive']
    if (revision) args.push('-r', revision)
    if (depth) args.push('--depth', depth)
    args.push(url, path)
    
    const output = await this.execute(args)
    const match = output.match(/Checked out revision (\d+)\./)
    const rev = match ? parseInt(match[1], 10) : 0
    return { success: true, revision: rev, output }
  }
  
  /**
   * Export a repository
   */
  async export(url: string, path: string, revision?: string): Promise<{ success: boolean; revision: number; output?: string }> {
    const args = ['export', url, path]
    if (revision) args.push('-r', revision)
    const output = await this.execute(args)
    const match = output.match(/Exported revision (\d+)\./)
    const rev = match ? parseInt(match[1], 10) : 0
    return { success: true, revision: rev, output }
  }
  
  /**
   * Import files into repository
   */
  async import(path: string, url: string, message: string): Promise<{ success: boolean; revision: number; output?: string }> {
    const output = await this.execute(['import', '-m', message, path, url])
    const match = output.match(/Committed revision (\d+)\./)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision, output }
  }
  
  /**
   * Resolve a conflict
   */
  async resolve(
    path: string, 
    resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
  ): Promise<{ success: boolean }> {
    await this.execute(['resolve', '--accept', resolution, path])
    return { success: true }
  }
  
  /**
   * Switch to a different branch
   */
  async switch(path: string, url: string, revision?: string): Promise<{ success: boolean; revision: number; output?: string }> {
    const args = ['switch', url, path]
    if (revision) args.push('-r', revision)
    const output = await this.execute(args)
    const match = output.match(/Updated to revision (\d+)\./)
    const rev = match ? parseInt(match[1], 10) : 0
    return { success: true, revision: rev, output }
  }
  
  /**
   * Copy (branch/tag)
   */
  async copy(src: string, dst: string, message: string): Promise<{ success: boolean; revision: number; output?: string }> {
    const output = await this.execute(['copy', '-m', message, src, dst])
    const match = output.match(/Committed revision (\d+)\./)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision, output }
  }
  
  /**
   * Merge changes
   */
  async merge(
    source: string, 
    target: string, 
    revisions?: string[]
  ): Promise<{ success: boolean; output?: string }> {
    const args = ['merge', source, target]
    if (revisions && revisions.length > 0) {
      args.push('-c', revisions.join(','))
    }
    const output = await this.execute(args)
    return { success: true, output }
  }
  
  /**
   * Relocate working copy
   */
  async relocate(from: string, to: string, path: string): Promise<{ success: boolean; output?: string }> {
    const output = await this.execute(['relocate', from, to, path])
    return { success: true, output }
  }
  
  /**
   * Move/rename a file
   */
  async move(src: string, dst: string): Promise<{ success: boolean; output?: string }> {
    const output = await this.execute(['move', src, dst])
    return { success: true, output }
  }
  
  /**
   * Blame/annotate a file
   */
  async blame(path: string, startRevision?: number, endRevision?: number): Promise<SvnBlameResult> {
    const args = ['blame', '--xml', '-v']
    if (startRevision !== undefined && endRevision !== undefined) {
      args.push('-r', `${startRevision}:${endRevision}`)
    }
    args.push(path)
    
    const xml = await this.execute(args)
    // Simplified parsing - full implementation would parse the XML properly
    return {
      path,
      lines: [],
      startRevision: startRevision || 0,
      endRevision: endRevision || 0
    }
  }
  
  /**
   * List repository contents
   */
  async list(url: string, revision?: string, depth?: 'empty' | 'immediates' | 'infinity'): Promise<SvnListResult> {
    const args = ['list', '--xml', '-v']
    if (revision) args.push('-r', revision)
    if (depth) args.push('--depth', depth)
    args.push(url)
    
    const xml = await this.execute(args)
    // Simplified parsing
    return { path: url, entries: [] }
  }
  
  /**
   * Get/set properties
   */
  async proplist(path: string): Promise<{ name: string; value: string }[]> {
    const output = await this.execute(['proplist', '--xml', '-v', path])
    // Parse properties from XML
    const props: { name: string; value: string }[] = []
    const matches = output.matchAll(/<property[^>]*name="([^"]+)"[^>]*>([^<]*)<\/property>/g)
    for (const match of matches) {
      props.push({ name: match[1], value: match[2] })
    }
    return props
  }
  
  async propset(path: string, name: string, value: string): Promise<{ success: boolean }> {
    await this.execute(['propset', name, value, path])
    return { success: true }
  }
  
  async propdel(path: string, name: string): Promise<{ success: boolean }> {
    await this.execute(['propdel', name, path])
    return { success: true }
  }
  
  /**
   * Changelist operations
   */
  async changelistAdd(paths: string[], changelist: string): Promise<{ success: boolean }> {
    await this.execute(['changelist', changelist, ...paths])
    return { success: true }
  }
  
  async changelistRemove(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['changelist', '--remove', ...paths])
    return { success: true }
  }
}
